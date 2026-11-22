import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
  t.ai.calls.length = 0;
});

const reply = (obj: object) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
const aiOn = () => t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
const chili = async () =>
  (await t.api("POST", "/api/recipes", { title: "Chili", servings: 4, ingredients: "1 lb chicken\n1 onion", steps: ["Cook the chicken."], categories: ["Dinner"], tags: ["spicy"] })).body;
const full = {
  steps: ["Cook the chicken until it reaches 165°F, about 6 minutes a side."],
  stepChanges: ["Added how long to cook the chicken and the safe temperature."],
  ingredients: ["1 lb chicken breast", "1 onion, diced"],
  ingredientChanges: ["Chicken: breast, as the cooking time suits.", "Onion: diced, as the steps use it."],
  nutrition: { calories: 320, fat: 9, saturatedFat: 2, carbs: 6, fiber: 1, sugar: 2, addedSugar: 1, protein: 48, sodium: 600, servingSize: "About 1 cup", note: "Assumed chicken breast." },
  nutritionChanges: ["Estimated from the ingredients."],
  categories: ["Dinner", "Soup"],
  tags: ["spicy", "chicken"],
  organizeChanges: ["Added Soup: it's a stew.", "Added chicken: the main ingredient."],
};

// Nutrition in the AI check: worked out per ingredient and added up by RecipeHub, the same way as
// Estimate / Re-analyze, so the number you accept at import is the one Re-analyze gives
describe("nutrition in the AI check", () => {
  const perIngredient = {
    ingredients: [
      { line: "1 lb chicken breast", grams: 454, calories: 545, fat: 12, saturatedFat: 3, carbs: 0, fiber: 0, sugar: 0, addedSugar: 0, protein: 102, sodium: 300 },
      { line: "1 onion, diced", grams: 110, calories: 44, fat: 0, saturatedFat: 0, carbs: 10, fiber: 2, sugar: 5, addedSugar: 0, protein: 1, sodium: 4 },
    ],
    servingSize: "About 1 cup (250 g)",
  };
  const answers = (check: object = full) => (_u: string, body: any) => reply(String(body.messages[0].content).startsWith("You estimate nutrition") ? perIngredient : check);

  it("is worked out per ingredient (of the ingredients as the check suggests them), and added up", async () => {
    await aiOn();
    const r = await chili();
    t.ai.respond = answers();
    const e = (await t.api("POST", `/api/recipes/${r.id}/enhance`)).body;
    const asked = t.ai.calls.find((c) => String(c.body.messages[0].content).startsWith("You estimate nutrition"))!;
    expect(asked.body.messages[1].content).toContain("- 1 lb chicken breast\n- 1 onion, diced");
    // (545 + 44) / 4 servings
    expect(e.nutrition).toMatchObject({ changed: true, suggested: { calories: 147.3, protein: 25.8, source: "ai", servings: 4, servingSize: "About 1 cup (250 g)" } });
    expect(e.nutrition.suggested.perIngredient).toEqual([
      { line: "1 lb chicken breast", grams: 454, calories: 545 },
      { line: "1 onion, diced", grams: 110, calories: 44 },
    ]);
    expect(e.nutrition.changes).toEqual(["Worked out from each ingredient: about 147 kcal per serving."]);
  });

  it("accepting it gives the same numbers Re-analyze does", async () => {
    await aiOn();
    const r = await chili();
    t.ai.respond = answers();
    const e = (await t.api("POST", `/api/recipes/${r.id}/enhance`)).body;
    expect((await t.api("POST", `/api/recipes/${r.id}/enhance/apply`, { ingredients: e.ingredients.suggested, nutrition: e.nutrition.suggested })).status).toBe(200);
    const accepted = (await t.api("GET", `/api/recipes/${r.id}`)).body.nutrition;
    const again = (await t.api("POST", `/api/recipes/${r.id}/nutrition`)).body;
    expect(again.calories).toBe(accepted.calories);
    expect(again.protein).toBe(accepted.protein);
  });

  it("already worked out per ingredient (Calculate nutrition in Discover, Re-analyze), ingredients unchanged: not asked again", async () => {
    await aiOn();
    const r = await chili();
    t.ai.respond = answers();
    await t.api("POST", `/api/recipes/${r.id}/nutrition`); // per ingredient
    const calls = t.ai.calls.length;
    t.ai.respond = answers({ ...full, ingredients: ["1 lb chicken", "1 onion"], ingredientChanges: [] });
    const e = (await t.api("POST", `/api/recipes/${r.id}/enhance`)).body;
    expect(t.ai.calls.slice(calls).map((c) => String(c.body.messages[0].content).slice(0, 22))).toEqual(["You check home recipes"]);
    expect(e.nutrition.changed).toBe(false);
  });

  it("already worked out, but the check changes the ingredients: worked out again", async () => {
    await aiOn();
    const r = await chili();
    t.ai.respond = answers();
    await t.api("POST", `/api/recipes/${r.id}/nutrition`);
    const calls = t.ai.calls.length;
    await t.api("POST", `/api/recipes/${r.id}/enhance`);
    expect(t.ai.calls.slice(calls).some((c) => String(c.body.messages[0].content).startsWith("You estimate nutrition"))).toBe(true);
  });

  it("says how it compares with what was there", async () => {
    await aiOn();
    const r = await chili();
    await t.api("PUT", `/api/recipes/${r.id}/nutrition`, { calories: 410 });
    t.ai.respond = answers();
    const e = (await t.api("POST", `/api/recipes/${r.id}/enhance`)).body;
    expect(e.nutrition.changes).toEqual(["Worked out from each ingredient: about 147 kcal per serving (was 410)."]);
  });

  it("if that request fails, the rest of the check still comes through", async () => {
    await aiOn();
    const r = await chili();
    t.ai.respond = (_u: string, body: any) => (String(body.messages[0].content).startsWith("You estimate nutrition") ? { status: 500, json: { error: { message: "overloaded" } } } : reply(full));
    const res = await t.api("POST", `/api/recipes/${r.id}/enhance`);
    expect(res.status).toBe(200);
    expect(res.body.steps.changed).toBe(true);
    expect(res.body.nutrition).toEqual({ suggested: null, changes: [], changed: false });
  });

  it("no ingredients: no nutrition request", async () => {
    await aiOn();
    const r = (await t.api("POST", "/api/recipes", { title: "Mystery", steps: ["Cook it."] })).body;
    t.ai.respond = answers({ steps: ["Cook it until done, about 10 minutes."], stepChanges: ["Added a time."] });
    await t.api("POST", `/api/recipes/${r.id}/enhance`);
    expect(t.ai.calls.some((c) => String(c.body.messages[0].content).startsWith("You estimate nutrition"))).toBe(false);
  });
});

describe("the AI corrects ingredients; it never adds them", () => {
  const check = async (ingredients: string, suggested: string[], changes: string[] = []) => {
    await aiOn();
    const r = (await t.api("POST", "/api/recipes", { title: "Soup", ingredients, steps: ["Simmer everything."] })).body;
    t.ai.respond = () => reply({ ingredients: suggested, ingredientChanges: changes });
    return (await t.api("POST", `/api/recipes/${r.id}/enhance`)).body.ingredients;
  };

  it("an added ingredient (salt and pepper, say) is dropped, and so is its note", async () => {
    const e = await check("1 lb chicken\n1 onion", ["1 lb chicken", "1 onion, diced", "1 tsp salt", "1/2 tsp freshly ground black pepper"], ["Onion: diced, as the steps use it.", "Added salt and pepper to season."]);
    expect(e.suggested).toEqual(["1 lb chicken", "1 onion, diced"]);
    expect(e.changes).toEqual(["Onion: diced, as the steps use it."]);
  });

  it("corrections and tidying stay: amounts as numbers, a clearer name, one line split in two", async () => {
    const e = await check("Two pounds of chuck\nkosher salt and pepper to taste\n1 bunch cilantro", ["2 lb chuck roast", "kosher salt, to taste", "black pepper, to taste", "1 bunch fresh cilantro"]);
    expect(e.suggested).toEqual(["2 lb chuck roast", "kosher salt, to taste", "black pepper, to taste", "1 bunch fresh cilantro"]);
  });

  it("headings the AI groups lines under are fine", async () => {
    const e = await check("1 cup flour\n2 eggs\n1 cup sugar", ["# Dry", "1 cup flour", "1 cup sugar", "# Wet", "2 eggs"]);
    expect(e.suggested).toEqual(["# Dry", "1 cup flour", "1 cup sugar", "# Wet", "2 eggs"]);
  });

  it("when all it did was add, there's no ingredient change to offer", async () => {
    const e = await check("1 lb chicken\n1 onion", ["1 lb chicken", "1 onion", "2 cloves garlic"], ["Added garlic."]);
    expect(e).toMatchObject({ changed: false });
  });

  it("it's told not to add ingredients", async () => {
    await check("1 lb chicken", ["1 lb chicken"]);
    const system = String(t.ai.calls[0].body.messages[0].content);
    expect(system).toMatch(/Never add an ingredient/);
    expect(system).not.toMatch(/Add an ingredient only if/);
  });
});

describe("asking AI to check a recipe", () => {
  it("suggests fixes for each section and changes nothing in the recipe", async () => {
    await aiOn();
    const r = await chili();
    t.ai.respond = () => reply(full);
    const res = await t.api("POST", `/api/recipes/${r.id}/enhance`);
    expect(res.status).toBe(200);
    const e = res.body;
    expect(e.steps).toMatchObject({ suggested: full.steps, changed: true });
    expect(e.steps.changes.length).toBeGreaterThan(0);
    expect(e.ingredients).toMatchObject({ suggested: full.ingredients, changed: true, changes: full.ingredientChanges });
    expect(e.nutrition.changed).toBe(false); // nutrition comes from its own per-ingredient request (below)
    expect(e.organize).toMatchObject({ tags: ["spicy", "chicken"], changed: true });
    // what the AI was told
    const sent = t.ai.calls[0].body.messages[1].content as string;
    for (const bit of ["Chili", "1 lb chicken", "Cook the chicken.", "Dinner", "spicy", "Breakfast"]) expect(sent).toContain(bit);
    expect(t.ai.calls[0].body.messages[0].content).not.toMatch(/"nutrition"/); // the check doesn't guess nutrition
    // nothing saved
    const after = (await t.api("GET", `/api/recipes/${r.id}`)).body;
    expect(after.steps).toEqual([{ text: "Cook the chicken." }]);
    expect(after.ingredients.map((i: any) => i.raw)).toEqual(["1 lb chicken", "1 onion"]);
    expect(after.nutrition).toBeNull();
    expect(after.tags).toEqual(["spicy"]);
  });

  it("ingredient amounts it writes in words come back as numbers; it's told to use numbers", async () => {
    await aiOn();
    const r = await chili();
    t.ai.respond = () => reply({ ...full, ingredients: ["One pound of chicken", "1 onion"] });
    const e = (await t.api("POST", `/api/recipes/${r.id}/enhance`)).body;
    expect(e.ingredients.suggested).toEqual(["1 lb chicken", "1 onion"]);
    expect(t.ai.calls[0].body.messages[0].content).toMatch(/amounts as numbers/i);
  });

  it("a section the AI leaves out shows no changes", async () => {
    await aiOn();
    const r = await chili();
    const { nutrition: _n, nutritionChanges: _c, steps: _s, ...rest } = full;
    t.ai.respond = () => reply(rest);
    const e = (await t.api("POST", `/api/recipes/${r.id}/enhance`)).body;
    expect(e.nutrition).toEqual({ suggested: null, changes: [], changed: false });
    expect(e.steps).toEqual({ suggested: ["Cook the chicken."], changes: [], changed: false, mode: null });
    expect(e.ingredients.changed).toBe(true);
  });

  it("the same lines, categories and tags count as no change", async () => {
    await aiOn();
    const r = await chili();
    t.ai.respond = () => reply({ steps: [" Cook the chicken. "], ingredients: ["1 lb chicken", "1 onion"], categories: ["dinner"], tags: ["Spicy"] });
    const e = (await t.api("POST", `/api/recipes/${r.id}/enhance`)).body;
    expect([e.steps.changed, e.ingredients.changed, e.organize.changed]).toEqual([false, false, false]);
    expect(e.organize.categories).toEqual(["Dinner"]);
    expect(e.organize.tags).toEqual(["spicy"]);
  });

  it("categories come from yours; a new one is marked", async () => {
    await aiOn();
    const r = await chili();
    t.ai.respond = () => reply(full);
    const e = (await t.api("POST", `/api/recipes/${r.id}/enhance`)).body;
    expect(e.organize.categories).toEqual(["Dinner", "Soup"]);
    expect(e.organize.newCategories).toEqual(["Soup"]);
  });

  it("is refused when AI Enhance or AI is off, and for a recipe that isn't there", async () => {
    const r = await chili();
    expect((await t.api("POST", `/api/recipes/${r.id}/enhance`)).status).toBe(409);
    await aiOn();
    await t.api("PUT", "/api/settings/features", { aiEnhance: false });
    expect((await t.api("POST", `/api/recipes/${r.id}/enhance`)).status).toBe(409);
    await t.api("PUT", "/api/settings/features", { aiEnhance: true, ai: false });
    expect((await t.api("POST", `/api/recipes/${r.id}/enhance`)).status).toBe(409);
    await t.api("PUT", "/api/settings/features", { ai: true });
    expect((await t.api("POST", `/api/recipes/99999/enhance`)).status).toBe(404);
    expect(t.ai.calls).toHaveLength(0);
  });
});

describe("applying AI changes", () => {
  const apply = (id: number, body: object) => t.api("POST", `/api/recipes/${id}/enhance/apply`, body);

  it("applies only the sections sent", async () => {
    await aiOn();
    const r = await chili();
    const res = await apply(r.id, { steps: ["# Cook", "Cook the chicken until it reaches 165°F."] });
    expect(res.status).toBe(200);
    expect(res.body.steps).toEqual([{ text: "Cook", section: "Cook" }, { text: "Cook the chicken until it reaches 165°F." }]);
    expect(res.body.ingredients.map((i: any) => i.raw)).toEqual(["1 lb chicken", "1 onion"]);
    expect(res.body.tags).toEqual(["spicy"]);
    expect(res.body.categories.map((c: any) => c.name)).toEqual(["Dinner"]);
  });

  it("new categories are created; a tag differing only in capitals reuses the existing one", async () => {
    await aiOn();
    await t.api("POST", "/api/recipes", { title: "Tacos", tags: ["chicken"] });
    const r = await chili();
    const tagsBefore = (await t.api("GET", "/api/tags")).body.length;
    const res = await apply(r.id, { categories: ["Dinner", "Soup"], tags: ["spicy", "Chicken"] });
    expect(res.body.categories.map((c: any) => c.name)).toEqual(["Dinner", "Soup"]);
    expect(res.body.tags).toEqual(["chicken", "spicy"]);
    expect((await t.api("GET", "/api/tags")).body.length).toBe(tagsBefore);
    expect((await t.api("GET", "/api/categories")).body.map((c: any) => c.name)).toContain("Soup");
  });

  it("applying to a deleted recipe answers 404; applying is refused when AI Enhance is off", async () => {
    await aiOn();
    const r = await chili();
    await t.api("PUT", "/api/settings/features", { aiEnhance: false });
    expect((await apply(r.id, { steps: ["x"] })).status).toBe(409);
    await t.api("PUT", "/api/settings/features", { aiEnhance: true });
    await t.api("DELETE", `/api/recipes/${r.id}`);
    const res = await apply(r.id, { steps: ["x"] });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Recipe/);
  });
});

describe("review fixes", () => {
  const apply = (id: number, body: object) => t.api("POST", `/api/recipes/${id}/enhance/apply`, body);

  it("an apply that fails changes nothing, and makes no version", async () => {
    await aiOn();
    const r = await chili();
    await apply(r.id, { steps: ["First AI version."] });
    const bad = await apply(r.id, { steps: ["bad\u0000line"], tags: ["broken"] }); // the database refuses this text
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const now = (await t.api("GET", `/api/recipes/${r.id}`)).body;
    expect(now.steps).toEqual([{ text: "First AI version." }]);
    expect(now.tags).toEqual(["spicy"]);
    expect((await t.api("GET", `/api/recipes/${r.id}/versions`)).body.map((v: any) => v.number)).toEqual([2, 1]);
  });

  it("an unreadable answer, or one with none of the parts, is a 502 with a log entry", async () => {
    await aiOn();
    const r = await chili();
    t.ai.respond = () => ({ status: 200, json: { choices: [{ message: { content: "Sorry, I can't help with that." } }] } });
    expect((await t.api("POST", `/api/recipes/${r.id}/enhance`)).status).toBe(502);
    t.ai.respond = () => reply({ error: "context too long" });
    const res = await t.api("POST", `/api/recipes/${r.id}/enhance`);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/didn't send any suggestions/);
    const logs = (await t.api("GET", "/api/logs?category=ai")).body.map((l: any) => l.event);
    expect(logs.some((e: string) => /couldn't be read/.test(e))).toBe(true);
    expect(logs.some((e: string) => /no suggestions/.test(e))).toBe(true);
  });
});

describe("live progress and fuller instructions", () => {
  // The wizard asks for progress lines (application/x-ndjson): one JSON object per line
  const stream = async (id: number) => {
    const res = await t.app.inject({ method: "POST", url: `/api/recipes/${id}/enhance`, headers: { authorization: `Bearer ${t.getToken()}`, accept: "application/x-ndjson" } });
    expect(res.headers["content-type"]).toMatch(/application\/x-ndjson/);
    return res.body.trim().split("\n").map((l) => JSON.parse(l));
  };
  const texts = (lines: any[]) => lines.filter((l) => l.type === "step").map((l) => l.text as string);

  it("says what it's doing, step by step, then sends the suggestions", async () => {
    await aiOn();
    const r = await chili();
    t.ai.respond = (_u: string, body: any) => reply(String(body.messages[0].content).startsWith("You estimate nutrition") ? { ingredients: [{ line: "1 lb chicken breast", calories: 1200 }, { line: "1 onion, diced", calories: 80 }] } : full);
    const lines = await stream(r.id);
    const said = texts(lines);
    expect(said[0]).toBe("Reading “Chili”: 2 ingredients, 1 step");
    expect(said).toContain("Asking OpenAI (tiny)…");
    expect(said).toContain("Answer received from OpenAI");
    expect(said.some((s) => /^Instructions: /.test(s))).toBe(true);
    expect(said).toContain("Ingredients: 2 corrected");
    expect(said).toContain("Working out nutrition from each ingredient…");
    expect(said).toContain("Nutrition: estimated, 320 kcal per serving"); // (1200 + 80) / 4
    expect(said).toContain("Categories and tags: 1 new category, 1 tag added");
    const asking = lines.find((l) => l.text === "Asking OpenAI (tiny)…");
    expect(asking.waiting).toBe(true); // the wizard shows a timer on this line
    const last = lines.at(-1);
    expect(last.type).toBe("result");
    expect(last.enhancement.steps.suggested).toEqual(full.steps);
  });

  it("shows when one AI service doesn't answer and the next one is asked", async () => {
    await t.api("PUT", "/api/settings/ai", {
      maxPerRun: 50,
      services: [
        { name: "Home AI", provider: "local", baseUrl: "http://10.0.0.5:11434/v1", model: "qwen3-vl:32b" },
        { name: "Claude", provider: "openai", model: "big", apiKey: "k" },
      ],
    });
    const r = await chili();
    t.ai.respond = (url) => (url.includes("10.0.0.5") ? { status: 500, json: { error: { message: "out of memory" } } } : reply(full));
    const said = texts(await stream(r.id));
    expect(said).toContain("Asking Home AI (qwen3-vl:32b)…");
    expect(said.some((s) => /^Home AI didn't answer .*Asking Claude…$/.test(s))).toBe(true);
    expect(said).toContain("Answer received from Claude");
  });

  it("a failure ends the progress with the reason", async () => {
    await aiOn();
    const r = await chili();
    t.ai.respond = () => ({ status: 200, json: { choices: [{ message: { content: "no idea" } }] } });
    const last = (await stream(r.id)).at(-1);
    expect(last).toMatchObject({ type: "error", status: 502 });
    expect(last.error).toMatch(/couldn't be read/);
  });

  it("brief steps are expanded into detailed, grouped steps; detailed ones only get gaps filled", async () => {
    await aiOn();
    const brief = (await t.api("POST", "/api/recipes", { title: "Pork Chops", ingredients: "2 pork chops\nsalt\npepper", steps: ["Salt and pepper pork chops", "Brown pork chops to 135 degrees", "Rest"] })).body;
    const expanded = ["# Prep and Season", "Pat dry: Pat the chops dry with paper towels so they sear well.", "Season: Season both sides with salt and pepper.", "# Sear", "Brown: Sear 3–5 minutes per side until golden and 145°F inside.", "Rest: Rest 5 minutes on a warm plate."];
    t.ai.respond = () => reply({ steps: expanded, stepMode: "expanded", stepChanges: ["Expanded the steps; 145°F is the USDA safe temperature for pork (was 135)."] });
    const e = (await t.api("POST", `/api/recipes/${brief.id}/enhance`)).body;
    const checks = () => t.ai.calls.filter((c) => String(c.body.messages[0].content).startsWith("You check home recipes"));
    const prompt = checks().at(-1)!.body.messages[1].content as string;
    expect(prompt).toMatch(/brief: expand them/i);
    expect(e.steps).toMatchObject({ suggested: expanded, mode: "expanded", changed: true });
    // a recipe with full steps is only filled in
    const detailed = (await t.api("POST", "/api/recipes", {
      title: "Braise",
      ingredients: "2 lb beef chuck",
      steps: [
        "Season the beef chuck all over with salt and pepper and let it sit at room temperature for 30 minutes.",
        "Heat oil in a Dutch oven over medium-high heat and brown the beef on all sides, about 10 minutes in total.",
        "Add the stock, cover, and braise in a 325°F oven for 3 hours until fork tender.",
        "Rest the beef for 10 minutes, then slice against the grain and serve with the braising liquid.",
      ],
    })).body;
    t.ai.respond = () => reply({ steps: ["Season the beef chuck all over with salt and pepper and let it sit at room temperature for 30 minutes.", "x"], stepChanges: ["Filled a gap."] });
    const e2 = (await t.api("POST", `/api/recipes/${detailed.id}/enhance`)).body;
    expect(checks().at(-1)!.body.messages[1].content).toMatch(/detailed: fill gaps only/i);
    expect(e2.steps.mode).toBe("filled");
  });
});
