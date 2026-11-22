import { and, eq, gte, inArray, lte, desc, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { aisleChoices, groceryItems, mealPlan, pantryItems, recipes, type Ingredient, type Nutrition } from "../db/schema.js";
import { AiError, type AiProgress, type AiService } from "./ai.js";

// One line for a progress popup, from what the AI service is doing
export const progressLine = (p: AiProgress) =>
  p.kind === "asking" ? `Asking ${p.service} (${p.model})…` : p.kind === "thinking" ? `${p.service} is thinking…` : p.kind === "writing" ? `${p.service} is writing… ${p.words} words` : `${p.from} didn't answer. Asking ${p.to}…`;
import { AISLE_IDS, itemKey } from "./grocery.js";
import type { JobQueue } from "./jobs.js";
import type { EventBus } from "./events.js";
import { logEvent } from "./appLog.js";

// The quick AI jobs: nutrition estimates, sorting grocery items into aisles, and meal ideas.

const num = (v: unknown, max = 100000) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : null;
};

// ---------- nutrition ----------

// The AI looks up each ingredient line (amount as given, from standard food tables); RecipeHub adds
// the lines up and divides by the servings. Asking for one per-serving total let the AI guess,
// and the guess barely moved when ingredients changed (4 cups of sugar added, same calories).
const NUTRITION_SYSTEM = `You estimate nutrition for a recipe, one ingredient at a time. Reply with JSON only:
{"ingredients": [{"line": "<the ingredient line as given>", "grams": 0, "calories": 0, "fat": 0, "saturatedFat": 0, "carbs": 0, "fiber": 0, "sugar": 0, "addedSugar": 0, "protein": 0, "sodium": 0}], "servingSize": "", "note": ""}
One entry per ingredient line, in the order given. Each entry is for the WHOLE amount on that line (not per serving): "grams" is its weight, then calories (kcal), sodium (mg) and the rest in grams, from standard food tables (USDA) for that food and amount. "sugar" is total sugars; "addedSugar" is the part from added sugar, syrup, honey and the like (not fruit or milk). If an amount is missing, assume a typical amount. For an item like "salt for the water" or "oil for frying", count only what's eaten. "servingSize": how much one serving of the finished dish is, in kitchen measures with an approximate weight, like "About 1½ cups (340 g)". "note": one short sentence on what you assumed, or "".`;

const NUMBERS = ["calories", "fat", "saturatedFat", "carbs", "fiber", "sugar", "addedSugar", "protein", "sodium"] as const;
const round1 = (n: number) => Math.round(n * 10) / 10;

// skip: AI services to leave out (ones skipped as too slow during the AI check)
// servingSize: one you picked (like "1 cookie (40 g)"): the AI is told it, and it's kept on the result
export async function estimateNutrition(ai: AiService, r: { title: string; servings: number | null; yieldText: string | null; ingredients: Ingredient[] }, opts: { skip?: string[]; signal?: AbortSignal; onStep?: (text: string) => void; servingSize?: string } = {}): Promise<Nutrition> {
  const lines = r.ingredients.filter((i) => !i.section).map((i) => `- ${i.raw}`);
  if (!lines.length) throw new AiError("Add the ingredients first: nutrition is worked out from them.");
  const step = opts.onStep ?? (() => {});
  step(`Reading ${lines.length === 1 ? "1 ingredient" : `${lines.length} ingredients`}`);
  const servings = r.servings ?? null;
  // No servings given: the whole recipe is 1 serving (and the AI is told so, so its serving size matches)
  const user = `Recipe: ${r.title}\nMakes: ${servings ? `${servings} servings` : r.yieldText ? `${r.yieldText} (count it as 1 serving)` : "1 serving"}${opts.servingSize ? `\nServing size: ${opts.servingSize}` : ""}\nIngredients:\n${lines.join("\n")}`;
  // Room for each line's numbers (about 300 tokens), plus at least 4000 so a model that thinks
  // first still gets to the answer; OpenRouter models are asked to keep the thinking short
  const { json } = await ai.ask("quick", NUTRITION_SYSTEM, user, { maxTokens: Math.min(16000, Math.max(4000, 800 + 300 * lines.length)), reasoning: "low", ...(opts.skip?.length ? { skip: opts.skip } : {}), ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.onStep ? { onProgress: (p: AiProgress) => step(progressLine(p)) } : {}) });
  step("Adding up each ingredient");
  const per = Array.isArray(json.ingredients) ? (json.ingredients as Record<string, unknown>[]).filter((x) => x && typeof x === "object") : null;
  const common = {
    source: "ai" as const,
    servings: servings ?? 1,
    servingSize: opts.servingSize?.trim() ? opts.servingSize.trim().slice(0, 100) : typeof json.servingSize === "string" && json.servingSize.trim() ? json.servingSize.trim().slice(0, 100) : null,
    note: typeof json.note === "string" && json.note.trim() ? json.note.trim().slice(0, 300) : null,
  };
  let out: Nutrition;
  if (per) {
    // added up here: each line is the whole amount, so divide by the servings (1 when unknown)
    const by = servings ?? 1;
    const total = (k: (typeof NUMBERS)[number]) => per.reduce((sum, x) => sum + (num(x[k], k === "sodium" ? 1e7 : 1e6) ?? 0), 0);
    if (!per.some((x) => num(x.calories, 1e6) !== null)) throw new AiError("The AI didn't give a calorie estimate. Try again.");
    out = { ...(Object.fromEntries(NUMBERS.map((k) => [k, round1(total(k) / by)])) as Record<(typeof NUMBERS)[number], number>), ...common };
    out.perIngredient = per
      .map((x) => ({ line: typeof x.line === "string" ? x.line.trim().slice(0, 200) : "", grams: num(x.grams, 1e6), calories: num(x.calories, 1e6) ?? 0 }))
      .filter((x) => x.line)
      .sort((a, b) => b.calories - a.calories)
      .slice(0, 100);
  } else {
    // an AI that still answers with one total per serving
    out = { ...(Object.fromEntries(NUMBERS.map((k) => [k, num(json[k], k === "calories" ? 20000 : 100000)])) as Record<(typeof NUMBERS)[number], number | null>), ...common };
  }
  if (out.calories === null) throw new AiError("The AI didn't give a calorie estimate. Try again.");
  return out;
}

// ---------- portions ----------

// A recipe with no servings: a few sensible ways to portion it, worked out from the ingredients
const PORTION_SYSTEM = `You suggest how to portion a home recipe that doesn't say how many it makes. Reply with JSON only:
{"totalGrams": 0, "options": [{"servings": 0, "servingSize": "", "yieldText": ""}]}
"totalGrams": about how much the finished dish weighs, from the ingredients (after cooking or baking). Give 2 or 3 options a home cook would actually use, from smaller to larger portions, each dividing that weight sensibly: for cookies, say 1 cookie at 25 g or at 40 g; for a soup, bowls of about 1½ cups; for a cake, slices. "servings": how many portions, a whole number. "servingSize": one portion in kitchen terms with its weight, like "1 cookie (40 g)" or "About 1½ cups (350 g)". "yieldText": what the whole recipe makes, like "28 cookies", "6 bowls" or "1 loaf, 12 slices".`;

export type Portion = { servings: number; servingSize: string; yieldText: string | null };
export async function suggestPortions(ai: AiService, r: { title: string; ingredients: Ingredient[] }): Promise<{ totalGrams: number | null; options: Portion[] }> {
  const lines = r.ingredients.filter((i) => !i.section).map((i) => `- ${i.raw}`);
  if (!lines.length) throw new AiError("Add the ingredients first: portions are worked out from them.");
  const { json } = await ai.ask("quick", PORTION_SYSTEM, `Recipe: ${r.title}\nIngredients:\n${lines.join("\n")}`, { maxTokens: 4000, reasoning: "low" });
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : null);
  const options = (Array.isArray(json.options) ? (json.options as Record<string, unknown>[]) : [])
    .filter((o) => o && typeof o === "object")
    .map((o) => ({ servings: Math.round(num(o.servings, 1000) ?? 0), servingSize: text(o.servingSize), yieldText: text(o.yieldText) }))
    .filter((o): o is Portion => o.servings >= 1 && !!o.servingSize)
    .slice(0, 3);
  if (!options.length) throw new AiError("The AI didn't suggest any portions. Type in how many servings it makes.");
  const total = num(json.totalGrams, 1e6);
  return { totalGrams: total ? Math.round(total) : null, options };
}

// ---------- grocery aisles ----------

const AISLE_SYSTEM = `You sort grocery items into supermarket aisles. The aisles are: ${AISLE_IDS.join(", ")}.
Reply with JSON only: {"aisles": {"<item exactly as given>": "<aisle>"}}. Use "other" only when nothing fits.`;

// Items the word list couldn't place ("other"): ask AI, and remember the answer for next time
// (a later "pizza dough" goes straight to the same aisle without asking).
export function registerAisleSorting(queue: JobQueue, d: { db: Db; ai: AiService; events: EventBus }) {
  queue.handle("sort-aisles", async () => {
    const items = await d.db.select({ id: groceryItems.id, name: groceryItems.name }).from(groceryItems).where(and(eq(groceryItems.aisle, "other"), eq(groceryItems.aisleBy, "words")));
    const pantry = await d.db.select({ id: pantryItems.id, name: pantryItems.name }).from(pantryItems).where(eq(pantryItems.aisle, "other"));
    const names = [...new Set([...items, ...pantry].map((i) => i.name))].slice(0, 60);
    if (!names.length || !(await d.ai.active("quick"))) return { sorted: 0 };
    const { json } = await d.ai.ask("quick", AISLE_SYSTEM, names.map((n) => `- ${n}`).join("\n"), { maxTokens: 1500 });
    const given = (json.aisles && typeof json.aisles === "object" ? json.aisles : json) as Record<string, unknown>;
    const byKey = new Map<string, string>();
    for (const [name, aisle] of Object.entries(given))
      if (typeof aisle === "string" && aisle !== "other" && (AISLE_IDS as readonly string[]).includes(aisle)) {
        byKey.set(itemKey(name), aisle);
        await rememberAisle(d.db, name, aisle, "ai");
      }
    let sorted = 0;
    for (const i of items) {
      const aisle = byKey.get(itemKey(i.name));
      // asked once: left in Other if AI couldn't place it either (you can still move it)
      await d.db.update(groceryItems).set({ aisle: aisle ?? "other", aisleBy: "ai" }).where(eq(groceryItems.id, i.id));
      if (aisle) sorted++;
    }
    for (const p of pantry) {
      const aisle = byKey.get(itemKey(p.name));
      if (aisle) (await d.db.update(pantryItems).set({ aisle }).where(eq(pantryItems.id, p.id)), sorted++);
    }
    if (sorted) {
      d.events.emit({ topic: "grocery", by: null });
      d.events.emit({ topic: "pantry", by: null });
      await logEvent(d.db, { category: "ai", level: "info", source: "Grocery list", event: `Sorted ${sorted} item${sorted === 1 ? "" : "s"} into aisles` });
    }
    return { sorted };
  });
}

// Queue a sort unless one is already waiting
export async function sortAislesSoon(db: Db, queue: JobQueue) {
  if (await queue.pending("sort-aisles")) return;
  await queue.enqueue("sort-aisles", {}, null);
}

// The aisle you (or AI) chose for these items before, if any
export async function learnedAisles(db: Db, names: string[]): Promise<Map<string, string>> {
  const keys = [...new Set(names.map(itemKey).filter(Boolean))];
  if (!keys.length) return new Map();
  const rows = await db.select().from(aisleChoices).where(inArray(aisleChoices.key, keys));
  return new Map(rows.map((r) => [r.key, r.aisle]));
}
// Remember a choice (yours wins over AI's: AI never overwrites one you made)
export async function rememberAisle(db: Db, name: string, aisle: string, by: "ai" | "you") {
  const key = itemKey(name);
  if (!key) return;
  await db
    .insert(aisleChoices)
    .values({ key, aisle, by })
    .onConflictDoUpdate({ target: aisleChoices.key, set: { aisle, by, updatedAt: new Date() }, ...(by === "ai" ? { setWhere: sql`${aisleChoices.by} = 'ai'` } : {}) });
}

// ---------- meal ideas ----------

export interface MealIdea {
  title: string;
  why: string;
  recipeId: number | null; // one of your recipes, or null for a new idea
  uses: string[]; // pantry items it uses
}

const IDEAS_SYSTEM = `You suggest meals for a household. Reply with JSON only:
{"ideas": [{"title": "", "why": "", "recipeId": null, "uses": [""]}]}
Give 6 ideas. Prefer their own recipes (use the exact id from the list) when they fit, and add a few new ideas (recipeId null) for variety. Favor what's in the pantry, especially things that expire soon, and avoid repeating what they ate recently. "why": one short sentence. "uses": pantry items it uses.`;

export async function mealIdeas(db: Db, ai: AiService, opts: { ask?: string; today: string }): Promise<MealIdea[]> {
  const pantry = await db.select({ name: pantryItems.name, staple: pantryItems.staple, expiresOn: pantryItems.expiresOn }).from(pantryItems);
  const mine = await db.select({ id: recipes.id, title: recipes.title }).from(recipes).orderBy(desc(recipes.updatedAt)).limit(300);
  const from = new Date(`${opts.today}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 28);
  const recent = await db
    .select({ title: mealPlan.title, recipe: recipes.title })
    .from(mealPlan)
    .leftJoin(recipes, eq(recipes.id, mealPlan.recipeId))
    .where(and(gte(mealPlan.date, from.toISOString().slice(0, 10)), lte(mealPlan.date, opts.today)));
  const user = [
    opts.ask ? `They asked for: ${opts.ask}` : "",
    `Pantry: ${pantry.filter((p) => !p.staple).map((p) => (p.expiresOn ? `${p.name} (use by ${p.expiresOn})` : p.name)).join(", ") || "(empty)"}`,
    `Staples they always have: ${pantry.filter((p) => p.staple).map((p) => p.name).join(", ") || "(none listed)"}`,
    `Eaten in the last 4 weeks: ${[...new Set(recent.map((r) => r.recipe ?? r.title).filter(Boolean))].join(", ") || "(nothing planned)"}`,
    `Their recipes (id: title):\n${mine.map((r) => `${r.id}: ${r.title}`).join("\n") || "(none yet)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const { json } = await ai.ask("quick", IDEAS_SYSTEM, user, { maxTokens: 1500 });
  const ids = new Set(mine.map((r) => r.id));
  const list = Array.isArray(json.ideas) ? json.ideas : Array.isArray(json) ? json : [];
  return (list as Record<string, unknown>[])
    .filter((i) => i && typeof i.title === "string" && i.title.trim())
    .slice(0, 8)
    .map((i) => {
      const id = typeof i.recipeId === "number" ? i.recipeId : typeof i.recipeId === "string" && /^\d+$/.test(i.recipeId) ? Number(i.recipeId) : null;
      const recipeId = id !== null && ids.has(id) ? id : null;
      return {
        title: recipeId ? mine.find((r) => r.id === recipeId)!.title : String(i.title).trim().slice(0, 200),
        why: typeof i.why === "string" ? i.why.trim().slice(0, 300) : "",
        recipeId,
        uses: (Array.isArray(i.uses) ? i.uses : []).filter((u): u is string => typeof u === "string").slice(0, 8),
      };
    });
}
