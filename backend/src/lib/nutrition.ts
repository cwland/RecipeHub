import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { jobs, recipes, type Ingredient } from "../db/schema.js";
import type { AiService } from "./ai.js";
import { estimateNutrition } from "./aiHelpers.js";
import { logEvent } from "./appLog.js";
import type { EventBus } from "./events.js";
import { isOn } from "./features.js";
import type { JobQueue } from "./jobs.js";
import { syncActive } from "./versions.js";

// Keeping nutrition in step with the ingredients (the "Auto nutrition" switch).

// The ingredient lines that count for nutrition: no headings, and the same no matter the
// order, spacing or capital letters. A line listed twice is kept twice (it's twice as much).
const lines = (list: Pick<Ingredient, "raw" | "section">[]) =>
  list
    .filter((i) => !i.section)
    .map((i) => i.raw.trim().replace(/\s+/g, " ").toLowerCase())
    .sort();

// Did the ingredients change enough that nutrition worked out from them is out of date?
export function ingredientsChanged(before: Pick<Ingredient, "raw" | "section">[], after: Pick<Ingredient, "raw" | "section">[]) {
  const a = lines(before);
  const b = lines(after);
  return a.length !== b.length || a.some((line, i) => line !== b[i]);
}

// ---------- keeping it up to date ----------

interface Deps {
  db: Db;
  jobs: JobQueue;
}

// Is there anything to work nutrition out from?
const hasIngredients = (list: Pick<Ingredient, "raw" | "section">[]) => list.some((i) => !i.section && i.raw.trim());
const autoOn = async (db: Db) => (await isOn(db, "ai")) && (await isOn(db, "autoNutrition"));

// The ingredients of a recipe changed. With Auto nutrition on, nutrition is worked out again in
// the background (numbers you typed in are never replaced). Otherwise, or with no ingredients
// left to work from, the numbers there are marked out of date, so the recipe can say so.
export async function ingredientsUpdated(d: Deps, recipeId: number) {
  const [r] = await d.db.select({ nutrition: recipes.nutrition, ingredients: recipes.ingredients }).from(recipes).where(eq(recipes.id, recipeId));
  if (!r) return;
  if (r.nutrition?.source !== "you" && hasIngredients(r.ingredients) && (await autoOn(d.db))) return nutritionSoon(d, recipeId);
  if (r.nutrition && !r.nutrition.outdated) {
    await d.db.update(recipes).set({ nutrition: { ...r.nutrition, outdated: true } }).where(eq(recipes.id, recipeId));
    await syncActive(d.db, recipeId);
  }
}

// A recipe with no nutrition yet: work it out (Auto nutrition on, and ingredients to work from)
export async function nutritionWanted(d: Deps, recipeId: number) {
  const [r] = await d.db.select({ nutrition: recipes.nutrition, ingredients: recipes.ingredients }).from(recipes).where(eq(recipes.id, recipeId));
  if (!r || r.nutrition || !hasIngredients(r.ingredients) || !(await autoOn(d.db))) return;
  await nutritionSoon(d, recipeId);
}

// Just added. offered: the person adding it will be offered the AI check, which can estimate
// nutrition too, so with it on this waits until the check is done or skipped (no asking twice).
export async function recipeAdded(d: Deps, recipeId: number, opts: { offered: boolean }) {
  if (opts.offered && (await isOn(d.db, "aiEnhance"))) return;
  await nutritionWanted(d, recipeId);
}

// After the AI check was applied or undone. nutritionSet: it also set nutrition (nothing to do).
export async function afterAiCheck(d: Deps, recipeId: number, before: Pick<Ingredient, "raw" | "section">[], nutritionSet: boolean) {
  if (nutritionSet) return;
  const [r] = await d.db.select({ ingredients: recipes.ingredients }).from(recipes).where(eq(recipes.id, recipeId));
  if (!r) return;
  if (ingredientsChanged(before, r.ingredients)) await ingredientsUpdated(d, recipeId);
  else await nutritionWanted(d, recipeId);
}

// Queue a nutrition job for this recipe unless one is already waiting
async function nutritionSoon(d: Deps, recipeId: number) {
  const [waiting] = await d.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, "nutrition"), eq(jobs.status, "queued"), sql`${jobs.payload}->>'recipeId' = ${String(recipeId)}`))
    .limit(1);
  if (!waiting) await d.jobs.enqueue("nutrition", { recipeId }, null);
}

export function registerNutritionJob(queue: JobQueue, d: { db: Db; ai: AiService; events: EventBus }) {
  queue.handle("nutrition", async (job) => {
    const recipeId = Number(job.payload.recipeId);
    const [r] = await d.db.select().from(recipes).where(eq(recipes.id, recipeId));
    // Gone, typed in meanwhile, ingredients taken out, or switched off since it was queued: nothing to do
    if (!r || r.nutrition?.source === "you" || !hasIngredients(r.ingredients) || !(await autoOn(d.db))) return {};
    try {
      const nutrition = await estimateNutrition(d.ai, r);
      await d.db.update(recipes).set({ nutrition }).where(eq(recipes.id, recipeId));
      await syncActive(d.db, recipeId); // into the version it was worked out for (the active one)
    } catch (e) {
      await logEvent(d.db, { category: "ai", level: "error", source: "Auto nutrition", event: `Nutrition couldn't be worked out for ${r.title}`, detail: (e as Error).message });
      // the numbers there are for the old ingredients: say so on the recipe
      if (r.nutrition && !r.nutrition.outdated) {
        await d.db.update(recipes).set({ nutrition: { ...r.nutrition, outdated: true } }).where(eq(recipes.id, recipeId));
        await syncActive(d.db, recipeId);
        d.events.emit({ topic: "recipes", id: recipeId, by: null });
      }
      throw e;
    }
    d.events.emit({ topic: "recipes", id: recipeId, by: null });
    await logEvent(d.db, { category: "ai", level: "info", source: "Auto nutrition", event: `Nutrition worked out for ${r.title}` });
    return {};
  });
}
