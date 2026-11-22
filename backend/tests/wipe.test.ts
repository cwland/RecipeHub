import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// Settings › Data › Wipe all recipes: a clean slate for testing imports
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  for (const f of fs.readdirSync(t.backupDir)) fs.unlinkSync(path.join(t.backupDir, f));
  await t.login();
});

const count = async (table: string) => ((await t.app.db.execute(sql.raw(`select count(*)::int as n from ${table}`))).rows[0] as { n: number }).n;
const wipe = (body: object = { confirm: "DELETE" }, headers?: Record<string, string>) => t.api("POST", "/api/wipe/recipes", body, headers);

// A household with recipes and everything around them
async function stocked() {
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#c33" } }).png().toBuffer();
  const imageUrl = await t.app.photos.save(png);
  const r = (await t.api("POST", "/api/recipes", { title: "Chili", ingredients: "1 lb beef", tags: ["spicy"], categories: ["Dinner"], imageUrl })).body;
  await t.api("PATCH", `/api/recipes/${r.id}`, { title: "Texas Chili", version: "new" });
  await t.api("PUT", `/api/recipes/${r.id}/me`, { favorite: true, rating: 5, notes: "Good" });
  await t.api("POST", `/api/recipes/${r.id}/substitutions`, { original: "beef", replacement: "turkey" });
  const col = (await t.api("POST", "/api/collections", { name: "Quick Meals" })).body;
  await t.api("POST", `/api/collections/${col.id}/recipes`, { recipeId: r.id });
  await t.api("POST", "/api/plan", { date: "2026-11-02", slot: "dinner", recipeId: r.id });
  await t.api("POST", "/api/plan", { date: "2026-11-03", slot: "dinner", title: "Leftovers" });
  await t.api("POST", "/api/grocery/lists/1/items", { text: "milk" });
  await t.api("POST", "/api/pantry", { text: "rice" });
  await t.app.db.execute(sql`insert into jobs (kind, payload, status) values ('import-url', '{"url":"https://x.test"}', 'done')`);
  return { recipe: r, imageUrl };
}

describe("wiping all recipes", () => {
  it("removes recipes and everything tied to them, plus tags and collections", async () => {
    const { imageUrl } = await stocked();
    const res = await wipe();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ recipes: 1 });
    for (const table of ["recipes", "recipe_versions", "recipe_user", "substitutions", "recipe_tags", "recipe_categories", "tags", "collections", "collection_recipes", "jobs"]) expect([table, await count(table)]).toEqual([table, 0]);
    expect(fs.existsSync(path.join(t.app.photos.dir, imageUrl.split("/").pop()!))).toBe(false);
    // meal plan: entries for recipes go; your own notes stay
    expect((await t.app.db.execute(sql`select title from meal_plan`)).rows).toEqual([{ title: "Leftovers" }]);
  });

  it("keeps categories, the grocery list, the pantry, settings and people", async () => {
    await stocked();
    await t.api("PUT", "/api/settings/features", { autoNutrition: false });
    await wipe();
    expect(await count("categories")).toBe(7);
    expect(await count("grocery_items")).toBe(1);
    expect(await count("pantry_items")).toBe(1);
    expect((await t.api("GET", "/api/settings/features")).body.autoNutrition).toBe(false);
    expect((await t.api("GET", "/api/auth/me")).body.user.username).toBe("alex");
  });

  it("makes a backup first, so Restore can bring it all back", async () => {
    await stocked();
    const res = await wipe();
    expect(res.body.backup).toMatch(/before-wipe\.tar\.gz$/);
    const file = fs.readFileSync(path.join(t.backupDir, res.body.backup));
    const back = await t.app.inject({ method: "POST", url: "/api/import?confirm=replace", payload: file, headers: { authorization: `Bearer ${t.getToken()}`, "content-type": "application/gzip" } });
    expect(back.statusCode).toBe(200);
    expect((await t.api("GET", "/api/recipes")).body.recipes.map((r: any) => r.title)).toEqual(["Texas Chili"]);
  });

  it("is logged", async () => {
    await stocked();
    await wipe();
    const log = (await t.api("GET", "/api/logs?category=import")).body[0];
    expect(log).toMatchObject({ level: "warning", event: "All recipes wiped (1 recipe)" });
  });

  it("needs DELETE typed in; anything else changes nothing", async () => {
    await stocked();
    for (const body of [{}, { confirm: "delete" }, { confirm: "yes" }]) expect((await wipe(body)).status).toBe(400);
    expect(await count("recipes")).toBe(1);
  });

  it("only the owner, signed in; never a member, never an API key", async () => {
    await stocked();
    await t.api("POST", "/api/household/members", { username: "sam", password: "sam-password-1" });
    const sam = (await t.api("POST", "/api/auth/login", { username: "sam", password: "sam-password-1" })).body.token;
    const key = (await t.api("POST", "/api/keys", { name: "admin", access: "admin" })).body.key;
    expect((await wipe(undefined, { authorization: `Bearer ${sam}` })).status).toBe(403);
    const token = t.getToken();
    t.setToken("");
    expect((await wipe(undefined, { "x-api-key": key })).status).toBe(403);
    t.setToken(token);
    expect(await count("recipes")).toBe(1);
  });
});
