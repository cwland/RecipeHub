import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// Direct import from the RecipeHub Companion extension (a Recipe push key): the page you're on, and
// optionally "Run through AI correction", which improves it in the background once it's in
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
  await t.api("PUT", "/api/settings/features", { autoNutrition: false });
};
const page = `<!doctype html><html><head><title>Pork Roast</title><script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name: "Pork Roast", recipeIngredient: ["1 pork butt", "3 tbsp brown sugar"], recipeInstructions: ["Roast it."] })}</script></head><body></body></html>`;
const keyed = async (access = "recipe_push") => {
  const key = (await t.api("POST", "/api/keys", { name: "RecipeHub Companion import", access })).body.key;
  return (method: string, url: string, body?: object) => t.api(method, url, body, { "x-api-key": key, authorization: "" });
};

describe("importing with AI correction", () => {
  it("imports the page, then improves it in the background (a new version; the original stays v1)", async () => {
    await aiOn();
    t.ai.respond = () => reply({ steps: ["Roast at 300°F for 4 hours, until tender."], stepChanges: ["Added the temperature and time."], ingredients: ["1 pork butt", "3 tbsp brown sugar"], categories: ["Dinner"], tags: ["roast"], organizeChanges: ["Added Dinner."] });
    const as = await keyed();
    const r = await as("POST", "/api/recipes/import", { url: "https://example.com/pork", html: page, improve: true, wait: 10 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "done", result: { recipeId: expect.any(Number), title: "Pork Roast", improving: expect.any(Number) } });
    await t.app.jobs.drain();
    // the key can follow the improve too
    expect((await as("GET", `/api/imports/${r.body.result.improving}`)).body).toMatchObject({ kind: "import-improve", status: "done", result: { total: 1, improved: 1 } });
    const recipe = (await t.api("GET", `/api/recipes/${r.body.result.recipeId}`)).body;
    expect(recipe.steps).toEqual([{ text: "Roast at 300°F for 4 hours, until tender." }]);
    expect((await t.api("GET", `/api/recipes/${recipe.id}/versions`)).body.map((v: any) => [v.number, v.source])).toEqual([
      [2, "ai"],
      [1, "import"],
    ]);
  });

  it("without it, just imports", async () => {
    await aiOn();
    const as = await keyed();
    const r = await as("POST", "/api/recipes/import", { url: "https://example.com/pork", html: page, wait: 10 });
    expect(r.body.result.recipeId).toEqual(expect.any(Number));
    expect(r.body.result.improving).toBeUndefined();
  });

  it("already in your recipes: nothing to improve", async () => {
    await aiOn();
    const as = await keyed();
    await as("POST", "/api/recipes/import", { url: "https://example.com/pork", html: page, wait: 10 });
    const again = await as("POST", "/api/recipes/import", { url: "https://example.com/pork", html: page, improve: true, wait: 10 });
    expect(again.body.result).toMatchObject({ duplicateOf: expect.any(Number) });
    expect(again.body.result.improving).toBeUndefined();
  });

  it("AI not set up (or AI Enhance off): says so, and imports nothing", async () => {
    const as = await keyed();
    const r = await as("POST", "/api/recipes/import", { url: "https://example.com/pork", html: page, improve: true });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/AI/);
    expect((await t.api("GET", "/api/recipes")).body.total).toBe(0);
  });

  it("the key check says whether AI correction is available", async () => {
    const as = await keyed();
    expect((await as("GET", "/api/key-check")).body).toMatchObject({ canImport: true, aiCorrection: false });
    await aiOn();
    expect((await as("GET", "/api/key-check")).body).toMatchObject({ aiCorrection: true });
    await t.api("PUT", "/api/settings/features", { aiEnhance: false });
    expect((await as("GET", "/api/key-check")).body).toMatchObject({ aiCorrection: false });
  });
});

describe("a direct import leaves a note in the inbox", () => {
  it("inbox: true adds an Imported entry with the recipe, from the key that sent it", async () => {
    const as = await keyed();
    const r = await as("POST", "/api/recipes/import", { url: "https://example.com/pork", html: page, inbox: true, wait: 10 });
    const recipeId = r.body.result.recipeId;
    expect((await t.api("GET", "/api/inbox")).body).toEqual([]); // nothing waiting: it's in already
    const imported = (await t.api("GET", "/api/inbox?status=PROCESSED")).body;
    expect(imported).toMatchObject([{ type: "RECIPE_LINK", title: "Pork Roast", url: "https://example.com/pork", status: "PROCESSED", recipeId, sentBy: "RecipeHub Companion import", reviewedAt: expect.any(String) }]);
  });

  it("the same link waiting in the inbox: that item is the one marked imported", async () => {
    await t.api("POST", "/api/inbox", { type: "RECIPE_LINK", url: "https://example.com/pork", title: "Pork (to try)" });
    const as = await keyed();
    const r = await as("POST", "/api/recipes/import", { url: "https://example.com/pork", html: page, inbox: true, wait: 10 });
    expect((await t.api("GET", "/api/inbox")).body).toEqual([]);
    expect((await t.api("GET", "/api/inbox?status=PROCESSED")).body).toMatchObject([{ title: "Pork (to try)", recipeId: r.body.result.recipeId }]);
  });

  it("already in your recipes, or without inbox: true: no entry", async () => {
    const as = await keyed();
    await as("POST", "/api/recipes/import", { url: "https://example.com/pork", html: page, wait: 10 });
    await as("POST", "/api/recipes/import", { url: "https://example.com/pork", html: page, inbox: true, wait: 10 });
    expect((await t.api("GET", "/api/inbox?status=PROCESSED")).body).toEqual([]);
  });
});
