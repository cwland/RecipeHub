import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { recipes } from "../db/schema.js";
import { notFound } from "./errors.js";
import { isOn } from "./features.js";
import { loadRecipe } from "./recipes.js";

// Public share links: /share/<token>, read-only, no sign-in. Every recipe has a token (made with
// it); New link replaces it. Settings › Recipes › Public share links turns them all off.

export const TOKEN = /^rcp_[0-9a-f]{32}$/;
export const sharePath = (token: string) => `/share/${token}`;

export async function shareTokenOf(db: Db, id: number) {
  const [r] = await db.select({ token: recipes.shareToken, title: recipes.title }).from(recipes).where(eq(recipes.id, id));
  if (!r) throw notFound("Recipe");
  return r;
}

export async function newShareToken(db: Db, id: number) {
  const [r] = await db
    .update(recipes)
    .set({ shareToken: sql`'rcp_' || replace(gen_random_uuid()::text, '-', '')` })
    .where(eq(recipes.id, id))
    .returning({ token: recipes.shareToken, title: recipes.title });
  if (!r) throw notFound("Recipe");
  return r;
}

// The recipe behind a link, as the public page shows it: the recipe itself, nothing about the
// household (no ids, who added it, ratings, private or recipe notes, collections)
// The recipe behind a working link (unknown, replaced, or links off: not found)
export async function recipeIdForToken(db: Db, token: string) {
  if (!TOKEN.test(token) || !(await isOn(db, "publicLinks"))) throw notFound("Recipe");
  const [row] = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.shareToken, token));
  if (!row) throw notFound("Recipe");
  return row.id;
}

export async function publicRecipe(db: Db, token: string) {
  const r = await loadRecipe(db, await recipeIdForToken(db, token), null);
  return {
    title: r.title,
    description: r.description,
    imageUrl: r.imageUrl,
    ingredients: r.ingredients,
    steps: r.steps,
    servings: r.servings,
    yieldText: r.yieldText,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    totalMinutes: r.totalMinutes,
    nutrition: r.nutrition,
    sourceUrl: r.sourceUrl,
    sourceName: r.sourceName,
    tags: r.tags,
    categories: r.categories.map((c) => c.name),
    updatedAt: r.updatedAt,
  };
}

// What a share link's preview card shows: title, summary, photo (needs a full address: the app's
// address from Settings › Email, else the one the link was opened on)
export async function sharePreview(db: Db, token: string, base: string) {
  const r = await publicRecipe(db, token).catch(() => null);
  if (!r) return null;
  const b = base.replace(/\/+$/, "");
  const image = !r.imageUrl ? null : /^https?:/.test(r.imageUrl) ? r.imageUrl : `${b}${r.imageUrl}`;
  return { title: r.title, description: r.description, image, url: `${b}${sharePath(token)}` };
}
