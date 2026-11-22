import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// Calculate nutrition with progress (the app's popup shows one line of what's happening)
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});
const reply = (obj: object) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
const aiOn = () => t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
const stream = async (id: number) => {
  const res = await t.app.inject({ method: "POST", url: `/api/recipes/${id}/nutrition`, headers: { authorization: `Bearer ${t.getToken()}`, accept: "application/x-ndjson" } });
  expect(res.headers["content-type"]).toMatch(/application\/x-ndjson/);
  return res.body.trim().split("\n").map((l) => JSON.parse(l));
};

describe("Calculate nutrition, with progress", () => {
  it("says what it's doing, then sends the nutrition (and saves it)", async () => {
    await aiOn();
    const r = (await t.api("POST", "/api/recipes", { title: "Chili", servings: 4, ingredients: ["1 lb ground beef", "1 onion"], steps: ["Cook."] })).body;
    t.ai.respond = () => reply({ ingredients: [{ line: "1 lb ground beef", grams: 454, calories: 1200 }, { line: "1 onion", grams: 110, calories: 40 }] });
    const lines = await stream(r.id);
    const said = lines.filter((l) => l.type === "step").map((l) => l.text);
    expect(said[0]).toBe("Reading 2 ingredients");
    expect(said).toContain("Asking OpenAI (tiny)…");
    expect(said.at(-1)).toBe("Adding up each ingredient");
    const result = lines.at(-1);
    expect(result).toMatchObject({ type: "result", nutrition: { calories: 310, source: "ai" } });
    expect((await t.api("GET", `/api/recipes/${r.id}`)).body.nutrition).toMatchObject({ calories: 310 });
  });

  it("a failure comes as an error line", async () => {
    await aiOn();
    const r = (await t.api("POST", "/api/recipes", { title: "Chili", servings: 4, ingredients: [], steps: ["Cook."] })).body;
    const lines = await stream(r.id);
    expect(lines.at(-1)).toMatchObject({ type: "error", error: expect.stringMatching(/ingredients first/) });
  });

  it("plain JSON still works", async () => {
    await aiOn();
    const r = (await t.api("POST", "/api/recipes", { title: "Chili", servings: 4, ingredients: ["1 onion"], steps: ["Cook."] })).body;
    t.ai.respond = () => reply({ ingredients: [{ line: "1 onion", calories: 40 }] });
    expect((await t.api("POST", `/api/recipes/${r.id}/nutrition`)).body).toMatchObject({ calories: 10 });
  });
});
