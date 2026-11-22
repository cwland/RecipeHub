import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { discoveryItems, type RecipePreview } from "../db/schema.js";
import { AiError, type AiService } from "./ai.js";
import { BlockedError } from "./blocked.js";
import { isOn } from "./features.js";
import { copiesMessage, findSavedCopy } from "./savedCopies.js";
import { estimateNutrition } from "./aiHelpers.js";
import { fetchUrl, type FetchOptions } from "./fetchPage.js";
import { pageInfo, recipeFromJsonLd, recipeFromText, recipeWithAi, type ImportedRecipe } from "./importRecipe.js";
import { parseIngredient } from "./ingredients.js";

// The recipe on a discovered post's page, shown before anything is saved. Opening a post reads
// it with plain code: the page's recipe data (schema.org); when the site keeps RecipeHub out, a saved
// copy's (like Import: Wayback Machine, then archive.ph); else the feed post's own Ingredients /
// Instructions. AI only when asked: Read with AI,
// Calculate nutrition. Kept with the post for a day; Import saves it as shown.

type Post = typeof discoveryItems.$inferSelect;
interface Deps {
  db: Db;
  ai: AiService;
  fetchOptions: FetchOptions;
}

export const KEEP_MS = 24 * 3600_000;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// The feed's copy of the post, as a page (read the same way as any page)
export function feedCopyOf(p: Pick<Post, "title" | "contentHtml" | "description">) {
  const body = p.contentHtml ?? (p.description ? `<p>${esc(p.description)}</p>` : "");
  return `<!DOCTYPE html><html><head><title>${esc(p.title)}</title></head><body><h1>${esc(p.title)}</h1>${body}</body></html>`;
}

// The page's text, for AI (the same as an import's)
function textOf(html: string, url: string) {
  const info = pageInfo(html, url);
  return [info.title && `Title: ${info.title}`, info.description && `Summary: ${info.description}`, info.videoDescription && `Video description:\n${info.videoDescription}`, info.text && `Page text:\n${info.text}`].filter(Boolean).join("\n\n");
}

async function fetchSite(link: string, fetchOptions: FetchOptions): Promise<{ html: string; url: string } | { error: string; blocked?: true }> {
  try {
    const page = await fetchUrl(link, fetchOptions);
    if (page.contentType && !/html|xml|text\/plain/i.test(page.contentType)) return { error: `The link is a ${page.contentType.split(";")[0]}, not a web page.` };
    return { html: page.body.toString("utf8"), url: page.url };
  } catch (e) {
    return { error: (e as Error).message, ...(e instanceof BlockedError ? { blocked: true as const } : {}) };
  }
}

// The site kept RecipeHub out (and saved copies are on): look for a saved copy; read(copy) gives the
// recipe or null. The problem then also says how the saved copies went.
async function fromSavedCopy(d: Deps, link: string, site: { error: string; blocked?: true }, read: (html: string, url: string) => Promise<ImportedRecipe | null>) {
  if (!site.blocked || !(await isOn(d.db, "savedCopies"))) return { found: null, problem: site.error };
  const { found, tried } = await findSavedCopy(link, d.fetchOptions, (c) => read(c.html, c.pageUrl));
  if (found) return { found: { recipe: withSource(found.recipe, link, found.copy.html, found.copy.pageUrl), savedCopy: { from: found.copy.from, url: found.copy.url, ...(found.copy.date ? { date: found.copy.date } : {}) } }, problem: site.error };
  return { found: null, problem: `${site.error} ${copiesMessage(tried)}` };
}

const withSource = (r: ImportedRecipe, link: string, html: string | null, pageUrl: string): ImportedRecipe => {
  const info = html ? pageInfo(html, pageUrl) : null;
  const canonical = info?.canonical && /^https?:/.test(info.canonical) && new URL(info.canonical, pageUrl).hostname === new URL(link).hostname ? info.canonical : null;
  return { ...r, imageUrl: r.imageUrl ?? info?.image ?? null, sourceUrl: canonical ?? link, sourceName: r.sourceName ?? info?.siteName ?? new URL(link).hostname.replace(/^www\./, "") };
};

async function keep(db: Db, id: number, preview: RecipePreview) {
  await db.update(discoveryItems).set({ preview, previewAt: new Date() }).where(eq(discoveryItems.id, id));
  return preview;
}

// Plain code only
export async function readPreview(d: Deps, p: Post & { link: string }): Promise<RecipePreview> {
  const site = await fetchSite(p.link, d.fetchOptions);
  if ("html" in site) {
    const r = recipeFromJsonLd(site.html, site.url);
    if (r) return keep(d.db, p.id, { recipe: withSource(r, p.link, site.html, site.url), how: "schema.org", from: "site", problem: null });
  }
  let problem = "error" in site ? site.error : "The recipe's page has no recipe data RecipeHub can read without AI.";
  if ("error" in site) {
    const copy = await fromSavedCopy(d, p.link, site, async (html, url) => recipeFromJsonLd(html, url));
    if (copy.found) return keep(d.db, p.id, { recipe: copy.found.recipe, how: "schema.org", from: "copy", savedCopy: copy.found.savedCopy, problem: copy.problem });
    problem = copy.problem;
  }
  const feed = feedCopyOf(p);
  const fromText = recipeFromText(pageInfo(feed, p.link).text ?? "");
  if (fromText) return keep(d.db, p.id, { recipe: withSource({ ...fromText, title: fromText.title || p.title }, p.link, null, p.link), how: "text", from: "feed", problem });
  return keep(d.db, p.id, { recipe: null, how: null, from: null, problem });
}

// Read with AI: the site's page text; the site blocked: a saved copy (its recipe data, else its
// text by AI); else the feed's copy
const aiTurnedOff = (e: unknown) => !(e instanceof AiError) || /Settings › AI/.test(e.message);
export async function previewWithAi(d: Deps, p: Post & { link: string }): Promise<RecipePreview> {
  const site = await fetchSite(p.link, d.fetchOptions);
  let problem: string | null = "error" in site ? site.error : null;
  if ("error" in site) {
    const copy = await fromSavedCopy(d, p.link, site, async (html, url) => {
      const data = recipeFromJsonLd(html, url);
      if (data) return data;
      try {
        return await recipeWithAi(d.ai, textOf(html, url), `This is from ${p.link}.`);
      } catch (e) {
        if (aiTurnedOff(e)) throw e;
        return null; // nothing the AI could read there: the next copy
      }
    });
    if (copy.found) return keep(d.db, p.id, { recipe: copy.found.recipe, how: "ai", from: "copy", savedCopy: copy.found.savedCopy, problem: copy.problem });
    problem = copy.problem;
  }
  const tries: { from: "site" | "feed"; text: string; html: string | null; url: string }[] = [];
  if ("html" in site) tries.push({ from: "site", text: textOf(site.html, site.url), html: site.html, url: site.url });
  tries.push({ from: "feed", text: textOf(feedCopyOf(p), p.link), html: null, url: p.link });
  let last: Error | null = null;
  for (const t of tries) {
    try {
      const r = await recipeWithAi(d.ai, t.text, `This is from ${p.link}.`);
      return keep(d.db, p.id, { recipe: withSource(r, p.link, t.html, t.url), how: "ai", from: t.from, problem: t.from === "feed" ? problem : null });
    } catch (e) {
      if (aiTurnedOff(e)) throw e; // AI off: nothing else to try
      last = e as Error;
    }
  }
  throw last!;
}

// Calculate nutrition: one ingredient at a time, added up per serving (the same as Re-analyze)
export async function previewNutrition(d: Deps, id: number, preview: RecipePreview): Promise<RecipePreview> {
  const r = preview.recipe!;
  const nutrition = await estimateNutrition(d.ai, { title: r.title, servings: r.servings ?? null, yieldText: r.yieldText ?? null, ingredients: r.ingredients.map(parseIngredient) });
  return keep(d.db, id, { ...preview, recipe: { ...r, nutrition } });
}

export const fresh = (p: Pick<Post, "preview" | "previewAt">) => (p.preview && p.previewAt && Date.now() - p.previewAt.getTime() < KEEP_MS ? p.preview : null);
