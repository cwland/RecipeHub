import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";

// Recipe versioning, step 1: the versions table, and every recipe saved before it gets its versions.

const url = process.env.TEST_DATABASE_URL ?? "postgresql://localhost:5432/recipehub_test";
const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

// A copy of the migrations up to and including `last`: the database as an older RecipeHub left it
function migrationsUpTo(last: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recipehub-migrations-"));
  fs.cpSync(migrations, dir, { recursive: true });
  const journalPath = path.join(dir, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const at = journal.entries.findIndex((e: { tag: string }) => e.tag === last);
  journal.entries = journal.entries.slice(0, at + 1);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe("upgrading: recipes saved before versions", () => {
  const { db, pool } = createDb(url);
  type Row = { recipe_id: number; number: number; source: string; summary: string; data: any; active: boolean; created_at: Date };
  let versions: Row[] = [];
  let ids: Record<string, number> = {};

  beforeAll(async () => {
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`create schema public`);
    await migrate(db, { migrationsFolder: migrationsUpTo("0009_recipe_snapshots") });
    const add = async (title: string, more: string) => {
      const r = await db.execute(
        sql.raw(`insert into recipes (title, ingredients, steps, servings, notes, nutrition, created_at${more ? ", source_url" : ""})
          values ('${title}', '[{"raw":"1 lb beef"}]', '[{"text":"Cook it."}]', 4, 'Freezes well.', '{"calories":300,"source":"site"}', '2026-10-01T12:00:00Z'${more ? `, '${more}'` : ""}) returning id`)
      );
      return (r.rows[0] as { id: number }).id;
    };
    ids = {
      typed: await add("Typed In", ""),
      imported: await add("Imported", "https://example.test/chili"),
      aiSteps: await add("AI Steps", ""),
      aiAll: await add("AI All", ""),
    };
    // Recipes that had an AI check applied: their undo point holds the recipe as it was before
    await db.execute(sql`update recipes set steps = '[{"text":"Cook it well, 10 minutes."}]' where id = ${ids.aiSteps}`);
    await db.execute(
      sql`insert into recipe_snapshots (recipe_id, data, created_at) values (${ids.aiSteps}, ${JSON.stringify({ steps: [{ text: "Cook it." }], ingredients: [{ raw: "1 lb beef" }], nutrition: null, categoryIds: [], tags: [], applied: ["steps"] })}, '2026-10-20T08:00:00Z')`
    );
    await db.execute(sql`update recipes set steps = '[{"text":"Cook it well."}]', ingredients = '[{"raw":"1 lb beef"},{"raw":"1 tsp salt"}]', nutrition = '{"calories":320,"source":"ai"}' where id = ${ids.aiAll}`);
    // (older undo points don't say what they touched: all three come back)
    await db.execute(
      sql`insert into recipe_snapshots (recipe_id, data, created_at) values (${ids.aiAll}, ${JSON.stringify({ steps: [{ text: "Cook it." }], ingredients: [{ raw: "1 lb beef" }], nutrition: { calories: 300, source: "site" }, categoryIds: [], tags: [] })}, '2026-10-21T08:00:00Z')`
    );
    await runMigrations(db); // the upgrade
    versions = (await db.execute(sql`select recipe_id, number, source, summary, data, active, created_at from recipe_versions order by recipe_id, number`)).rows as Row[];
  });
  afterAll(async () => pool.end());

  const of = (id: number) => versions.filter((v) => v.recipe_id === id);

  it("a recipe typed in gets one version, v1, active, as it is now", () => {
    expect(of(ids.typed)).toHaveLength(1);
    const [v1] = of(ids.typed);
    expect(v1).toMatchObject({ number: 1, source: "created", summary: "Added", active: true });
    expect(new Date(v1.created_at).toISOString()).toBe("2026-10-01T12:00:00.000Z");
    expect(v1.data).toEqual({
      title: "Typed In",
      description: null,
      ingredients: [{ raw: "1 lb beef" }],
      steps: [{ text: "Cook it." }],
      servings: 4,
      yieldText: null,
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      notes: "Freezes well.",
      nutrition: { calories: 300, source: "site" },
    });
  });

  it("an imported recipe's v1 says it was imported", () => {
    expect(of(ids.imported).map((v) => [v.number, v.source, v.summary, v.active])).toEqual([[1, "import", "Imported", true]]);
  });

  it("an AI change that could be undone becomes v1 (before) and v2 (the AI change, active)", () => {
    const [v1, v2] = of(ids.aiSteps);
    expect(of(ids.aiSteps)).toHaveLength(2);
    expect(v1).toMatchObject({ number: 1, active: false });
    expect(v1.data.steps).toEqual([{ text: "Cook it." }]);
    expect(v2).toMatchObject({ number: 2, source: "ai", summary: "AI check", active: true });
    expect(v2.data.steps).toEqual([{ text: "Cook it well, 10 minutes." }]);
    expect(new Date(v2.created_at).toISOString()).toBe("2026-10-20T08:00:00.000Z");
  });

  it("only the parts the AI changed are taken from before", () => {
    const [v1] = of(ids.aiSteps);
    expect(v1.data.nutrition).toEqual({ calories: 300, source: "site" }); // nutrition wasn't part of that AI change
  });

  it("an older undo point (that didn't say what it touched) puts back steps, ingredients and nutrition", () => {
    const [v1, v2] = of(ids.aiAll);
    expect(v1.data).toMatchObject({ steps: [{ text: "Cook it." }], ingredients: [{ raw: "1 lb beef" }], nutrition: { calories: 300, source: "site" } });
    expect(v2.data).toMatchObject({ steps: [{ text: "Cook it well." }], nutrition: { calories: 320, source: "ai" } });
  });

  it("only one version of a recipe can be active", async () => {
    await expect(db.execute(sql`update recipe_versions set active = true where recipe_id = ${ids.aiSteps}`)).rejects.toThrow();
  });

  it("version numbers don't repeat within a recipe", async () => {
    await expect(db.execute(sql`insert into recipe_versions (recipe_id, number, source, summary, data, active) values (${ids.typed}, 1, 'edit', 'x', '{}', false)`)).rejects.toThrow();
  });

  it("deleting a recipe deletes its versions", async () => {
    await db.execute(sql`delete from recipes where id = ${ids.typed}`);
    const left = (await db.execute(sql`select count(*)::int as n from recipe_versions where recipe_id = ${ids.typed}`)).rows[0] as { n: number };
    expect(left.n).toBe(0);
  });
});
