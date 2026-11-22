import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recipeVersions } from "../src/db/schema.js";
import { setupTestApp, type TestApp } from "./helpers.js";

// Recipe versioning, step 2: when versions are made
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const reply = (obj: object) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
const aiOn = async () => {
  await t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
  await t.api("PUT", "/api/settings/features", { autoNutrition: false }); // (these tests aren't about nutrition)
};
const versionsOf = (id: number) => t.app.db.select().from(recipeVersions).where(eq(recipeVersions.recipeId, id)).orderBy(asc(recipeVersions.number));
const brief = async (id: number) => (await versionsOf(id)).map((v) => [v.number, v.source, v.summary, v.active]);
const add = async (body: object = {}) => (await t.api("POST", "/api/recipes", { title: "Chili", servings: 4, ingredients: "1 lb beef\n1 onion", steps: ["Brown the beef."], ...body })).body.id as number;

describe("a new recipe", () => {
  it("typed in: saved as v1, active", async () => {
    const id = await add();
    const [v1] = await versionsOf(id);
    expect(await brief(id)).toEqual([[1, "created", "Added", true]]);
    expect(v1.data).toMatchObject({ title: "Chili", servings: 4, steps: [{ text: "Brown the beef." }], nutrition: null });
    expect(v1.data.ingredients.map((i) => i.raw)).toEqual(["1 lb beef", "1 onion"]);
    expect(v1.createdBy).toBe(1);
  });

  it("imported from a link: v1 says Imported", async () => {
    t.web.pages["https://example.test/chili"] = { body: `<script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name: "Texas Chili", recipeIngredient: ["2 lb chuck"], recipeInstructions: ["Simmer."] })}</script>` };
    const job = (await t.api("POST", "/api/recipes/import", { url: "https://example.test/chili" })).body;
    await t.app.jobs.drain();
    const id = (await t.api("GET", `/api/imports/${job.id}`)).body.result.recipeId;
    expect(await brief(id)).toEqual([[1, "import", "Imported", true]]);
  });

  it("versioning off: no versions are made", async () => {
    await t.api("PUT", "/api/settings/features", { recipeVersions: false });
    expect(await versionsOf(await add())).toHaveLength(0);
  });
});

describe("editing a recipe by hand", () => {
  it("saved as a new version: v2 becomes active, v1 keeps the recipe as it was", async () => {
    const id = await add();
    await t.api("PATCH", `/api/recipes/${id}`, { ingredients: "1 lb beef\n1 onion\n1 tsp salt", steps: ["Brown the beef well."], version: "new" });
    expect(await brief(id)).toEqual([
      [1, "created", "Added", false],
      [2, "edit", "Changed ingredients and steps", true],
    ]);
    const [v1, v2] = await versionsOf(id);
    expect(v1.data.steps).toEqual([{ text: "Brown the beef." }]);
    expect(v2.data.steps).toEqual([{ text: "Brown the beef well." }]);
    expect(v2.createdBy).toBe(1);
  });

  it("saved to the current version: no new version, and the active one has the change", async () => {
    const id = await add();
    await t.api("PATCH", `/api/recipes/${id}`, { title: "Texas Chili", version: "current" });
    expect(await brief(id)).toEqual([[1, "created", "Added", true]]);
    expect((await versionsOf(id))[0].data.title).toBe("Texas Chili");
  });

  it("not saying which: saved to the current version (API keys, scripts)", async () => {
    const id = await add();
    await t.api("PATCH", `/api/recipes/${id}`, { servings: 6 });
    expect(await brief(id)).toEqual([[1, "created", "Added", true]]);
    expect((await versionsOf(id))[0].data.servings).toBe(6);
  });

  it("the summary names what changed", async () => {
    const id = await add();
    await t.api("PATCH", `/api/recipes/${id}`, { title: "Texas Chili", version: "new" });
    await t.api("PATCH", `/api/recipes/${id}`, { prepMinutes: 10, cookMinutes: 60, notes: "Better the next day.", version: "new" });
    await t.api("PATCH", `/api/recipes/${id}`, { description: "Weeknight favorite", servings: 6, version: "new" });
    expect((await versionsOf(id)).map((v) => v.summary)).toEqual(["Added", "Changed the title", "Changed the times and notes", "Changed the description and servings"]);
  });

  it("only tags, categories, collections or the photo changed: no new version (they aren't versioned)", async () => {
    const id = await add();
    await t.api("PATCH", `/api/recipes/${id}`, { tags: ["spicy"], categories: ["Dinner"], version: "new" });
    expect(await brief(id)).toEqual([[1, "created", "Added", true]]);
  });

  it("versioning off: no new version, but the active one keeps up with the recipe", async () => {
    const id = await add();
    await t.api("PUT", "/api/settings/features", { recipeVersions: false });
    await t.api("PATCH", `/api/recipes/${id}`, { title: "Texas Chili", version: "new" });
    expect(await brief(id)).toEqual([[1, "created", "Added", true]]);
    expect((await versionsOf(id))[0].data.title).toBe("Texas Chili");
  });

  it("a recipe with no versions yet (added while versioning was off) gets v1 from before the change", async () => {
    await t.api("PUT", "/api/settings/features", { recipeVersions: false });
    const id = await add();
    await t.api("PUT", "/api/settings/features", { recipeVersions: true });
    await t.api("PATCH", `/api/recipes/${id}`, { title: "Texas Chili", version: "new" });
    expect(await brief(id)).toEqual([
      [1, "created", "Added", false],
      [2, "edit", "Changed the title", true],
    ]);
    expect((await versionsOf(id))[0].data.title).toBe("Chili");
  });

  it("anything else in version is refused", async () => {
    const id = await add();
    expect((await t.api("PATCH", `/api/recipes/${id}`, { title: "x", version: "v9" })).status).toBe(400);
  });
});

describe("the AI check", () => {
  it("new steps or ingredients: a new AI version, active", async () => {
    await aiOn();
    const id = await add();
    await t.api("POST", `/api/recipes/${id}/enhance/apply`, { steps: ["Brown the beef well, 8 minutes."], ingredients: ["1 lb beef", "1 onion", "1 tsp salt"] });
    expect(await brief(id)).toEqual([
      [1, "created", "Added", false],
      [2, "ai", "AI check: changed ingredients and steps", true],
    ]);
    expect((await versionsOf(id))[1].createdBy).toBe(1);
  });

  it("only nutrition, or only categories and tags: the active version is updated, no new one", async () => {
    await aiOn();
    const id = await add();
    await t.api("POST", `/api/recipes/${id}/enhance/apply`, { nutrition: { calories: 320, source: "ai" }, tags: ["beef"] });
    expect(await brief(id)).toEqual([[1, "created", "Added", true]]);
    expect((await versionsOf(id))[0].data.nutrition).toMatchObject({ calories: 320, source: "ai" });
  });
});

describe("nutrition goes into the active version", () => {
  it("typed in", async () => {
    const id = await add();
    await t.api("PUT", `/api/recipes/${id}/nutrition`, { calories: 380 });
    expect(await brief(id)).toEqual([[1, "created", "Added", true]]);
    expect((await versionsOf(id))[0].data.nutrition).toMatchObject({ calories: 380, source: "you" });
  });

  it("estimated with AI", async () => {
    await aiOn();
    const id = await add();
    t.ai.respond = () => reply({ calories: 410, note: "" });
    await t.api("POST", `/api/recipes/${id}/nutrition`);
    expect((await versionsOf(id))[0].data.nutrition).toMatchObject({ calories: 410, source: "ai" });
  });

  it("worked out by Auto nutrition, into the version made by the edit", async () => {
    await aiOn();
    await t.api("PUT", "/api/settings/features", { autoNutrition: true, aiEnhance: false });
    t.ai.respond = () => reply({ calories: 410, note: "" });
    const id = await add();
    await t.app.jobs.drain();
    t.ai.respond = () => reply({ calories: 450, note: "" });
    await t.api("PATCH", `/api/recipes/${id}`, { ingredients: "2 lb beef\n1 onion", version: "new" });
    await t.app.jobs.drain();
    const [v1, v2] = await versionsOf(id);
    expect(v1.data.nutrition).toMatchObject({ calories: 410 });
    expect(v2).toMatchObject({ number: 2, active: true });
    expect(v2.data.nutrition).toMatchObject({ calories: 450 });
    expect(await versionsOf(id)).toHaveLength(2);
  });

  it("marked out of date when the ingredients change", async () => {
    const id = await add();
    await t.api("PUT", `/api/recipes/${id}/nutrition`, { calories: 380 });
    await t.api("PATCH", `/api/recipes/${id}`, { ingredients: "2 lb beef", version: "current" });
    expect((await versionsOf(id))[0].data.nutrition).toMatchObject({ calories: 380, outdated: true });
  });
});
