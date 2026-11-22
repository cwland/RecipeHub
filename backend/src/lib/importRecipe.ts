import * as cheerio from "cheerio";
import type { AiService } from "./ai.js";
import { AiError, parseJsonReply, type AiImage } from "./ai.js";
import type { Nutrition } from "../db/schema.js";

// Turning a web page or pasted text into a recipe:
//  1. schema.org Recipe data (JSON-LD), which most recipe sites include for search engines
//  2. otherwise the page's readable text (or a video's description) sent to your AI service
// Pasted text with "Ingredients" and "Instructions" headings is read without AI.

export interface ImportedRecipe {
  title: string;
  description?: string | null;
  ingredients: string[];
  steps: (string | { section: string })[];
  servings?: number | null;
  yieldText?: string | null;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  totalMinutes?: number | null;
  imageUrl?: string | null;
  sourceUrl?: string | null;
  sourceName?: string | null;
  tags?: string[];
  categories?: string[]; // as the site calls them (matched to yours later)
  nutrition?: Nutrition | null;
}

// schema.org NutritionInformation ("240 calories", "9 g", "300 mg") -> numbers per serving
export function nutritionOf(n: unknown, servings: number | null | undefined): Nutrition | null {
  if (!n || typeof n !== "object") return null;
  const o = n as Record<string, unknown>;
  const num = (v: unknown, mg = false) => {
    const m = plain(Array.isArray(v) ? v[0] : v).replace(",", ".").match(/(\d+(?:\.\d+)?)\s*(mg|g|kcal|cal)?/i);
    if (!m) return null;
    let x = Number(m[1]);
    if (mg && m[2]?.toLowerCase() === "g") x *= 1000;
    if (!mg && m[2]?.toLowerCase() === "mg") x /= 1000;
    return Math.round(x * 10) / 10;
  };
  const out: Nutrition = {
    calories: num(o.calories),
    fat: num(o.fatContent),
    saturatedFat: num(o.saturatedFatContent),
    carbs: num(o.carbohydrateContent),
    fiber: num(o.fiberContent),
    sugar: num(o.sugarContent),
    protein: num(o.proteinContent),
    sodium: num(o.sodiumContent, true),
    source: "site",
    servings: servings ?? null,
  };
  return out.calories === null && out.protein === null && out.carbs === null && out.fat === null ? null : out;
}

// ---------- small readers ----------

// "<p>Mac &amp; cheese</p>" -> "Mac & cheese"
export function plain(s: unknown): string {
  if (typeof s !== "string") return "";
  const text = /[<&]/.test(s) ? cheerio.load(`<div>${s.replace(/<br\s*\/?>/gi, "\n")}</div>`)("div").text() : s;
  return text.replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

// ISO 8601 durations: "PT1H30M" -> 90, "P0DT0H20M" -> 20; also "45 minutes", "1 hour 10 mins"
export function minutesOf(v: unknown): number | null {
  if (typeof v === "number") return v > 0 ? Math.round(v) : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const iso = v.trim().match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (iso) {
    const [, d, h, m, s] = iso.map((x) => Number(x ?? 0));
    const total = Math.round(d * 1440 + h * 60 + m + s / 60);
    return total > 0 ? total : null;
  }
  const h = v.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i);
  const m = v.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/i);
  const total = Math.round((h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0));
  return total > 0 ? total : null;
}

// recipeYield: 4, "4", "4 servings", ["4", "4 servings"], "Makes 24 cookies"
export function yieldOf(v: unknown): { servings: number | null; yieldText: string | null } {
  const list = (Array.isArray(v) ? v : [v]).map((x) => (typeof x === "number" ? String(x) : plain(x))).filter(Boolean);
  const text = list.find((x) => /\D/.test(x)) ?? list[0] ?? null;
  const n = list.map((x) => x.match(/\d+/)?.[0]).find(Boolean);
  const servings = n ? Math.min(Number(n), 1000) || null : null;
  return { servings, yieldText: text && /\D/.test(text) ? text.slice(0, 100) : null };
}

// image: "url", {url}, [{url, width}...] -> one address (the widest when sizes are given)
export function imageOf(v: unknown, base?: string): string | null {
  const list = (Array.isArray(v) ? v : [v]).map((x) => (typeof x === "string" ? { url: x, width: 0 } : x && typeof x === "object" ? { url: (x as any).url ?? (x as any).contentUrl ?? (x as any)["@id"], width: Number((x as any).width) || 0 } : null)).filter((x): x is { url: string; width: number } => typeof x?.url === "string" && !!x.url);
  if (!list.length) return null;
  const best = [...list].sort((a, b) => b.width - a.width)[0];
  try {
    const u = new URL(best.url, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const words = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [])
    .map((x) => plain(x).toLowerCase())
    .filter((x) => x && x.length <= 30);

// recipeInstructions: a string, strings, HowToStep, HowToSection (with steps inside), ItemList
export function stepsOf(v: unknown): (string | { section: string })[] {
  const out: (string | { section: string })[] = [];
  const walk = (x: unknown) => {
    if (!x) return;
    if (typeof x === "string") {
      plain(x)
        .split(/\n+/)
        .map((s) => s.replace(/^\s*(?:step\s*)?\d+[.)]\s+/i, "").trim())
        .filter(Boolean)
        .forEach((s) => out.push(s));
      return;
    }
    if (Array.isArray(x)) return x.forEach(walk);
    if (typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    const type = [o["@type"]].flat().map(String);
    if (type.includes("HowToSection") || (o.itemListElement && !o.text)) {
      const name = plain(o.name);
      if (name) out.push({ section: name });
      return walk(o.itemListElement);
    }
    const text = plain(o.text) || plain(o.name) || plain(o.description);
    if (text) walk(text);
  };
  walk(v);
  return out;
}

// ---------- 1. schema.org ----------

function findRecipe(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n);
      if (r) return r;
    }
    return null;
  }
  const o = node as Record<string, unknown>;
  if ([o["@type"]].flat().some((t) => String(t).toLowerCase() === "recipe")) return o;
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) {
    const r = findRecipe(o[key]);
    if (r) return r;
  }
  return null;
}

export function recipeFromJsonLd(html: string, pageUrl: string): ImportedRecipe | null {
  const $ = cheerio.load(html);
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    let data: unknown;
    // some sites wrap it: /*<![CDATA[*/ {...} /*]]>*/
    const raw = $(el).contents().text().trim().replace(/^\/\*\s*<!\[CDATA\[\s*\*\/|\/\*\s*\]\]>\s*\*\/$/g, "").trim();
    try {
      data = JSON.parse(raw);
    } catch {
      try {
        data = JSON.parse(raw.replace(/[\u0000-\u001f]+/g, " ")); // stray newlines inside strings
      } catch {
        continue;
      }
    }
    const r = findRecipe(data);
    if (!r) continue;
    // Yoast and others point at the picture by @id: { "@id": "…#primaryimage" } is an ImageObject elsewhere
    const ref = r.image && typeof r.image === "object" && !Array.isArray(r.image) ? (r.image as Record<string, unknown>)["@id"] : undefined;
    if (ref && !(r.image as Record<string, unknown>).url) {
      const graph = [(data as Record<string, unknown>)?.["@graph"] ?? data].flat() as Record<string, unknown>[];
      const node = graph.find((n) => n && typeof n === "object" && n["@id"] === ref);
      if (node) r.image = node;
    }
    const title = plain(r.name) || plain(r.headline);
    const ingredients = [r.recipeIngredient ?? r.ingredients].flat().map(plain).filter(Boolean);
    if (!title || !ingredients.length) continue;
    const y = yieldOf(r.recipeYield);
    return {
      title,
      description: plain(r.description).slice(0, 5000) || null,
      ingredients,
      steps: stepsOf(r.recipeInstructions),
      ...y,
      prepMinutes: minutesOf(r.prepTime),
      cookMinutes: minutesOf(r.cookTime),
      totalMinutes: minutesOf(r.totalTime),
      imageUrl: imageOf(r.image, pageUrl),
      tags: [...new Set([...words(r.keywords), ...words(r.recipeCuisine)])].slice(0, 12),
      categories: words(r.recipeCategory),
      nutrition: nutritionOf(r.nutrition, y.servings),
    };
  }
  return null;
}

// ---------- page facts and readable text ----------

export function pageInfo(html: string, pageUrl: string) {
  const $ = cheerio.load(html);
  const meta = (name: string) => $(`meta[property="${name}"], meta[name="${name}"]`).attr("content")?.trim() || null;
  const canonical = $('link[rel="canonical"]').attr("href");
  // YouTube keeps the full description in the page's player data
  const yt = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  const videoDescription = yt ? (JSON.parse(`"${yt[1]}"`) as string) : null;
  $("script, style, noscript, svg, iframe, nav, header, footer, aside, form, [aria-hidden=true], .comments, #comments, .ad, .ads, .advertisement").remove();
  const root = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body");
  root.find("li, p, h1, h2, h3, h4, br, tr").each((_, el) => void $(el).append("\n"));
  const text = root.text().replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  let siteName = meta("og:site_name");
  if (!siteName) {
    try {
      siteName = new URL(pageUrl).hostname.replace(/^www\./, "");
    } catch {
      siteName = null;
    }
  }
  return {
    title: meta("og:title") || $("title").first().text().trim() || null,
    description: meta("og:description") || meta("description"),
    image: imageOf(meta("og:image"), pageUrl),
    siteName,
    canonical: canonical ? imageOf(canonical, pageUrl) : null, // (same address checks)
    videoDescription,
    text,
  };
}

// ---------- 2. AI ----------

const SYSTEM = `You turn recipe text into JSON. Reply with JSON only, in this shape:
{"isRecipe": true, "title": "", "description": "", "ingredients": ["1 cup flour", "For the sauce:", "2 tbsp butter"], "steps": ["Heat the oven to 350°F.", "Mix..."], "servings": 4, "yieldText": "", "prepMinutes": 10, "cookMinutes": 20, "totalMinutes": 30, "tags": ["vegetarian"]}
Rules: copy ingredient lines as written, one per line, but write amounts as numbers ("1 lb ground beef", not "One pound of ground beef"; "1/2 cup", not "half a cup"); a heading line ends with ":". Steps are the method in order, without numbers. Leave out stories, ads, comments and nutrition. Use null for anything not given; never invent amounts or times. "tags": up to 5 short lowercase words (cuisine, diet, main ingredient). If the text has no recipe, reply {"isRecipe": false}.`;

export async function recipeWithAi(ai: AiService, text: string, hint?: string): Promise<ImportedRecipe> {
  const active = await ai.active();
  if (!active) throw new AiError("This doesn't have recipe data RecipeHub can read on its own, and AI is off. Turn on AI in Settings › AI to read it, or type the recipe in.");
  const input = text.slice(0, 24000);
  const { text: reply } = await ai.chatWithFailover(active.services, SYSTEM, `${hint ? `${hint}\n\n` : ""}${input}`, 4000, Math.max(active.timeoutSec, 60) * 1000);
  const r = parseJsonReply(reply) as Record<string, unknown> | null;
  if (!r || typeof r !== "object") throw new AiError("The AI's answer couldn't be read. Try again, or try another AI service.");
  return aiRecipe(r);
}

// ---------- photos: recipe cards, cookbook pages, screenshots ----------

const PHOTO_SYSTEM = `${SYSTEM}
The recipe is in the photos (a handwritten or printed recipe card, a cookbook page, a screenshot). The photos may be several pages of one recipe, in order. Read handwriting carefully; keep the writer's amounts and wording, and fix only obvious spelling. Add "dishPhoto": the number (1, 2...) of a photo that shows the finished food, or null if none does.`;

export async function recipeFromPhotos(ai: AiService, images: AiImage[]): Promise<ImportedRecipe & { dishPhoto: number | null }> {
  const { json } = await ai.ask("photo", PHOTO_SYSTEM, `Read the recipe in ${images.length === 1 ? "this photo" : `these ${images.length} photos`}.`, { maxTokens: 4000, images });
  const recipe = aiRecipe(json, "No recipe was found in the photo. Try a sharper, closer photo with good light.");
  const n = typeof json.dishPhoto === "number" && json.dishPhoto >= 1 && json.dishPhoto <= images.length ? json.dishPhoto : null;
  return { ...recipe, dishPhoto: n };
}

// The AI's JSON -> a recipe (or why not)
// Ingredient lines however an AI wrote them: plain lines (asked for), but also groups
// ({heading, items}) and parts ({quantity, unit, name}), which some models answer with
export function ingredientLines(v: unknown): string[] {
  const str = (x: unknown) => (typeof x === "string" ? x.trim() : typeof x === "number" ? String(x) : "");
  return [v].flat().flatMap((x): string[] => {
    if (typeof x === "string") return [x];
    if (!x || typeof x !== "object" || Array.isArray(x)) return Array.isArray(x) ? ingredientLines(x) : [];
    const o = x as Record<string, unknown>;
    const items = o.items ?? o.ingredients ?? o.list;
    if (Array.isArray(items)) {
      const head = str(o.heading) || str(o.group) || str(o.section) || str(o.title) || str(o.name);
      return [...(head ? [head.replace(/:?$/, ":")] : []), ...ingredientLines(items)];
    }
    const text = str(o.text) || str(o.line) || str(o.raw) || str(o.original);
    if (text) return [text];
    const what = [str(o.quantity) || str(o.amount) || str(o.qty), str(o.unit), str(o.name) || str(o.item) || str(o.ingredient)].filter(Boolean).join(" ");
    const note = str(o.preparation) || str(o.note) || str(o.notes);
    return what ? [note ? `${what}, ${note}` : what] : [];
  });
}

export function aiRecipe(r: Record<string, unknown>, none = "No recipe was found there."): ImportedRecipe {
  if (r.isRecipe === false) throw new AiError(none);
  const title = plain(r.title);
  const ingredients = ingredientLines(r.ingredients).map(plain).filter(Boolean);
  if (!title || !ingredients.length) throw new AiError("The AI couldn't find a recipe with ingredients there.");
  const num = (v: unknown) => (typeof v === "number" && v > 0 ? Math.round(v) : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
  return {
    title: title.slice(0, 300),
    description: plain(r.description).slice(0, 5000) || null,
    ingredients,
    steps: stepsOf([r.steps].flat().filter(Boolean)),
    servings: num(r.servings),
    yieldText: plain(r.yieldText).slice(0, 100) || null,
    prepMinutes: num(r.prepMinutes) ?? minutesOf(r.prepMinutes),
    cookMinutes: num(r.cookMinutes) ?? minutesOf(r.cookMinutes),
    totalMinutes: num(r.totalMinutes) ?? minutesOf(r.totalMinutes),
    tags: words(r.tags).slice(0, 5),
  };
}

// ---------- pasted text without AI ----------

const INGREDIENTS_HEAD = /^(?:ingredients?|what you(?:'|’)ll need|you(?:'|’)ll need)\s*:?$/i;
const STEPS_HEAD = /^(?:instructions?|directions?|method|steps|preparation|how to make it)\s*:?$/i;

// "Title / blurb / Ingredients / ... / Instructions / ..." -> a recipe, or null when the headings aren't there
export function recipeFromText(text: string): ImportedRecipe | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const ing = lines.findIndex((l) => INGREDIENTS_HEAD.test(l));
  const st = lines.findIndex((l, i) => i > ing && STEPS_HEAD.test(l));
  if (ing < 0 || st < 0) return null;
  const head = lines.slice(0, ing).filter(Boolean);
  const title = head[0];
  if (!title) return null;
  const ingredients = lines.slice(ing + 1, st).filter(Boolean);
  if (!ingredients.length) return null;
  const rest = lines.slice(st + 1);
  // a "Notes" heading ends the method
  const notesAt = rest.findIndex((l) => /^notes?\s*:?$/i.test(l));
  const method = (notesAt >= 0 ? rest.slice(0, notesAt) : rest).join("\n");
  const desc = head.slice(1).join(" ");
  const times = head.join(" ");
  return {
    title: title.replace(/^#+\s*/, "").slice(0, 300),
    description: desc || null,
    ingredients,
    steps: stepsOf(/\n\s*\n/.test(method.trim()) ? method.split(/\n\s*\n/).map((s) => s.replace(/\n/g, " ")) : method),
    ...yieldOf(times.match(/(?:serves|servings|makes|yield)\s*:?\s*([^,.;]+)/i)?.[0] ?? null),
    prepMinutes: minutesOf(times.match(/prep(?:\s*time)?\s*:?\s*([^,.;]+)/i)?.[1]),
    cookMinutes: minutesOf(times.match(/cook(?:\s*time)?\s*:?\s*([^,.;]+)/i)?.[1]),
  };
}

// Category names sites use -> yours (only categories you already have are used)
const CATEGORY_WORDS: Record<string, string[]> = {
  breakfast: ["breakfast", "brunch"],
  lunch: ["lunch", "sandwich", "sandwiches"],
  dinner: ["dinner", "main", "main course", "main dish", "mains", "entree", "entrée", "supper"],
  side: ["side", "side dish", "sides", "salad"],
  snack: ["snack", "snacks", "appetizer", "appetizers", "starter", "starters"],
  dessert: ["dessert", "desserts", "baking", "sweets", "cake", "cookies"],
  drink: ["drink", "drinks", "beverage", "beverages", "cocktail", "cocktails", "smoothie"],
};
export function matchCategories(siteNames: string[], mine: { id: number; name: string }[]): number[] {
  const ids = new Set<number>();
  for (const raw of siteNames) {
    const n = raw.toLowerCase().trim();
    const exact = mine.find((c) => c.name.toLowerCase() === n);
    if (exact) ids.add(exact.id);
    for (const [cat, list] of Object.entries(CATEGORY_WORDS)) {
      if (!list.includes(n)) continue;
      const c = mine.find((m) => m.name.toLowerCase() === cat);
      if (c) ids.add(c.id);
    }
  }
  return [...ids];
}

// The same page under a different address: no tracking bits, no #anchor, no trailing slash
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|igshid|si$)/i.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.replace(/^www\./, "");
    return u.toString().replace(/\/(\?|$)/, "$1");
  } catch {
    return raw;
  }
}
