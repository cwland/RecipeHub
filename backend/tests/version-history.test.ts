import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recipeVersions } from "../src/db/schema.js";
import { setupTestApp, type TestApp } from "./helpers.js";

// Recipe versioning, step 3: the version history and what you can do with it
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const add = async () => (await t.api("POST", "/api/recipes", { title: "Chili", servings: 4, ingredients: "1 lb beef\n1 onion", steps: ["Brown the beef."], tags: ["spicy"] })).body.id as number;
// v1 Added, then v2 (an edit saved as new: title, steps and nutrition), active
const twoVersions = async () => {
  const id = await add();
  await t.api("PUT", `/api/recipes/${id}/nutrition`, { calories: 300 });
  await t.api("PATCH", `/api/recipes/${id}`, { title: "Texas Chili", steps: ["Brown the beef well."], version: "new" });
  await t.api("PUT", `/api/recipes/${id}/nutrition`, { calories: 350 });
  return id;
};
const list = async (id: number) => (await t.api("GET", `/api/recipes/${id}/versions`)).body;

describe("the version history", () => {
  it("lists every version, newest first, with who made it and what changed", async () => {
    const id = await twoVersions();
    const versions = await list(id);
    expect(versions.map((v: any) => [v.number, v.source, v.summary, v.active, v.by])).toEqual([
      [2, "edit", "Changed the title and steps", true, "alex"],
      [1, "created", "Added", false, "alex"],
    ]);
    expect(typeof versions[0].createdAt).toBe("string");
    expect(versions[0].data).toBeUndefined(); // (the list is light; open one for its content)
  });

  it("opens one version with its content", async () => {
    const id = await twoVersions();
    const v1 = (await t.api("GET", `/api/recipes/${id}/versions/1`)).body;
    expect(v1).toMatchObject({ number: 1, active: false, data: { title: "Chili", steps: [{ text: "Brown the beef." }], nutrition: { calories: 300 } } });
    expect((await t.api("GET", `/api/recipes/${id}/versions/9`)).status).toBe(404);
  });

  it("a recipe that has no versions yet shows its v1", async () => {
    const id = await add();
    await t.app.db.delete(recipeVersions).where(eq(recipeVersions.recipeId, id));
    expect((await list(id)).map((v: any) => [v.number, v.summary, v.active])).toEqual([[1, "Added", true]]);
  });

  it("another recipe's version, or a recipe that isn't there: not found", async () => {
    const a = await twoVersions();
    const b = await add();
    expect((await t.api("POST", `/api/recipes/${b}/versions/2/activate`)).status).toBe(404);
    expect((await t.api("GET", `/api/recipes/999/versions`)).status).toBe(404);
    expect((await list(a))).toHaveLength(2);
  });
});

describe("setting a version active", () => {
  it("the recipe becomes that version: content, nutrition and search", async () => {
    const id = await twoVersions();
    const r = await t.api("POST", `/api/recipes/${id}/versions/1/activate`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ title: "Chili", steps: [{ text: "Brown the beef." }], nutrition: { calories: 300 } });
    expect(r.body.ingredients[0]).toMatchObject({ raw: "1 lb beef", quantity: 1, unit: "lb" });
    expect((await list(id)).map((v: any) => [v.number, v.active])).toEqual([
      [2, false],
      [1, true],
    ]);
    // search follows the active version
    expect((await t.api("GET", "/api/recipes?q=texas")).body.total).toBe(0);
    expect((await t.api("GET", "/api/recipes?q=chili")).body.total).toBe(1);
  });

  it("tags, categories, the photo and your favorites stay as they are", async () => {
    const id = await twoVersions();
    await t.api("PUT", `/api/recipes/${id}/me`, { favorite: true });
    const r = (await t.api("POST", `/api/recipes/${id}/versions/1/activate`)).body;
    expect(r.tags).toEqual(["spicy"]);
    expect(r.me.favorite).toBe(true);
  });

  it("an edit after going back makes the next number, from the version now active", async () => {
    const id = await twoVersions();
    await t.api("POST", `/api/recipes/${id}/versions/1/activate`);
    await t.api("PATCH", `/api/recipes/${id}`, { servings: 6, version: "new" });
    const v3 = (await t.api("GET", `/api/recipes/${id}/versions/3`)).body;
    expect(v3).toMatchObject({ active: true, summary: "Changed servings", data: { title: "Chili", servings: 6 } });
  });

  it("open copies of the app hear about it", async () => {
    const id = await twoVersions();
    const heard: unknown[] = [];
    const off = t.app.events.on((e) => heard.push(e));
    await t.api("POST", `/api/recipes/${id}/versions/1/activate`);
    off();
    expect(heard).toContainEqual({ topic: "recipes", id, by: 1 });
  });
});

describe("deleting a version", () => {
  it("removes it; numbers aren't reused", async () => {
    const id = await twoVersions();
    expect((await t.api("DELETE", `/api/recipes/${id}/versions/1`)).status).toBe(204);
    expect((await list(id)).map((v: any) => v.number)).toEqual([2]);
    await t.api("PATCH", `/api/recipes/${id}`, { servings: 6, version: "new" });
    expect((await list(id)).map((v: any) => v.number)).toEqual([3, 2]);
  });

  it("the active version can't be deleted (set another one active first)", async () => {
    const id = await twoVersions();
    const r = await t.api("DELETE", `/api/recipes/${id}/versions/2`);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("This is the active version. Set another version active first.");
    expect(await list(id)).toHaveLength(2);
  });
});

describe("API keys", () => {
  it("read keys can see the history; write keys can set active and delete", async () => {
    const id = await twoVersions();
    const read = (await t.api("POST", "/api/keys", { name: "r", access: "read" })).body.key;
    const write = (await t.api("POST", "/api/keys", { name: "w", access: "write" })).body.key;
    const token = t.getToken();
    t.setToken("");
    try {
      expect((await t.api("GET", `/api/recipes/${id}/versions`, undefined, { "x-api-key": read })).status).toBe(200);
      expect((await t.api("POST", `/api/recipes/${id}/versions/1/activate`, undefined, { "x-api-key": read })).status).toBe(403);
      expect((await t.api("POST", `/api/recipes/${id}/versions/1/activate`, undefined, { "x-api-key": write })).status).toBe(200);
      expect((await t.api("DELETE", `/api/recipes/${id}/versions/2`, undefined, { "x-api-key": write })).status).toBe(204);
    } finally {
      t.setToken(token);
    }
  });
});

describe("Undo AI changes is replaced by versions", () => {
  it("there's no undo any more; the version before the AI change is still there to go back to", async () => {
    await t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
    const id = await add();
    const applied = (await t.api("POST", `/api/recipes/${id}/enhance/apply`, { steps: ["Brown the beef well."] })).body;
    expect(applied.aiSnapshotAt).toBeUndefined();
    expect((await t.api("POST", `/api/recipes/${id}/enhance/undo`)).status).toBe(404);
    expect((await t.api("POST", `/api/recipes/${id}/versions/1/activate`)).body.steps).toEqual([{ text: "Brown the beef." }]);
  });
});

describe("restoring an older backup (from before versions)", () => {
  it("gives each recipe its versions, turning undo points into v1 (before the AI change) and v2", async () => {
    const id = await add();
    const id2 = await add();
    const exported = JSON.parse((await t.app.inject({ method: "GET", url: "/api/export", headers: { authorization: `Bearer ${t.getToken()}` } })).body);
    delete exported.data.recipeVersions;
    exported.data.recipes = exported.data.recipes.map((r: any) => (r.id === id ? { ...r, steps: [{ text: "Brown the beef well." }] } : r));
    exported.data.recipeSnapshots = [{ recipeId: id, data: { steps: [{ text: "Brown the beef." }], ingredients: [], nutrition: null, categoryIds: [], tags: [], applied: ["steps"] }, createdAt: "2026-10-20T08:00:00.000Z" }];
    expect((await t.api("POST", "/api/import?confirm=replace", exported)).status).toBe(200);
    expect((await list(id)).map((v: any) => [v.number, v.source, v.summary, v.active])).toEqual([
      [2, "ai", "AI check", true],
      [1, "created", "Added", false],
    ]);
    expect((await t.api("GET", `/api/recipes/${id}/versions/1`)).body.data.steps).toEqual([{ text: "Brown the beef." }]);
    expect((await t.api("GET", `/api/recipes/${id}/versions/1`)).body.data.ingredients.map((i: any) => i.raw)).toEqual(["1 lb beef", "1 onion"]); // (only what the AI changed)
    expect((await list(id2)).map((v: any) => [v.number, v.active])).toEqual([[1, true]]);
  });

  it("a backup that has versions keeps them as they were", async () => {
    const id = await twoVersions();
    const exported = JSON.parse((await t.app.inject({ method: "GET", url: "/api/export", headers: { authorization: `Bearer ${t.getToken()}` } })).body);
    await t.app.db.execute(sql`delete from recipe_versions`);
    await t.api("POST", "/api/import?confirm=replace", exported);
    expect((await t.app.db.select().from(recipeVersions).orderBy(asc(recipeVersions.number))).map((v) => v.summary)).toEqual(["Added", "Changed the title and steps"]);
    expect((await list(id))).toHaveLength(2);
  });
});

describe("the recipe says whether versioning is on (for its History tab)", () => {
  it("on, then off", async () => {
    const id = await add();
    expect((await t.api("GET", `/api/recipes/${id}`)).body.versioning).toBe(true);
    await t.api("PUT", "/api/settings/features", { recipeVersions: false });
    expect((await t.api("GET", `/api/recipes/${id}`)).body.versioning).toBe(false);
  });
});

