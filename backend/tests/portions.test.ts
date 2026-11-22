import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// Calculate nutrition on a recipe with no servings: the app asks how many it makes, with a few
// sensible suggestions from the AI (24 cookies at 40 g, 40 at 25 g…)
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});
const reply = (obj: object) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
const aiOn = () => t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
const cookies = () => t.api("POST", "/api/recipes", { title: "Chocolate Chip Cookies", ingredients: ["2 1/4 cups flour", "1 cup butter", "2 cups chocolate chips"], steps: ["Bake."] }).then((r) => r.body);

describe("Suggested portions", () => {
  it("asks the AI for a few sensible portions, from the ingredients, and tidies its answer", async () => {
    await aiOn();
    const r = await cookies();
    let asked = "";
    t.ai.respond = (_url: string, body: any) => {
      asked = JSON.stringify(body);
      return reply({
        totalGrams: 1150,
        options: [
          { servings: 28, servingSize: "1 cookie (40 g)", yieldText: "28 cookies" },
          { servings: 46, servingSize: "1 cookie (25 g)", yieldText: "46 cookies" },
          { servings: "abc", servingSize: "junk" }, // no number: dropped
          { servings: 12.6, servingSize: "1 big cookie (90 g)", yieldText: "13 cookies" }, // rounded
          { servings: 3, servingSize: "x", yieldText: "y" }, // only three are kept
        ],
      });
    };
    const res = await t.api("POST", `/api/recipes/${r.id}/portions`);
    expect(res.status).toBe(200);
    expect(asked).toContain("Chocolate Chip Cookies");
    expect(asked).toContain("1 cup butter");
    expect(res.body).toEqual({
      totalGrams: 1150,
      options: [
        { servings: 28, servingSize: "1 cookie (40 g)", yieldText: "28 cookies" },
        { servings: 46, servingSize: "1 cookie (25 g)", yieldText: "46 cookies" },
        { servings: 13, servingSize: "1 big cookie (90 g)", yieldText: "13 cookies" },
      ],
    });
  });

  it("without AI it says so; without ingredients it asks for them", async () => {
    const r = await cookies();
    const off = await t.api("POST", `/api/recipes/${r.id}/portions`);
    expect(off.status).toBeGreaterThanOrEqual(400);
    expect(off.body.error).toMatch(/AI/);
    await aiOn();
    const empty = (await t.api("POST", "/api/recipes", { title: "Nothing", ingredients: [], steps: ["Wait."] })).body;
    const none = await t.api("POST", `/api/recipes/${empty.id}/portions`);
    expect(none.status).toBeGreaterThanOrEqual(400);
    expect(none.body.error).toMatch(/ingredients/);
  });

  it("an answer with no usable portions is an error, not an empty list", async () => {
    await aiOn();
    const r = await cookies();
    t.ai.respond = () => reply({ options: [{ servings: 0 }] });
    const res = await t.api("POST", `/api/recipes/${r.id}/portions`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("Calculate nutrition with a serving size you picked", () => {
  it("tells the AI the serving size and keeps yours on the result", async () => {
    await aiOn();
    const r = (await t.api("POST", "/api/recipes", { title: "Cookies", servings: 28, ingredients: ["1 cup butter"], steps: ["Bake."] })).body;
    let asked = "";
    t.ai.respond = (_url: string, body: any) => {
      asked = JSON.stringify(body);
      return reply({ ingredients: [{ line: "1 cup butter", grams: 227, calories: 1628 }], servingSize: "1 cookie (about 41 g)" });
    };
    const res = await t.api("POST", `/api/recipes/${r.id}/nutrition`, { servingSize: "1 cookie (40 g)" });
    expect(res.status).toBe(200);
    expect(asked).toContain("1 cookie (40 g)");
    expect(res.body).toMatchObject({ servingSize: "1 cookie (40 g)", servings: 28 });
    expect((await t.api("GET", `/api/recipes/${r.id}`)).body.nutrition.servingSize).toBe("1 cookie (40 g)");
  });
});
