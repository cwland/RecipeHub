import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// Auto nutrition: when recipes are added and changed, nutrition is worked out by itself
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const reply = (obj: object) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
const aiOn = () => t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
const estimate = { calories: 410, fat: 20, saturatedFat: 7, carbs: 18, fiber: 6, sugar: 5, addedSugar: 2, protein: 33, sodium: 640, note: "" };
// AI asked for nutrition (not anything else)
const nutritionAsks = () => t.ai.calls.filter((c) => String(c.body.messages[0].content).startsWith("You estimate nutrition"));
const nutritionOf = async (id: number) => {
  await t.app.jobs.drain();
  return (await t.api("GET", `/api/recipes/${id}`)).body.nutrition;
};
const add = async (body: object = {}) => (await t.api("POST", "/api/recipes", { title: "Chili", servings: 6, ingredients: "2 lb ground beef\n1 can beans", ...body })).body.id as number;
// With the AI check off, a new recipe is estimated right away; these tests start from one that wasn't
const addQuietly = async (body: object = {}) => {
  await t.api("PUT", "/api/settings/features", { autoNutrition: false });
  const id = await add(body);
  await t.api("PUT", "/api/settings/features", { autoNutrition: true });
  return id;
};

describe("editing a recipe by hand", () => {
  it("changed ingredients: nutrition is worked out again", async () => {
    await aiOn();
    const id = await addQuietly();
    t.ai.respond = () => reply(estimate);
    await t.api("PATCH", `/api/recipes/${id}`, { ingredients: "3 lb ground beef\n1 can beans" });
    expect(await nutritionOf(id)).toMatchObject({ calories: 410, source: "ai" });
  });

  it("other changes, or the same ingredients in another order, don't ask AI", async () => {
    await aiOn();
    const id = await addQuietly();
    await t.api("PATCH", `/api/recipes/${id}`, { title: "Texas Chili", steps: ["Brown the beef."] });
    await t.api("PATCH", `/api/recipes/${id}`, { ingredients: "1 can beans\n2 lb ground beef" });
    await nutritionOf(id);
    expect(nutritionAsks()).toHaveLength(0);
  });

  it("worked out again but the AI couldn't: the old numbers are marked out of date", async () => {
    await aiOn();
    const id = await addQuietly();
    t.ai.respond = () => reply(estimate);
    await t.api("POST", `/api/recipes/${id}/nutrition`);
    t.ai.respond = () => ({ status: 500, json: { error: "down" } });
    await t.api("PATCH", `/api/recipes/${id}`, { ingredients: "3 lb ground beef\n1 can beans" });
    expect(await nutritionOf(id)).toMatchObject({ calories: 410, outdated: true });
  });

  it("numbers you typed in are kept and marked out of date", async () => {
    await aiOn();
    const id = await addQuietly();
    await t.api("PUT", `/api/recipes/${id}/nutrition`, { calories: 380 });
    await t.api("PATCH", `/api/recipes/${id}`, { ingredients: "3 lb ground beef" });
    expect(await nutritionOf(id)).toMatchObject({ calories: 380, source: "you", outdated: true });
    expect(nutritionAsks()).toHaveLength(0);
  });

  it("all the ingredients taken out: nothing to work it out from, so the numbers are marked out of date", async () => {
    await aiOn();
    const id = await addQuietly();
    t.ai.respond = () => reply(estimate);
    await t.api("POST", `/api/recipes/${id}/nutrition`);
    t.ai.calls.length = 0;
    await t.api("PATCH", `/api/recipes/${id}`, { ingredients: [] });
    expect(await nutritionOf(id)).toMatchObject({ calories: 410, outdated: true });
    expect(nutritionAsks()).toHaveLength(0);
    const logs = (await t.api("GET", "/api/logs?category=ai")).body;
    expect(logs.filter((l: any) => l.level === "error")).toHaveLength(0);
  });
});

describe("adding a recipe", () => {
  it("with the AI check on, it waits until the check is done or skipped", async () => {
    await aiOn();
    t.ai.respond = () => reply(estimate);
    const id = await add();
    expect(await nutritionOf(id)).toBeNull();
    expect((await t.api("POST", `/api/recipes/${id}/enhance/skip`)).status).toBe(204);
    expect(await nutritionOf(id)).toMatchObject({ calories: 410, source: "ai" });
  });

  it("with the AI check off, it's worked out right away", async () => {
    await aiOn();
    await t.api("PUT", "/api/settings/features", { aiEnhance: false });
    t.ai.respond = () => reply(estimate);
    expect(await nutritionOf(await add())).toMatchObject({ calories: 410, source: "ai" });
  });

  it("sent with an API key (nobody sees the AI check offer), it's worked out right away", async () => {
    await aiOn();
    const key = (await t.api("POST", "/api/keys", { name: "Shortcuts", access: "recipe_push" })).body.key;
    t.ai.respond = () => reply(estimate);
    const token = t.getToken();
    t.setToken("");
    const pushed = await t.api("POST", "/api/recipes", { title: "From Shortcuts", ingredients: ["1 egg"] }, { "x-api-key": key });
    t.setToken(token);
    expect(pushed.status).toBe(201);
    expect(await nutritionOf(pushed.body.id)).toMatchObject({ calories: 410 });
  });

  it("no ingredients, or nutrition already given: nothing to do", async () => {
    await aiOn();
    await t.api("PUT", "/api/settings/features", { aiEnhance: false });
    expect(await nutritionOf(await add({ ingredients: [] }))).toBeNull();
    expect(await nutritionOf(await add({ nutrition: { calories: 300, source: "site" } }))).toMatchObject({ calories: 300, source: "site" });
    expect(nutritionAsks()).toHaveLength(0);
  });

  it("skipping the AI check of a recipe that already has nutrition changes nothing", async () => {
    await aiOn();
    const id = await add({ nutrition: { calories: 300, source: "site" } });
    await t.api("POST", `/api/recipes/${id}/enhance/skip`);
    expect(await nutritionOf(id)).toMatchObject({ calories: 300, source: "site" });
    expect(nutritionAsks()).toHaveLength(0);
  });

  it("Auto nutrition off: skipping the AI check works nothing out", async () => {
    await aiOn();
    await t.api("PUT", "/api/settings/features", { autoNutrition: false });
    const id = await add();
    await t.api("POST", `/api/recipes/${id}/enhance/skip`);
    expect(await nutritionOf(id)).toBeNull();
  });
});

describe("importing a link", () => {
  const page = `<html><head><script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name: "Texas Chili", recipeIngredient: ["2 lb chuck"], recipeInstructions: ["Simmer."] })}</script></head></html>`;
  const importIt = async (headers?: Record<string, string>) => {
    t.web.pages["https://example.test/chili"] = { body: page };
    const r = await t.api("POST", "/api/recipes/import", { url: "https://example.test/chili" }, headers);
    await t.app.jobs.drain();
    return (await t.api("GET", `/api/imports/${r.body.id}`)).body.result.recipeId as number;
  };

  it("waits for the AI check, like a recipe typed in", async () => {
    await aiOn();
    t.ai.respond = () => reply(estimate);
    const id = await importIt();
    expect(await nutritionOf(id)).toBeNull();
    await t.api("POST", `/api/recipes/${id}/enhance/skip`);
    expect(await nutritionOf(id)).toMatchObject({ calories: 410 });
  });

  it("with the AI check off, it's worked out right after the import", async () => {
    await aiOn();
    await t.api("PUT", "/api/settings/features", { aiEnhance: false });
    t.ai.respond = () => reply(estimate);
    expect(await nutritionOf(await importIt())).toMatchObject({ calories: 410 });
  });
});

describe("the AI check", () => {
  const aiCheck = (id: number, body: object) => t.api("POST", `/api/recipes/${id}/enhance/apply`, body);

  it("ingredients changed but its nutrition not kept: worked out again for the new ingredients", async () => {
    await aiOn();
    const id = await add();
    t.ai.respond = () => reply(estimate);
    await aiCheck(id, { ingredients: ["2 lb ground beef", "1 can beans", "1 tsp salt"] });
    expect(await nutritionOf(id)).toMatchObject({ calories: 410, source: "ai" });
    expect(nutritionAsks()).toHaveLength(1);
  });

  it("its nutrition kept: nothing more to work out", async () => {
    await aiOn();
    const id = await add();
    await aiCheck(id, { ingredients: ["2 lb ground beef", "1 tsp salt"], nutrition: { ...estimate, calories: 350, source: "ai" } });
    expect(await nutritionOf(id)).toMatchObject({ calories: 350 });
    expect(nutritionAsks()).toHaveLength(0);
  });

  it("only steps kept, and the recipe has no nutrition: worked out now", async () => {
    await aiOn();
    const id = await add();
    t.ai.respond = () => reply(estimate);
    await aiCheck(id, { steps: ["Brown the beef."] });
    expect(await nutritionOf(id)).toMatchObject({ calories: 410 });
  });
});

describe("the recipe page", () => {
  it("knows while nutrition is being worked out", async () => {
    await aiOn();
    const id = await addQuietly();
    t.ai.respond = () => reply(estimate);
    const realKick = t.app.jobs.kick;
    t.app.jobs.kick = () => {}; // hold the job
    try {
      await t.api("PATCH", `/api/recipes/${id}`, { ingredients: "3 lb ground beef" });
      expect((await t.api("GET", `/api/recipes/${id}`)).body.nutritionUpdating).toBe(true);
    } finally {
      t.app.jobs.kick = realKick;
    }
    t.app.jobs.kick();
    await t.app.jobs.drain();
    expect((await t.api("GET", `/api/recipes/${id}`)).body.nutritionUpdating).toBe(false);
  });
});

