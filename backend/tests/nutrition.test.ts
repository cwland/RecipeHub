import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ingredientsChanged, ingredientsUpdated } from "../src/lib/nutrition.js";
import { setupTestApp, type TestApp } from "./helpers.js";

const list = (...lines: string[]) => lines.map((raw) => ({ raw }));

describe("did the ingredients change (for nutrition)?", () => {
  it("the same lines are not a change", () => {
    expect(ingredientsChanged(list("1 lb chicken", "1 onion"), list("1 lb chicken", "1 onion"))).toBe(false);
  });

  it("a new, removed or different line is a change", () => {
    expect(ingredientsChanged(list("1 lb chicken"), list("1 lb chicken", "1 tsp salt"))).toBe(true);
    expect(ingredientsChanged(list("1 lb chicken", "1 onion"), list("1 lb chicken"))).toBe(true);
    expect(ingredientsChanged(list("1 lb chicken"), list("2 lb chicken"))).toBe(true);
  });

  it("order, spacing and capital letters don't count", () => {
    expect(ingredientsChanged(list("1 lb chicken", "1 onion"), list("1  Onion ", "1 lb chicken"))).toBe(false);
  });

  it("headings don't count", () => {
    expect(ingredientsChanged([{ raw: "For the sauce", section: "For the sauce" }, { raw: "1 onion" }], list("1 onion"))).toBe(false);
  });

  it("the same line twice is a different amount", () => {
    expect(ingredientsChanged(list("1 egg"), list("1 egg", "1 egg"))).toBe(true);
  });
});

// ---------- keeping nutrition up to date (Auto nutrition) ----------

describe("when the ingredients change", () => {
  let t: TestApp;
  beforeAll(async () => (t = await setupTestApp()));
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.login();
  });

  const reply = (obj: object) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
  const aiOn = () => t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
  const estimate = { calories: 410, fat: 20, saturatedFat: 7, carbs: 18, fiber: 6, sugar: 5, addedSugar: 2, protein: 33, sodium: 640, note: "Assumed 80/20 beef." };
  const chili = async (nutrition?: object) => {
    const r = (await t.api("POST", "/api/recipes", { title: "Chili", servings: 6, ingredients: "2 lb ground beef\n1 can beans" })).body;
    if (nutrition) await t.api("PUT", `/api/recipes/${r.id}/nutrition`, nutrition);
    return r.id as number;
  };
  const changed = async (id: number) => {
    await ingredientsUpdated(t.app, id);
    await t.app.jobs.drain();
    return (await t.api("GET", `/api/recipes/${id}`)).body.nutrition;
  };

  it("works nutrition out again with AI, and open copies of the app hear about it", async () => {
    await aiOn();
    const id = await chili();
    t.ai.respond = () => reply(estimate);
    const heard: unknown[] = [];
    const off = t.app.events.on((e) => heard.push(e));
    const n = await changed(id);
    off();
    expect(n).toMatchObject({ calories: 410, addedSugar: 2, source: "ai", servings: 6 });
    expect(n.outdated).toBeUndefined();
    expect(heard).toContainEqual({ topic: "recipes", id, by: null });
    const log = (await t.api("GET", "/api/logs?category=ai")).body.find((l: any) => l.source === "Auto nutrition");
    expect(log).toMatchObject({ level: "info", event: "Nutrition worked out for Chili" });
  });

  it("replaces numbers from the recipe's site", async () => {
    await aiOn();
    const id = await chili();
    await t.app.db.execute(sql`update recipes set nutrition = '{"calories": 300, "source": "site"}' where id = ${id}`);
    t.ai.respond = () => reply(estimate);
    expect(await changed(id)).toMatchObject({ calories: 410, source: "ai" });
  });

  it("never changes numbers you typed in: they're marked as out of date instead", async () => {
    await aiOn();
    const id = await chili({ calories: 380, protein: 30 });
    t.ai.calls.length = 0;
    const n = await changed(id);
    expect(n).toMatchObject({ calories: 380, protein: 30, source: "you", outdated: true });
    expect(t.ai.calls).toHaveLength(0);
    // typing them in again clears it
    await t.api("PUT", `/api/recipes/${id}/nutrition`, { calories: 390 });
    expect((await t.api("GET", `/api/recipes/${id}`)).body.nutrition.outdated).toBeUndefined();
  });

  it("an estimate clears the out-of-date mark", async () => {
    await aiOn();
    const id = await chili({ calories: 380 });
    await changed(id);
    t.ai.respond = () => reply(estimate);
    const n = (await t.api("POST", `/api/recipes/${id}/nutrition`)).body;
    expect(n).toMatchObject({ calories: 410, source: "ai" });
    expect((await t.api("GET", `/api/recipes/${id}`)).body.nutrition.outdated).toBeUndefined();
  });

  it("Auto nutrition off: nothing is worked out, and the numbers there are marked out of date", async () => {
    await aiOn();
    await t.api("PUT", "/api/settings/features", { autoNutrition: false });
    const id = await chili();
    await t.app.db.execute(sql`update recipes set nutrition = '{"calories": 300, "source": "ai"}' where id = ${id}`);
    t.ai.calls.length = 0;
    expect(await changed(id)).toMatchObject({ calories: 300, source: "ai", outdated: true });
    expect(t.ai.calls).toHaveLength(0);
  });

  it("AI off: nothing is worked out, and no nutrition stays no nutrition", async () => {
    const id = await chili();
    expect(await changed(id)).toBeNull();
    expect(t.ai.calls).toHaveLength(0);
  });

  it("several changes in a row ask AI once", async () => {
    await aiOn();
    const id = await chili();
    t.ai.respond = () => reply(estimate);
    const realKick = t.app.jobs.kick;
    t.app.jobs.kick = () => {}; // hold the jobs until all three changes are in
    try {
      await ingredientsUpdated(t.app, id);
      await ingredientsUpdated(t.app, id);
      await ingredientsUpdated(t.app, id);
    } finally {
      t.app.jobs.kick = realKick;
    }
    t.app.jobs.kick();
    await t.app.jobs.drain();
    expect(t.ai.calls).toHaveLength(1);
  });

  it("when AI fails, the old numbers stay and the problem is logged", async () => {
    await aiOn();
    const id = await chili();
    await t.app.db.execute(sql`update recipes set nutrition = '{"calories": 300, "source": "ai"}' where id = ${id}`);
    t.ai.respond = () => ({ status: 500, json: { error: "boom" } });
    expect(await changed(id)).toMatchObject({ calories: 300, source: "ai" });
    const log = (await t.api("GET", "/api/logs?category=ai")).body.find((l: any) => l.source === "Auto nutrition");
    expect(log).toMatchObject({ level: "error" });
    expect(log.event).toContain("Chili");
  });

  it("a recipe deleted before its turn is skipped quietly", async () => {
    await aiOn();
    const id = await chili();
    const realKick = t.app.jobs.kick;
    t.app.jobs.kick = () => {};
    try {
      await ingredientsUpdated(t.app, id);
    } finally {
      t.app.jobs.kick = realKick;
    }
    await t.api("DELETE", `/api/recipes/${id}`);
    t.app.jobs.kick();
    await t.app.jobs.drain();
    expect(t.ai.calls).toHaveLength(0);
    const [job] = (await t.app.db.execute(sql`select status from jobs where kind = 'nutrition'`)).rows as { status: string }[];
    expect(job.status).toBe("done");
  });
});

// ---------- Re-analyze with AI, after editing the ingredients on the recipe page ----------

describe("re-analyzing after an ingredient edit", () => {
  let t: TestApp;
  beforeAll(async () => (t = await setupTestApp()));
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.login();
  });
  const reply = (obj: object) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
  const sentToAi = () => {
    const last = t.ai.calls.at(-1)!;
    return last.body.messages.map((m: { content: string }) => m.content).join("\n");
  };

  for (const version of ["current", "new", undefined] as const)
    it(`the AI is sent the ingredients as they are now (saved ${version ?? "without versioning"})`, async () => {
      await t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
      if (!version) await t.api("PUT", "/api/settings/features", { recipeVersions: false });
      t.ai.respond = () => reply({ calories: 500 });
      const r = (await t.api("POST", "/api/recipes", { title: "Pork roast", servings: 8, ingredients: "1 (5-pound) boneless pork butt roast\n3 tablespoons packed brown sugar" })).body;
      await t.api("POST", `/api/recipes/${r.id}/nutrition`);
      expect(sentToAi()).not.toContain("white sugar");
      const saved = await t.api("PATCH", `/api/recipes/${r.id}`, { ingredients: "1 (5-pound) boneless pork butt roast\n3 tablespoons packed brown sugar\n4 1/4 cup white sugar", ...(version ? { version } : {}) });
      expect(saved.status).toBe(200);
      await t.app.jobs.drain();
      await t.api("POST", `/api/recipes/${r.id}/nutrition`);
      expect(sentToAi()).toContain("4 1/4 cup white sugar");
    });
});

// ---------- worked out per ingredient, added up by RecipeHub ----------

describe("estimating nutrition per ingredient", () => {
  let t: TestApp;
  beforeAll(async () => (t = await setupTestApp()));
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.login();
    await t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
  });
  const reply = (obj: object) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
  const pork = { line: "1 (5-pound) boneless pork butt roast", grams: 2268, calories: 5900, fat: 430, saturatedFat: 150, carbs: 0, fiber: 0, sugar: 0, addedSugar: 0, protein: 400, sodium: 1500 };
  const sugar = { line: "4 1/4 cup white sugar", grams: 850, calories: 3290, fat: 0, saturatedFat: 0, carbs: 850, fiber: 0, sugar: 850, addedSugar: 850, protein: 0, sodium: 0 };
  const recipe = async (servings: number | null, ingredients: string) =>
    (await t.api("POST", "/api/recipes", { title: "Pork roast", ...(servings ? { servings } : {}), ingredients })).body.id as number;

  it("asks for each ingredient line, and adds them up per serving itself", async () => {
    const id = await recipe(10, "1 (5-pound) boneless pork butt roast\n4 1/4 cup white sugar");
    t.ai.respond = () => reply({ ingredients: [pork, sugar], servingSize: "About 6 oz (230 g)", note: "Trimmed weight." });
    const n = (await t.api("POST", `/api/recipes/${id}/nutrition`)).body;
    // (5900 + 3290) / 10, (430 + 0) / 10 …
    expect(n).toMatchObject({ calories: 919, fat: 43, saturatedFat: 15, carbs: 85, sugar: 85, addedSugar: 85, protein: 40, sodium: 150, servings: 10, source: "ai", servingSize: "About 6 oz (230 g)" });
    expect(t.ai.calls.at(-1)!.body.messages.at(-1).content).toContain("- 4 1/4 cup white sugar");
  });

  it("leaves the AI enough room for every ingredient's numbers (a long list doesn't get cut off)", async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `${i + 1} cups ingredient ${i}`).join("\n");
    const id = await recipe(4, lines);
    t.ai.respond = () => reply({ ingredients: [pork] });
    await t.api("POST", `/api/recipes/${id}/nutrition`);
    // a dozen fields per line, often laid out over several lines: about 300 tokens each
    expect(t.ai.calls.at(-1)!.body.max_tokens).toBeGreaterThanOrEqual(800 + 300 * 12);
  });

  // Alex's 7-line Ninja Creami recipe: both OpenRouter models stopped with "length" after 2–3
  // lines, because thinking used up most of the room (one answer came back empty)
  it("leaves room for a model that thinks before answering, even for a short recipe", async () => {
    const id = await recipe(1, "300 ml chocolate milk\n100 ml almond milk\n1/2 tsp arrowroot\n1 pinch salt");
    t.ai.respond = () => reply({ ingredients: [pork] });
    await t.api("POST", `/api/recipes/${id}/nutrition`);
    expect(t.ai.calls.at(-1)!.body.max_tokens).toBeGreaterThanOrEqual(4000);
  });

  it("OpenRouter: asks the model to keep its thinking short, so the answer has room", async () => {
    await t.api("PUT", "/api/settings/ai", { services: [{ name: "OpenRouter", provider: "openrouter", model: "anthropic/claude-haiku-5.5", apiKey: "k" }], maxPerRun: 50 });
    const id = await recipe(1, "300 ml chocolate milk\n1 pinch salt");
    t.ai.respond = () => reply({ ingredients: [pork] });
    await t.api("POST", `/api/recipes/${id}/nutrition`);
    expect(t.ai.calls.at(-1)!.body.reasoning).toEqual({ effort: "low" });
  });

  it("adding a lot of sugar raises the calories", async () => {
    const id = await recipe(10, "1 (5-pound) boneless pork butt roast");
    t.ai.respond = () => reply({ ingredients: [pork] });
    const before = (await t.api("POST", `/api/recipes/${id}/nutrition`)).body.calories;
    await t.api("PATCH", `/api/recipes/${id}`, { ingredients: "1 (5-pound) boneless pork butt roast\n4 1/4 cup white sugar", version: "current" });
    t.ai.respond = () => reply({ ingredients: [pork, sugar] });
    const after = (await t.api("POST", `/api/recipes/${id}/nutrition`)).body.calories;
    expect(after - before).toBe(329);
  });

  it("keeps what each line came to (for the breakdown), largest first", async () => {
    const id = await recipe(10, "1 (5-pound) boneless pork butt roast\n4 1/4 cup white sugar");
    t.ai.respond = () => reply({ ingredients: [sugar, pork] });
    const n = (await t.api("POST", `/api/recipes/${id}/nutrition`)).body;
    expect(n.perIngredient).toEqual([
      { line: "1 (5-pound) boneless pork butt roast", grams: 2268, calories: 5900 },
      { line: "4 1/4 cup white sugar", grams: 850, calories: 3290 },
    ]);
  });

  // Alex: "default 1 serving if none are specified" (a Ninja Creami pint is one serving; dividing
  // by 4 gave 70 kcal next to a serving size of half the pint)
  it("no servings given: the whole recipe is 1 serving", async () => {
    const id = await recipe(null, "4 1/4 cup white sugar");
    t.ai.respond = () => reply({ ingredients: [sugar] });
    expect((await t.api("POST", `/api/recipes/${id}/nutrition`)).body).toMatchObject({ calories: 3290, servings: 1 });
  });

  it("no servings given: the AI is told it's 1 serving, so its serving size matches the numbers", async () => {
    const id = (await t.api("POST", "/api/recipes", { title: "Ice cream", yieldText: "1 pint", ingredients: "300 ml chocolate milk" })).body.id as number;
    t.ai.respond = () => reply({ ingredients: [sugar] });
    expect((await t.api("POST", `/api/recipes/${id}/nutrition`)).body).toMatchObject({ servings: 1 });
    expect(t.ai.calls.at(-1)!.body.messages.at(-1).content).toContain("Makes: 1 pint (count it as 1 serving)");
  });

  it("a line with a missing or odd number counts as 0 for that number; no calories at all is an error", async () => {
    const id = await recipe(2, "1 cup rice\n1 tbsp butter");
    t.ai.respond = () => reply({ ingredients: [{ line: "1 cup rice", calories: "205 kcal", carbs: 45 }, { line: "1 tbsp butter", calories: 102, fat: "lots" }] });
    expect((await t.api("POST", `/api/recipes/${id}/nutrition`)).body).toMatchObject({ calories: 153.5, carbs: 22.5, fat: 0 });
    t.ai.respond = () => reply({ ingredients: [{ line: "1 cup rice" }] });
    expect((await t.api("POST", `/api/recipes/${id}/nutrition`)).status).toBe(502);
  });

  it("an AI that answers with one total per serving (the old way) still works", async () => {
    const id = await recipe(4, "1 cup rice");
    t.ai.respond = () => reply({ calories: 200, carbs: 45 });
    expect((await t.api("POST", `/api/recipes/${id}/nutrition`)).body).toMatchObject({ calories: 200, carbs: 45, source: "ai" });
  });
});
