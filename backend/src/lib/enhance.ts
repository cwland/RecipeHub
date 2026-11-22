import { asc, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { categories, recipeTags, recipes, tags, type Ingredient, type Nutrition, type Step } from "../db/schema.js";
import type { AiProgress, AiService } from "./ai.js";
import { HttpError } from "./errors.js";
import { isOn } from "./features.js";
import { cleanTag, loadRecipe, nutritionInput, refreshSearch, saveRecipe, type RecipeInput } from "./recipes.js";
import { AiError } from "./ai.js";
import { logEvent } from "./appLog.js";
import { notFound } from "./errors.js";
import { tidyIngredientLine } from "./ingredients.js";
import { estimateNutrition } from "./aiHelpers.js";

// AI Enhance: the AI checks a recipe (fills gaps in the steps, catches ingredient mistakes,
// estimates nutrition, suggests categories and tags). Checking saves nothing: the person picks
// which sections to keep in the wizard, and those are applied separately (with one level of undo).

export interface Section<T> {
  suggested: T;
  changes: string[]; // "What changed", in the AI's words
  changed: boolean; // differs from the recipe as it is
}
export interface Enhancement {
  steps: Section<string[]> & { mode: "expanded" | "filled" | null }; // expanded: brief steps rewritten in full
  ingredients: Section<string[]>;
  nutrition: Section<Nutrition | null>;
  organize: { categories: string[]; newCategories: string[]; tags: string[]; changes: string[]; changed: boolean };
}

// Only when AI is ready and AI Enhance is on (Settings › AI)
export async function requireEnhance(db: Db, ai: AiService) {
  if (!(await ai.active("recipe"))) throw new HttpError(409, "AI Enhance needs AI. Turn it on in Settings › AI.");
  if (!(await isOn(db, "aiEnhance"))) throw new HttpError(409, "AI Enhance is turned off. Turn it on in Settings › Recipes.");
}

// Lines as the person sees them; a heading is "# Heading" (the editor and the save both read it back)
export const stepLines = (steps: Step[]) => steps.map((s) => (s.section ? `# ${s.section}` : s.text));
export const ingredientLines = (list: Ingredient[]) => list.map((i) => (i.section ? `# ${i.section}` : i.raw));

// Brief steps get rewritten in full (grouped, with how and why); detailed ones only get gaps filled
export function briefSteps(steps: Step[]) {
  const lines = steps.filter((s) => !s.section);
  if (steps.some((s) => s.section)) return false;
  if (lines.length <= 3) return true;
  return lines.reduce((n, s) => n + s.text.length, 0) / lines.length < 70;
}

const SYSTEM = `You check home recipes and suggest careful fixes. Reply with JSON only, in this shape:
{"steps": ["..."], "stepMode": "expanded" or "filled", "stepChanges": ["..."],
 "ingredients": ["..."], "ingredientChanges": ["..."],
 "categories": ["..."], "tags": ["..."], "organizeChanges": ["..."]}
Rules:
- Steps marked DETAILED (fill gaps only, "stepMode": "filled"): keep the recipe's own wording. Change a step only to fix a mistake or add a missing detail (a time, a temperature, a doneness cue, a missing step). Keep every step; lines starting with "# " are headings, keep them.
- Steps marked BRIEF (expand them, "stepMode": "expanded"): rewrite them as full instructions a home cook can follow. Group them under short headings, each its own line starting with "# " (for example "# Prep and Season", "# Sear the Pork Chops", "# Build the Pan Sauce"). Each step starts with a short label and a colon ("Pat dry: ...", "Deglaze: ..."), then says how and why: pan and heat level, visual and doneness cues, times, resting, scraping up browned bits. Keep every action and the cook's own numbers; add detail, don't drop anything. Never number the lines.
- Food safety: if a doneness temperature is below the USDA safe minimum (pork 145°F, poultry 165°F, ground meat 160°F), use the safe one and say so in stepChanges.
- Ingredients: one per line, as written, but with amounts as numbers ("1 lb ground beef", not "One pound of ground beef"). Never add an ingredient, not even salt, pepper, oil or water: only correct and tidy the ones the recipe has (amounts, units, names, prep notes), and you may split a combined line ("salt and pepper") or group lines under "# " headings. Never change a quantity without saying why in ingredientChanges.
- Categories: choose from the household's categories. Suggest a new one only if none fits.
- Tags: lowercase, short. Reuse the household's existing tags rather than near-duplicates. Keep the recipe's tags unless one is wrong.
- Each ...Changes list: one short sentence per change, saying what and why. An empty list if nothing changed.
- If a section needs no change, return it exactly as given.`;

const textList = (v: unknown, maxItems: number, maxLen: number): string[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems);
  return out.length ? out : null; // empty: treat as left out (never wipes a section)
};
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => norm(x) === norm(b[i]));
const sameSet = (a: string[], b: string[]) => {
  const x = new Set(a.map((s) => s.toLowerCase()));
  const y = new Set(b.map((s) => s.toLowerCase()));
  return x.size === y.size && [...x].every((s) => y.has(s));
};
const num = (v: unknown, max = 100000) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : null;
};
const NUMBERS = ["calories", "fat", "saturatedFat", "carbs", "fiber", "sugar", "addedSugar", "protein", "sodium"] as const;

function section<T>(current: T, suggested: T | null, changes: string[], same: (a: T, b: T) => boolean): Section<T> {
  if (suggested === null || same(current, suggested)) return { suggested: current, changes: [], changed: false };
  return { suggested, changes: changes.length ? changes : ["The AI changed this section."], changed: true };
}

// A line for the wizard's progress list; "waiting": the step still going (the wizard shows a timer)
// "status": an update to the line still going ("Home AI is writing… 420 words"), not a new line.
// "skip": this service can be skipped (there's another to ask after it).
export type EnhanceStep = { text: string; waiting?: boolean; status?: boolean; skip?: { id: string; name: string } };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function suggestEnhancements(db: Db, ai: AiService, recipeId: number, onStep: (s: EnhanceStep) => void = () => {}, o: { skip?: string[]; signal?: AbortSignal } = {}): Promise<Enhancement> {
  await requireEnhance(db, ai);
  const r = await loadRecipe(db, recipeId, null);
  const stepCount = r.steps.filter((x) => !x.section).length;
  onStep({ text: `Reading “${r.title}”: ${plural(r.ingredients.filter((i) => !i.section).length, "ingredient")}, ${plural(stepCount, "step")}` });
  const household = (await db.select({ name: categories.name }).from(categories).orderBy(asc(categories.sortOrder), asc(categories.name))).map((c) => c.name);
  const known = (
    await db.select({ name: tags.name, n: count() }).from(tags).innerJoin(recipeTags, eq(recipeTags.tagId, tags.id)).groupBy(tags.name).orderBy(desc(count()), asc(tags.name)).limit(200)
  ).map((t) => t.name);

  const steps = stepLines(r.steps);
  const ingredients = ingredientLines(r.ingredients);
  const cats = r.categories.map((c) => c.name);
  const servings = r.servings ?? null;
  const user = [
    `Recipe: ${r.title}`,
    `Makes: ${servings ? `${servings} servings` : r.yieldText || "unknown (assume 4 servings)"}`,
    `Ingredients:\n${ingredients.map((l) => `- ${l}`).join("\n") || "(none)"}`,
    `Steps (${briefSteps(r.steps) ? "BRIEF: expand them" : "DETAILED: fill gaps only"}):\n${steps.map((l, i) => `${i + 1}. ${l}`).join("\n") || "(none)"}`,
    `Its categories: ${cats.join(", ") || "none"}`,
    `Its tags: ${r.tags.join(", ") || "none"}`,
    `The household's categories: ${household.join(", ") || "none"}`,
    `Tags already in use: ${known.join(", ") || "none"}`,
  ].join("\n\n");

  const onProgress = (p: AiProgress) => {
    if (p.kind === "asking") onStep({ text: `Asking ${p.service} (${p.model})…`, waiting: true, ...(p.next && { skip: { id: p.serviceId, name: p.service } }) });
    else if (p.kind === "thinking") onStep({ text: `${p.service} is thinking…`, status: true });
    else if (p.kind === "writing") onStep({ text: `${p.service} is writing… ${plural(p.words, "word")}`, status: true });
    else onStep({ text: `${p.from} didn't answer (${p.reason.replace(/^The AI service /, "it ").replace(/\.$/, "")}). Asking ${p.to}…` });
  };
  // Read as it's written: up to 3 minutes to start (loading, thinking), then only a quiet minute
  // ends it, so a slow home model that keeps writing finishes
  const { json, service } = await ai.ask("recipe", SYSTEM, user, { maxTokens: 8000, minWaitSec: 180, onProgress, stream: true, signal: o.signal, skip: o.skip });
  onStep({ text: `Answer received from ${service.name}` });
  // Readable JSON but none of the parts ({"error": ...}, {}): not "the recipe looks good"
  if (!["steps", "ingredients", "categories", "tags"].some((k) => json[k] != null)) {
    await logEvent(db, { category: "ai", level: "warning", source: service.name, event: `${service.name} sent no suggestions for “${r.title}”`, detail: `It said: ${JSON.stringify(json).slice(0, 600)}` });
    throw new AiError(`${service.name} didn't send any suggestions. Try again, or try another AI service.`);
  }
  const changesOf = (k: string) => textList(json[k], 10, 300) ?? [];

  // Instructions: numbering the AI may have kept is dropped
  const sSteps = textList(json.steps, 300, 10000)?.map((s) => s.replace(/^(?:step\s*)?\d+[.)]\s+/i, "")) ?? null;
  const rawIngredients = textList(json.ingredients, 500, 1000)?.map((s) => tidyIngredientLine(s.replace(/^[-•*]\s+/, ""))) ?? null;
  // The AI corrects and tidies; it doesn't add. A line for an ingredient the recipe doesn't have
  // is dropped, with any change note about it.
  const { kept: sIngredients, dropped } = rawIngredients ? onlyTheRecipes(ingredients, rawIngredients) : { kept: null, dropped: [] as string[] };

  // Nutrition: its own request, worked out from each ingredient (as the check suggests them) and
  // added up here, the same way as Estimate / Re-analyze, so accepting it gives the numbers
  // Re-analyze would. It failing doesn't stop the rest of the check.
  let sNutrition: Nutrition | null = null;
  const nutritionChanges: string[] = [];
  const forNutrition = (sIngredients ?? ingredients).map((l) => (l.startsWith("# ") ? { raw: l.slice(2), section: l.slice(2) } : { raw: l })) as Ingredient[];
  // Already worked out one ingredient at a time (Re-analyze, or Calculate nutrition in Discover)
  // and the check leaves the ingredients as they are: nothing new to work out
  const sameIngredients = !sIngredients || sIngredients.join("\n") === ingredients.join("\n");
  const alreadyWorkedOut = !!r.nutrition?.perIngredient?.length && !r.nutrition.outdated && sameIngredients;
  if (!alreadyWorkedOut && forNutrition.some((i) => !i.section && i.raw.trim())) {
    onStep({ text: "Working out nutrition from each ingredient…", waiting: true });
    try {
      sNutrition = await estimateNutrition(ai, { title: r.title, servings: r.servings ?? null, yieldText: r.yieldText, ingredients: forNutrition }, { skip: o.skip, signal: o.signal });
      const was = r.nutrition?.calories;
      nutritionChanges.push(`Worked out from each ingredient: about ${Math.round(sNutrition.calories!)} kcal per serving${was != null ? ` (was ${Math.round(was)})` : ""}.`);
    } catch (e) {
      onStep({ text: `Nutrition couldn't be worked out: ${(e as Error).message}` });
      await logEvent(db, { category: "ai", level: "warning", source: "Improve with AI", event: `Nutrition couldn't be worked out for “${r.title}”`, detail: (e as Error).message });
    }
  }
  const sameNutrition = (a: Nutrition | null, b: Nutrition | null) => (!a || !b ? a === b : NUMBERS.every((k) => (a[k] ?? null) === (b[k] ?? null)));

  // Categories: matched to the household's own names; anything else is new
  const byLower = new Map(household.map((c) => [c.toLowerCase(), c]));
  const sCats = textList(json.categories, 10, 100);
  const categoriesOut = sCats ? [...new Set(sCats.map((c) => byLower.get(c.toLowerCase()) ?? c))] : cats;
  const newCategories = categoriesOut.filter((c) => !byLower.has(c.toLowerCase()));
  const sTags = textList(json.tags, 30, 60);
  const tagsOut = sTags ? [...new Set(sTags.map(cleanTag).filter(Boolean))] : r.tags;
  const organizeChanged = !sameSet(categoriesOut, cats) || !sameSet(tagsOut, r.tags);
  const organizeChanges = organizeChanged ? (changesOf("organizeChanges").length ? changesOf("organizeChanges") : ["The AI changed the categories or tags."]) : [];

  const stepSection = section(steps, sSteps, changesOf("stepChanges"), sameLines);
  const mode = !stepSection.changed ? null : json.stepMode === "expanded" || json.stepMode === "filled" ? json.stepMode : briefSteps(r.steps) ? "expanded" : "filled";
  const out: Enhancement = {
    steps: { ...stepSection, mode },
    ingredients: section(ingredients, sIngredients, withoutNotesAbout(changesOf("ingredientChanges"), dropped), sameLines),
    nutrition: section(r.nutrition ?? null, sNutrition, nutritionChanges, sameNutrition),
    organize: organizeChanged
      ? { categories: categoriesOut, newCategories, tags: tagsOut, changes: organizeChanges, changed: true }
      : { categories: cats, newCategories: [], tags: r.tags, changes: [], changed: false },
  };
  for (const text of summary(out, steps, ingredients, cats, r.tags)) onStep({ text });
  return out;
}

// One line per section for the progress list: what the AI found
function summary(e: Enhancement, steps: string[], ingredients: string[], cats: string[], tagsBefore: string[]) {
  const notIn = (a: string[], b: string[]) => {
    const seen = new Set(b.map((x) => norm(x).toLowerCase()));
    return a.filter((x) => !seen.has(norm(x).toLowerCase()));
  };
  const s = e.steps;
  const heads = s.suggested.filter((l) => l.startsWith("# ")).length;
  const lines = s.suggested.length - heads;
  const stepsLine = !s.changed
    ? "Instructions: no changes"
    : s.mode === "expanded"
      ? `Instructions: expanded into ${heads ? `${plural(heads, "part")}, ` : ""}${plural(lines, "step")}`
      : `Instructions: ${plural(notIn(s.suggested, steps).length || 1, "step")} filled in or fixed`;
  // (nothing is ever added: every new line is a corrected one)
  const fixed = notIn(e.ingredients.suggested.filter((l) => !l.startsWith("# ")), ingredients).length;
  const ingLine = !e.ingredients.changed ? "Ingredients: no changes" : `Ingredients: ${fixed ? `${fixed} corrected` : "regrouped"}`;
  const n = e.nutrition.suggested;
  const nutLine = e.nutrition.changed && n ? `Nutrition: estimated, ${n.calories} kcal per serving` : "Nutrition: no changes";
  const o = e.organize;
  const newCats = o.newCategories.length;
  const catsAdded = notIn(o.categories, cats).length - newCats;
  const tagsAdded = notIn(o.tags, tagsBefore).length;
  const tagsGone = notIn(tagsBefore, o.tags).length;
  const parts = [newCats && plural(newCats, "new category", "new categories"), catsAdded > 0 && `${plural(catsAdded, "category", "categories")} added`, tagsAdded && `${plural(tagsAdded, "tag")} added`, tagsGone && `${plural(tagsGone, "tag")} removed`].filter(Boolean);
  const orgLine = !o.changed ? "Categories and tags: no changes" : `Categories and tags: ${parts.join(", ") || "changed"}`;
  return [stepsLine, ingLine, nutLine, orgLine];
}

// ---------- apply and undo ----------

// The sections the person kept in the wizard (each one optional)
export const applyInput = z
  .object({
    steps: z.array(z.string().max(10000)).max(300).optional(),
    ingredients: z.array(z.string().max(1000)).max(500).optional(),
    nutrition: nutritionInput.nullable().optional(),
    categories: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  })
  .strict();

// Save only the sections sent, in one transaction (a failed save changes nothing). New categories
// are created; tags are matched without case. The version history keeps what it was before.
export async function applyEnhancements(db: Db, recipeId: number, body: z.infer<typeof applyInput>, userId: number | null) {
  await db.transaction(async (tx) => {
    const [r] = await tx.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, recipeId));
    if (!r) throw notFound("Recipe");
    await saveRecipe(tx, recipeId, { steps: body.steps, ingredients: body.ingredients, nutrition: body.nutrition, categories: body.categories, tags: body.tags } as RecipeInput, userId);
  });
}

// ---------- the AI doesn't add ingredients ----------

// The words that name an ingredient: no amounts, units, prep or size words
const NOT_NAMES = new Set("a an and or of to the for with into in on plus taste tasting optional fresh freshly ground chopped diced minced sliced grated shredded crushed peeled seeded large small medium big whole halved quartered cubed packed heaping level divided about cup cups c tbsp tablespoon tablespoons tsp teaspoon teaspoons oz ounce ounces lb lbs pound pounds g gram grams kg ml l liter liters pinch dash can cans clove cloves bunch sprig sprigs stick sticks slice slices piece pieces package pkg jar bottle head heads stalk stalks handful as needed more serving garnish fine finely roughly thinly thickly cold warm hot room temperature softened melted".split(" "));
const nameWords = (line: string) =>
  line
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !NOT_NAMES.has(w))
    .map((w) => w.replace(/(ies)$/, "y").replace(/(oes|ses|xes)$/, (m) => m.slice(0, -2)).replace(/s$/, ""));

// Each suggested line must be about an ingredient the recipe has: most of its name words appear
// in one original line. Headings are fine (grouping), and so are lines with no name words left.
export function onlyTheRecipes(original: string[], suggested: string[]) {
  const originals = original.filter((l) => !l.startsWith("# ")).map((l) => new Set(nameWords(l)));
  const dropped: string[] = [];
  const kept = suggested.filter((line) => {
    if (line.startsWith("# ")) return true;
    const words = nameWords(line);
    if (!words.length) return true;
    const known = originals.some((o) => words.filter((w) => o.has(w)).length / words.length >= 0.5);
    if (!known) dropped.push(line);
    return known;
  });
  return { kept, dropped };
}

// A change note about a dropped line goes too ("Added salt and pepper to season.")
function withoutNotesAbout(changes: string[], dropped: string[]) {
  if (!dropped.length) return changes;
  const words = new Set(dropped.flatMap(nameWords));
  return changes.filter((c) => !nameWords(c).some((w) => words.has(w)));
}
