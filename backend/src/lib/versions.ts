import { and, desc, eq, sql } from "drizzle-orm";
import { recipeVersions, recipes, users, type RecipeVersionData } from "../db/schema.js";
import { HttpError, notFound } from "./errors.js";
import type { Db } from "../db/index.js";
import { isOn } from "./features.js";
import { refreshSearch, type Tx } from "./recipes.js";

// Recipe versions (the "Recipe versioning" switch). The recipe row always holds the active
// version's content; a version is a full copy of it. New versions come from adding a recipe (v1),
// the AI check and hand edits saved as new. Everything else that changes the recipe, nutrition
// included, goes into the active version, so it always matches the recipe, even while versioning
// is switched off.

type RecipeRow = typeof recipes.$inferSelect;
type Source = "import" | "created" | "ai" | "edit";

export function versionData(r: RecipeRow): RecipeVersionData {
  return {
    title: r.title,
    description: r.description,
    ingredients: r.ingredients,
    steps: r.steps,
    servings: r.servings,
    yieldText: r.yieldText,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    totalMinutes: r.totalMinutes,
    notes: r.notes,
    nutrition: r.nutrition ?? null,
  };
}

// What changed between two versions, in words, in a fixed order. Servings and yield are one
// thing ("servings"), and so are the three times ("times").
const PARTS: [string, (keyof RecipeVersionData)[]][] = [
  ["title", ["title"]],
  ["description", ["description"]],
  ["ingredients", ["ingredients"]],
  ["steps", ["steps"]],
  ["servings", ["servings", "yieldText"]],
  ["times", ["prepMinutes", "cookMinutes", "totalMinutes"]],
  ["notes", ["notes"]],
  ["nutrition", ["nutrition"]],
];
export function changedParts(before: RecipeVersionData, after: RecipeVersionData) {
  const same = (k: keyof RecipeVersionData) => JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null);
  return PARTS.filter(([, keys]) => keys.some((k) => !same(k))).map(([name]) => name);
}
// "the title", "ingredients and steps", "the times and notes"
export function describeParts(parts: string[]) {
  const list = parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return ["title", "description", "times"].includes(parts[0]) ? `the ${list}` : list;
}

async function load(db: Tx, recipeId: number) {
  const [r] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
  return r ?? null;
}

async function count(db: Tx, recipeId: number) {
  return (await db.select({ id: recipeVersions.id }).from(recipeVersions).where(eq(recipeVersions.recipeId, recipeId))).length;
}

async function insertVersion(db: Tx, r: RecipeRow, number: number, source: Source, summary: string, userId: number | null) {
  await db.update(recipeVersions).set({ active: false }).where(and(eq(recipeVersions.recipeId, r.id), eq(recipeVersions.active, true)));
  await db.insert(recipeVersions).values({ recipeId: r.id, number, source, summary, data: versionData(r), active: true, createdBy: userId });
}

// A recipe was just added: it's v1
export async function firstVersion(db: Tx, recipeId: number, source: "import" | "created", userId: number | null) {
  if (!(await isOn(db as Db, "recipeVersions"))) return;
  const r = await load(db, recipeId);
  if (r && !(await count(db, recipeId))) await insertVersion(db, r, 1, source, source === "import" ? "Imported" : "Added", userId);
}

// Before changing a recipe that has no versions yet (added while versioning was off): v1 is the
// recipe as it is now, so the version about to be made has something to go back to
export async function ensureVersions(db: Tx, recipeId: number) {
  if (!(await isOn(db as Db, "recipeVersions"))) return;
  const r = await load(db, recipeId);
  if (r && !(await count(db, recipeId))) await insertVersion(db, r, 1, r.sourceUrl ? "import" : "created", r.sourceUrl ? "Imported" : "Added", r.createdBy);
}

// The recipe was changed: it becomes a new active version (numbers keep counting up, even after
// a delete). With versioning off, the active version takes the change instead.
export async function newVersion(db: Tx, recipeId: number, source: "ai" | "edit", summary: string, userId: number | null) {
  if (!(await isOn(db as Db, "recipeVersions"))) return syncActive(db, recipeId);
  const r = await load(db, recipeId);
  if (!r) return;
  const [last] = await db.select({ number: recipeVersions.number }).from(recipeVersions).where(eq(recipeVersions.recipeId, recipeId)).orderBy(desc(recipeVersions.number)).limit(1);
  await insertVersion(db, r, (last?.number ?? 0) + 1, source, summary, userId);
}

// The recipe was changed in place (saved to the current version, nutrition, versioning off):
// the active version gets the same content
export async function syncActive(db: Tx, recipeId: number) {
  const r = await load(db, recipeId);
  if (!r) return;
  await db
    .update(recipeVersions)
    .set({ data: versionData(r) })
    .where(and(eq(recipeVersions.recipeId, recipeId), eq(recipeVersions.active, true)));
}

// ---------- the history ----------

async function recipeOrNotFound(db: Tx, recipeId: number) {
  const r = await load(db, recipeId);
  if (!r) throw notFound("Recipe");
  return r;
}

// Every version, newest first, without its content (open one for that)
export async function listVersions(db: Tx, recipeId: number) {
  await recipeOrNotFound(db, recipeId);
  await ensureVersions(db, recipeId);
  return db
    .select({ number: recipeVersions.number, source: recipeVersions.source, summary: recipeVersions.summary, active: recipeVersions.active, createdAt: recipeVersions.createdAt, by: sql<string | null>`coalesce(${users.displayName}, ${users.username})` })
    .from(recipeVersions)
    .leftJoin(users, eq(users.id, recipeVersions.createdBy))
    .where(eq(recipeVersions.recipeId, recipeId))
    .orderBy(desc(recipeVersions.number));
}

export async function getVersion(db: Tx, recipeId: number, number: number) {
  const [v] = await db
    .select({ number: recipeVersions.number, source: recipeVersions.source, summary: recipeVersions.summary, active: recipeVersions.active, createdAt: recipeVersions.createdAt, data: recipeVersions.data })
    .from(recipeVersions)
    .where(and(eq(recipeVersions.recipeId, recipeId), eq(recipeVersions.number, number)));
  if (!v) throw notFound("Version");
  return v;
}

// The recipe becomes this version (its tags, categories, photo and everyone's favorites and notes stay)
export async function activateVersion(db: Db, recipeId: number, number: number) {
  await db.transaction(async (tx) => {
    const v = await getVersion(tx, recipeId, number);
    const d = v.data;
    await tx
      .update(recipes)
      .set({ title: d.title, description: d.description, ingredients: d.ingredients, steps: d.steps, servings: d.servings, yieldText: d.yieldText, prepMinutes: d.prepMinutes, cookMinutes: d.cookMinutes, totalMinutes: d.totalMinutes, notes: d.notes, nutrition: d.nutrition, updatedAt: new Date() })
      .where(eq(recipes.id, recipeId));
    await tx.update(recipeVersions).set({ active: false }).where(and(eq(recipeVersions.recipeId, recipeId), eq(recipeVersions.active, true)));
    await tx.update(recipeVersions).set({ active: true }).where(and(eq(recipeVersions.recipeId, recipeId), eq(recipeVersions.number, number)));
    await refreshSearch(tx, [recipeId]);
  });
}

// Any version but the active one (so a recipe always keeps at least one)
export async function deleteVersion(db: Tx, recipeId: number, number: number) {
  const v = await getVersion(db, recipeId, number);
  if (v.active) throw new HttpError(409, "This is the active version. Set another version active first.");
  await db.delete(recipeVersions).where(and(eq(recipeVersions.recipeId, recipeId), eq(recipeVersions.number, number)));
}

// ---------- a backup from before versions ----------

// What the old one-level "Undo AI changes" kept: the recipe from before an AI change
interface OldUndoPoint {
  recipeId: number;
  data: { steps?: RecipeVersionData["steps"]; ingredients?: RecipeVersionData["ingredients"]; nutrition?: RecipeVersionData["nutrition"]; applied?: string[] };
  createdAt?: string;
}

// After a restore: every recipe without versions gets them, as the upgrade did. v1 is the recipe;
// with an old undo point, v1 is the recipe from before that AI change (only the parts it touched;
// an undo point that doesn't say puts back steps, ingredients and nutrition) and v2 is the recipe.
export async function versionsAfterRestore(db: Tx, undoPoints: OldUndoPoint[]) {
  const undo = new Map(undoPoints.map((p) => [Number(p.recipeId), p]));
  const missing = await db
    .select()
    .from(recipes)
    .where(sql`not exists (select 1 from ${recipeVersions} v where v.recipe_id = ${recipes.id})`);
  for (const r of missing) {
    const now = versionData(r);
    const p = undo.get(r.id);
    const source = r.sourceUrl ? "import" : "created";
    const summary = r.sourceUrl ? "Imported" : "Added";
    if (!p) {
      await db.insert(recipeVersions).values({ recipeId: r.id, number: 1, source, summary, data: now, active: true, createdBy: r.createdBy, createdAt: r.createdAt });
      continue;
    }
    const did = new Set(p.data.applied ?? ["steps", "ingredients", "nutrition"]);
    const before: RecipeVersionData = {
      ...now,
      ...(did.has("steps") && p.data.steps && { steps: p.data.steps }),
      ...(did.has("ingredients") && p.data.ingredients && { ingredients: p.data.ingredients }),
      ...(did.has("nutrition") && p.data.nutrition !== undefined && { nutrition: p.data.nutrition }),
    };
    await db.insert(recipeVersions).values({ recipeId: r.id, number: 1, source, summary, data: before, active: false, createdBy: r.createdBy, createdAt: r.createdAt });
    await db.insert(recipeVersions).values({ recipeId: r.id, number: 2, source: "ai", summary: "AI check", data: now, active: true, createdAt: p.createdAt ? new Date(p.createdAt) : new Date() });
  }
}
