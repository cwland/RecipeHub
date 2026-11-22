import { asc, eq, ilike, sql } from "drizzle-orm";
import { readRecipeFile, type FileRecipe, type ReadResult } from "./fileImport.js";
import type { Db } from "../db/index.js";
import { categories, discoveryItems, jobs, recipeUser, recipes, type JobResult } from "../db/schema.js";
import type { AiService } from "./ai.js";
import { logEvent } from "./appLog.js";
import { fetchUrl, type FetchOptions } from "./fetchPage.js";
import { BlockedError, detectBlock } from "./blocked.js";
import { copiesMessage, findSavedCopy } from "./savedCopies.js";
import { isOn } from "./features.js";
import { AiError } from "./ai.js";
import { matchCategories, normalizeUrl, pageInfo, recipeFromJsonLd, recipeFromPhotos, recipeFromText, recipeWithAi, type ImportedRecipe } from "./importRecipe.js";
import type { JobQueue, JobRow } from "./jobs.js";
import type { Photos } from "./photos.js";
import { createRecipe, saveRecipe } from "./recipes.js";
import { recipeAdded } from "./nutrition.js";
import { firstVersion } from "./versions.js";
import { tidyIngredientLine } from "./ingredients.js";
import { newReport, recipesFromPdf } from "./pdfImport.js";
import { recordImported } from "./inbox.js";
import type { EventBus } from "./events.js";

interface Deps {
  db: Db;
  ai: AiService;
  photos: Photos;
  fetchOptions: FetchOptions; // tests swap in fake pages
  jobs: JobQueue;
  events?: EventBus;
}

// A recipe already saved from this page, if any
export async function findDuplicate(db: Db, url: string) {
  const want = normalizeUrl(url);
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  const rows = await db.select({ id: recipes.id, sourceUrl: recipes.sourceUrl }).from(recipes).where(ilike(recipes.sourceUrl, `%${host}%`));
  return rows.find((r) => r.sourceUrl && normalizeUrl(r.sourceUrl) === want)?.id ?? null;
}

// fromApp: a collection from your own recipe app, so its categories are yours (made if new) and its notes come too
async function store(d: Deps, r: ImportedRecipe & { notes?: string | null }, job: JobRow, how: JobResult["how"], fromApp = false): Promise<JobResult> {
  const warnings: string[] = [];
  let imageUrl = r.imageUrl ?? null;
  // Keep a copy of the picture here, so it stays even if the site changes or goes away
  if (imageUrl && /^https?:/i.test(imageUrl)) {
    try {
      imageUrl = await d.photos.download(imageUrl, d.fetchOptions);
    } catch (e) {
      warnings.push(`The photo couldn't be saved (${(e as Error).message}); it's linked from the site instead.`);
    }
  }
  const mine = await d.db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.sortOrder));
  const input = createRecipe.parse({
    title: r.title.slice(0, 300),
    description: r.description?.slice(0, 5000) ?? null,
    ingredients: r.ingredients.slice(0, 500).map((i) => tidyIngredientLine(i.slice(0, 1000))), // "One pound of…" -> "1 lb…"
    steps: r.steps.slice(0, 300).map((s) => (typeof s === "string" ? s.slice(0, 10000) : { section: s.section.slice(0, 200) })),
    servings: r.servings ?? null,
    yieldText: r.yieldText ?? null,
    prepMinutes: r.prepMinutes ?? null,
    cookMinutes: r.cookMinutes ?? null,
    totalMinutes: r.totalMinutes ?? (r.prepMinutes || r.cookMinutes ? (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0) : null),
    sourceUrl: r.sourceUrl?.slice(0, 2000) ?? null,
    sourceName: r.sourceName?.slice(0, 200) ?? null,
    imageUrl,
    tags: (r.tags ?? []).map((t) => t.slice(0, 60)).slice(0, 12),
    categories: fromApp ? [...new Set((r.categories ?? []).map((c) => c.trim().slice(0, 100)).filter(Boolean))].slice(0, 20) : matchCategories(r.categories ?? [], mine),
    nutrition: r.nutrition ?? null,
    ...(fromApp && r.notes ? { notes: r.notes.slice(0, 20000) } : {}),
  });
  const recipeId = await saveRecipe(d.db, null, input, job.createdBy);
  await firstVersion(d.db, recipeId, "import", job.createdBy);
  // Nutrition (Auto nutrition): not for every recipe in a whole file, only one at a time.
  // Imported by a person: they're offered the AI check; with an API key, nobody is.
  if (how !== "file") await recipeAdded(d, recipeId, { offered: job.createdBy !== null });
  return { recipeId, title: input.title, how, ...(warnings.length ? { warnings } : {}) };
}

// Already saved from this page: skipped, and noted in Settings › Logs › Imports
async function alreadySaved(d: Deps, url: string, recipeId: number): Promise<JobResult> {
  const [r] = await d.db.select({ title: recipes.title }).from(recipes).where(eq(recipes.id, recipeId));
  await logEvent(d.db, { category: "import", level: "info", source: url.slice(0, 200), event: `Already saved: "${r?.title ?? "a recipe"}"` });
  return { duplicateOf: recipeId };
}

interface Read {
  r: ImportedRecipe;
  how: JobResult["how"];
  info: ReturnType<typeof pageInfo>;
  sourceUrl: string;
  savedCopy?: JobResult["savedCopy"];
  why?: string; // the site kept it from us: why (for the log)
  fromFeed?: boolean; // Discovery: read from the feed's copy of the post
}

// Blocked, and no saved copy either (a plain Error, so it isn't remembered twice)
class CopyError extends Error {
  constructor(
    message: string,
    public blocked: BlockedError,
  ) {
    super(message);
  }
}

// The recipe on a page (the real one or a saved copy): schema.org data, else the AI on its text.
// A security check page, or a paywall where no recipe was found, is a BlockedError.
async function readPage(ai: AiService, html: string, pageUrl: string) {
  const info = pageInfo(html, pageUrl);
  const found = recipeFromJsonLd(html, pageUrl);
  if (found) return { r: found, how: "schema.org" as const, info };
  const host = new URL(pageUrl).hostname;
  const check = detectBlock(200, html);
  if (check?.reason === "captcha") throw new BlockedError(check, host); // nothing for the AI to read
  const text = [info.title && `Title: ${info.title}`, info.description && `Summary: ${info.description}`, info.videoDescription && `Video description:\n${info.videoDescription}`, info.text && `Page text:\n${info.text}`].filter(Boolean).join("\n\n");
  try {
    return { r: await recipeWithAi(ai, text, `This is from ${pageUrl}.`), how: "ai" as const, info };
  } catch (e) {
    // No recipe found (or AI off): if the page shows a paywall, that's the reason to give
    const paywall = e instanceof AiError ? detectBlock(200, html, { noRecipe: true }) : null;
    if (paywall?.reason === "paywall") throw new BlockedError(paywall, host);
    throw e;
  }
}

// Asked for AI correction (the Companion's direct import): a new recipe is improved in the
// background, the same way "Improve all automatically" does a batch
async function improveAfter(queue: JobQueue, job: { id: number; payload: unknown; createdBy: number | null }, result: JobResult, d?: Deps) {
  // Asked to (the Companion's Import): a note of it in the inbox's Imported list
  const inbox = (job.payload as { inbox?: { sentBy: string | null; sourceApp: string | null }; url?: string }).inbox;
  const url = (job.payload as { url?: string }).url;
  if (d && inbox && url && result.recipeId && !result.duplicateOf) await recordImported(d.db, d.events, { url, title: result.title ?? url, recipeId: result.recipeId, ...inbox });
  if ((job.payload as { improve?: boolean }).improve && result.recipeId && !result.duplicateOf)
    result.improving = (await queue.enqueue("import-improve", { importId: job.id, recipeIds: [result.recipeId], name: result.title ?? "Recipe" }, job.createdBy)).id;
  return result;
}

export function registerImportJobs(queue: JobQueue, d: Deps) {
  // A link: schema.org data on the page, or AI on the page's text (or a video's description).
  // When the site keeps it from us (a security check, a paywall, a refusal), a saved copy in a web
  // archive is tried next, unless that's switched off in Settings › Recipes.
  queue.handle("import-url", async (job) => {
    const { url, force, html: sent, feedCopy, discoveryItemId, preview } = job.payload as { url: string; force?: boolean; html?: string; feedCopy?: string; discoveryItemId?: number; preview?: { recipe: ImportedRecipe; how: JobResult["how"] | null; fromFeed: boolean; savedCopy?: JobResult["savedCopy"] } };
    const remember = (result: JobResult) => d.db.update(jobs).set({ result }).where(eq(jobs.id, job.id));
    // From Discovery: the post remembers the recipe it became (or the one already saved)
    const linked = async (result: JobResult) => {
      const recipeId = result.recipeId ?? result.duplicateOf;
      if (discoveryItemId && recipeId) await d.db.update(discoveryItems).set({ recipeId }).where(eq(discoveryItems.id, discoveryItemId));
      return result;
    };
    try {
      if (!force) {
        const dup = await findDuplicate(d.db, url);
        if (dup) return linked(await alreadySaved(d, url, dup));
      }
      let read: Read | undefined;
      // From Discovery, the recipe as it was shown: saved as is (no reading the page again)
      if (preview) read = { r: preview.recipe, how: preview.how === "schema.org" || preview.how === "ai" || preview.how === "text" ? preview.how : "schema.org", info: pageInfo("", url), sourceUrl: preview.recipe.sourceUrl ?? url, fromFeed: preview.fromFeed || undefined, savedCopy: preview.savedCopy };
      else try {
        // Sent from your browser (Send to RecipeHub): that page, not a fetch
        const page = sent ? { url, contentType: "text/html", body: Buffer.from(sent, "utf8") } : await fetchUrl(url, d.fetchOptions);
        if (!/html|xml|text\/plain/i.test(page.contentType) && page.contentType) throw new Error(`That link is a ${page.contentType.split(";")[0]}, not a web page. Reading recipes from photos and files comes later.`);
        const html = page.body.toString("utf8");
        const info = pageInfo(html, page.url);
        const sourceUrl = info.canonical && new URL(info.canonical).hostname === new URL(page.url).hostname ? info.canonical : page.url;
        if (!force && sourceUrl !== url) {
          const dup = await findDuplicate(d.db, sourceUrl);
          if (dup) return linked(await alreadySaved(d, url, dup));
        }
        read = { ...(await readPage(d.ai, html, page.url)), sourceUrl };
      } catch (e) {
        // Kept from us: look for a saved copy first (saying which archive, for the import window).
        // From Discovery, when that finds nothing (or the site just couldn't be read), the feed's
        // copy of the post is read instead, the same way (its recipe data, or AI on its text).
        let why = (e as Error).message;
        let copyError: CopyError | null = null;
        if (e instanceof BlockedError && !sent && (await isOn(d.db, "savedCopies"))) {
          const blocked = { ...e.block, url };
          const { found, tried } = await findSavedCopy(url, d.fetchOptions ?? {}, async (copy) => {
            try {
              return await readPage(d.ai, copy.html, copy.pageUrl);
            } catch (err) {
              if (err instanceof BlockedError || err instanceof AiError) return null; // nothing to read there
              throw err;
            }
          }, (from) => remember({ blocked, trying: from }).then(() => {}));
          if (found) {
            const original = new URL(url).hostname;
            const canonical = found.recipe.info.canonical;
            read = { ...found.recipe, sourceUrl: canonical && /^https?:/.test(canonical) && new URL(canonical).hostname === original ? canonical : url, savedCopy: { from: found.copy.from, url: found.copy.url, ...(found.copy.date ? { date: found.copy.date } : {}) }, why: e.message };
          } else {
            await remember({ blocked, savedCopies: tried });
            why = `${e.message} ${copiesMessage(tried)}`;
            copyError = new CopyError(why, e);
          }
        }
        if (!read) {
          if (feedCopy) {
            try {
              read = { ...(await readPage(d.ai, feedCopy, url)), sourceUrl: url, why: `${why} Read from the feed's copy of the post instead.`, fromFeed: true };
            } catch (err) {
              throw new Error(`${why} The feed's copy of the post didn't have the recipe either${err instanceof AiError ? ` (${(err as Error).message})` : ""}.`);
            }
          } else throw copyError ?? e;
        }
      }
      const { r, how, info, sourceUrl, savedCopy } = read;
      const result = await store(d, { ...r, imageUrl: r.imageUrl ?? info.image, sourceUrl, sourceName: info.siteName ?? (savedCopy ? new URL(url).hostname.replace(/^www\./, "") : preview ? r.sourceName : undefined) }, job, how);
      if (savedCopy) result.savedCopy = savedCopy;
      if (read.fromFeed) result.fromFeed = true;
      if (sent) {
        result.sent = true;
        await d.db.update(jobs).set({ payload: sql`${jobs.payload} - 'html'` }).where(eq(jobs.id, job.id)); // imported: the copy isn't needed
      }
      const from = preview ? " (as shown in Discover)" : savedCopy ? ` from a saved copy (${savedCopy.from})` : read.fromFeed ? " from the feed's copy (Discovery)" : sent ? " (sent from your browser)" : how === "ai" ? " with AI" : "";
      await logEvent(d.db, { category: "import", level: result.warnings ? "warning" : "info", source: info.siteName ?? url, event: `Imported "${result.title}"${from}`, detail: [read.why, result.warnings?.join(" ")].filter(Boolean).join(" ") || url });
      return linked(await improveAfter(queue, job, result, d));
    } catch (e) {
      // Kept from us, no saved copy looked for: remember why, for the import window
      if (e instanceof BlockedError) await remember({ blocked: { ...e.block, url } });
      await logEvent(d.db, { category: "import", level: "warning", source: url.slice(0, 200), event: "Couldn't import a recipe", detail: (e as Error).message });
      throw e;
    }
  });

  // Pasted text: read directly when it has Ingredients / Instructions headings, otherwise with AI
  queue.handle("import-text", async (job) => {
    const { text } = job.payload as { text: string };
    try {
      const plainRead = recipeFromText(text);
      const r = plainRead ?? (await recipeWithAi(d.ai, text));
      const result = await store(d, r, job, plainRead ? "text" : "ai");
      await logEvent(d.db, { category: "import", level: "info", source: "Pasted text", event: `Imported "${result.title}"${plainRead ? "" : " with AI"}` });
      return improveAfter(queue, job, result, d);
    } catch (e) {
      await logEvent(d.db, { category: "import", level: "warning", source: "Pasted text", event: "Couldn't import a recipe", detail: (e as Error).message });
      throw e;
    }
  });
}

// Photos of a recipe card or cookbook page, read by an AI service that can see pictures
export function registerPhotoImport(queue: JobQueue, d: Deps) {
  queue.handle("import-photo", async (job) => {
    const { files } = job.payload as { files: string[] };
    try {
      const buffers = await Promise.all(files.map((f) => d.photos.readIncoming(f)));
      const r = await recipeFromPhotos(d.ai, buffers.map((b) => ({ mime: "image/jpeg", base64: b.toString("base64") })));
      const imageUrl = r.dishPhoto ? await d.photos.save(buffers[r.dishPhoto - 1]) : null;
      const result = await store(d, { ...r, imageUrl, sourceName: r.sourceName ?? null }, job, "photo");
      await d.photos.removeIncoming(files);
      await logEvent(d.db, { category: "import", level: "info", source: "Photo", event: `Read "${result.title}" from ${files.length === 1 ? "a photo" : `${files.length} photos`}` });
      return result;
    } catch (e) {
      await logEvent(d.db, { category: "import", level: "warning", source: "Photo", event: "Couldn't read a recipe from a photo", detail: (e as Error).message });
      throw e;
    }
  });
}

// A recipe already saved that this one is a copy of: the same page, or the same name and ingredients
async function sameRecipe(db: Db, r: ImportedRecipe) {
  if (r.sourceUrl) {
    const dup = await findDuplicate(db, r.sourceUrl);
    if (dup) return dup;
  }
  const rows = await db.select({ id: recipes.id, ingredients: recipes.ingredients }).from(recipes).where(sql`lower(${recipes.title}) = ${r.title.toLowerCase()}`);
  // (as they'd be saved: "Two pounds of chuck" is saved as "2 lb chuck")
  const want = r.ingredients.map((l) => tidyIngredientLine(l).trim().toLowerCase()).join("\n");
  return rows.find((x) => x.ingredients.map((i) => i.raw.trim().toLowerCase()).join("\n") === want)?.id ?? null;
}

// A collection exported from another app (Paprika now; more formats in fileImport.ts)
export function registerFileImport(queue: JobQueue, d: Deps) {
  queue.handle("import-file", async (job) => {
    // choose: list the recipes first (several of them); keep: import only these (by their place in
    // the file); found: a PDF's recipes as the AI read them the first time (so it isn't asked again)
    const { file, name, choose, keep, found: readBefore } = job.payload as { file: string; name: string; choose?: boolean; keep?: number[]; found?: FileRecipe[] };
    try {
      // A PDF is read by AI (one recipe or a whole cookbook); other files are another app's export
      const pdf = name.toLowerCase().endsWith(".pdf");
      const report = newReport();
      const read: ReadResult = pdf && readBefore ? { format: "PDF", recipes: readBefore, problems: [] } : pdf ? { format: "PDF", recipes: await recipesFromPdf(d.ai, await d.photos.readIncoming(file), name, report), problems: [] } : readRecipeFile(name, await d.photos.readIncoming(file));
      const { format, problems } = read;
      if (pdf && !read.recipes.length) {
        // Nothing came of it: the log keeps what the AI said, so it can be looked into
        const pages = `${report.textPages} page${report.textPages === 1 ? "" : "s"} with text, ${report.scannedPages} scanned.`;
        const left = report.leftOut.map((l) => `Left out "${l.title}": ${l.why}`).join(" ");
        await logEvent(d.db, { category: "import", level: "warning", source: name.slice(0, 120), event: `No recipes were found in ${name}`, detail: [pages, left, `The AI answered: ${report.answers.join(" | ")}`].filter(Boolean).join(" ") });
        const noList = report.leftOut.filter((l) => /ingredients/.test(l.why));
        if (noList.length) throw new Error(`Your AI found "${noList[0].title}"${noList.length > 1 ? ` and ${noList.length - 1} more` : ""} but without any ingredients, so nothing could be imported. Try again, or try another AI model in Settings › AI.`);
        throw new Error(`No recipes were found in ${name}.`);
      }
      if (choose && read.recipes.length > 1) {
        const choices = [];
        for (const [n, r] of read.recipes.entries()) choices.push({ n, title: r.title, already: !!(await sameRecipe(d.db, r)) });
        choices.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
        if (pdf) await d.db.update(jobs).set({ payload: { ...job.payload, found: read.recipes } }).where(eq(jobs.id, job.id));
        return { format, choices, problems: problems.slice(0, 200) };
      }
      const found = keep ? read.recipes.filter((_, n) => keep.includes(n)) : read.recipes;
      const recipeIds: number[] = [];
      let imported = 0;
      let skipped = 0;
      for (const r of found) {
        try {
          if (await sameRecipe(d.db, r)) {
            skipped++;
            continue;
          }
          const imageUrl = r.photo ? await d.photos.save(r.photo).catch(() => null) : r.imageUrl;
          // (one recipe from a PDF is treated like a single import: offered the AI check, nutrition after)
          const result = await store(d, { ...r, imageUrl: imageUrl ?? null }, job, pdf && found.length === 1 ? "pdf" : "file", !pdf);
          if (result.recipeId) recipeIds.push(result.recipeId);
          if (r.rating && job.createdBy && result.recipeId)
            await d.db
              .insert(recipeUser)
              .values({ recipeId: result.recipeId, userId: job.createdBy, rating: r.rating })
              .onConflictDoUpdate({ target: [recipeUser.recipeId, recipeUser.userId], set: { rating: r.rating } });
          imported++;
        } catch (e) {
          problems.push({ name: r.title, reason: (e as Error).message.split("\n")[0].slice(0, 200) });
        }
      }
      await d.photos.removeIncoming([file]);
      await logEvent(d.db, { category: "import", level: problems.length ? "warning" : "info", source: name.slice(0, 200), event: `Imported ${imported} recipe${imported === 1 ? "" : "s"} from ${format}`, detail: [skipped && `${skipped} already saved`, problems.length && `${problems.length} couldn't be used`].filter(Boolean).join(", ") || undefined });
      // Improve all automatically (chosen with the pick list): the AI batch starts now, in the background
      const improving = (job.payload as { improve?: boolean }).improve && recipeIds.length ? (await queue.enqueue("import-improve", { importId: job.id, recipeIds, name }, job.createdBy)).id : undefined;
      return { format, imported, skipped, recipeIds, problems: problems.slice(0, 200), ...(improving ? { improving } : {}) };
    } catch (e) {
      await logEvent(d.db, { category: "import", level: "warning", source: name.slice(0, 200), event: "Couldn't import a recipe file", detail: (e as Error).message });
      throw e;
    }
  });
}

export const jobView = (j: JobRow) => ({
  id: j.id,
  kind: j.kind,
  status: j.status,
  source: j.kind === "import-url" ? String((j.payload as { url?: string }).url ?? "") : j.kind === "import-improve" ? String((j.payload as { name?: string }).name ?? "Import") : j.kind === "import-file" ? String((j.payload as { name?: string }).name ?? "File") : j.kind === "import-photo" ? (((j.payload as { files?: string[] }).files?.length ?? 1) > 1 ? "Photos" : "Photo") : "Pasted text",
  result: j.result ?? null,
  error: j.error,
  createdAt: j.createdAt,
  finishedAt: j.finishedAt,
});
