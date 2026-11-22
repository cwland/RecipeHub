import fs from "node:fs/promises";
import path from "node:path";
import { isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { collections, jobs, mealPlan, recipes, tags } from "../db/schema.js";
import type { Photos } from "./photos.js";

// Settings › Data › Wipe all recipes (for testing imports from scratch). Every recipe goes, with
// what's tied to it (versions, favorites, ratings and notes, substitutions, category and tag links,
// collection places, meal plan entries for it, its photo) and the import history; tags and
// collections go too. Categories, the grocery list, the pantry, settings and people stay.
// (The route makes a backup first.)
export async function wipeRecipes(db: Db, photos: Photos) {
  const gone = await db.transaction(async (tx) => {
    const rows = await tx.select({ imageUrl: recipes.imageUrl }).from(recipes);
    await tx.delete(mealPlan).where(isNotNull(mealPlan.recipeId)); // (your own notes in the plan stay)
    await tx.execute(sql`delete from ${recipes}`); // versions, links, notes and substitutions go with them
    await tx.delete(tags);
    await tx.delete(collections);
    await tx.delete(jobs).where(sql`${jobs.kind} like 'import-%' or ${jobs.kind} = 'nutrition'`);
    return rows;
  });
  for (const r of gone) await photos.remove(r.imageUrl);
  return { recipes: gone.length };
}

// Settings › Data › Reset the entire app: every table emptied (people, sessions, settings, recipes,
// lists, logs…), the photos removed, and the defaults a new install starts with put back (the
// categories and the Groceries list). The next visit shows the first-run screen. The backups folder
// isn't touched (the route makes a backup first).
export async function resetApp(db: Db, photos: Photos) {
  await db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`select tablename from pg_tables where schemaname = 'public'`)).rows as { tablename: string }[];
    if (rows.length) await tx.execute(sql.raw(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`));
    await tx.execute(sql`insert into grocery_lists (name, sort_order) values ('Groceries', 0)`);
    await tx.execute(sql`insert into categories (name, sort_order) values ('Breakfast', 0), ('Lunch', 1), ('Dinner', 2), ('Side', 3), ('Snack', 4), ('Dessert', 5), ('Drink', 6)`);
  });
  for (const f of await fs.readdir(photos.dir).catch(() => [] as string[])) await fs.rm(path.join(photos.dir, f), { recursive: true, force: true });
}
