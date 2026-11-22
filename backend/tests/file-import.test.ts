import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { gzipSync, strToU8, zipSync } from "fflate";
import sharp from "sharp";
import { setupTestApp, type TestApp } from "./helpers.js";
import { readRecipeFile } from "../src/lib/fileImport.js";

// A Paprika 3 export: a zip with one gzip-compressed JSON file per recipe
const paprikaRecipe = (over: Record<string, unknown> = {}) => ({
  uid: "6E0A1C2B-0001",
  name: "Weeknight Chili",
  description: "Smoky and quick.",
  ingredients: "SAUCE:\n2 lb ground beef\n1 onion, diced\n\n2 tbsp chili powder",
  directions: "Brown the beef with the onion.\n\nStir in the chili powder.\nSimmer for 30 minutes.",
  notes: "Freezes well.",
  nutritional_info: "Calories: 410",
  servings: "6",
  prep_time: "15 min",
  cook_time: "1 hr",
  total_time: "1 hr 15 min",
  source: "Serious Eats",
  source_url: "https://www.seriouseats.com/chili",
  image_url: "https://www.seriouseats.com/chili.jpg",
  photo: "chili.jpg",
  photo_data: null as string | null,
  categories: ["Dinner", "Beef"],
  rating: 4,
  difficulty: "",
  created: "2023-04-02 18:00:00",
  hash: "abc",
  ...over,
});
const paprikaFile = (recipes: Record<string, unknown>[]) =>
  Buffer.from(zipSync(Object.fromEntries(recipes.map((r, i) => [`${i}-${String(r.name)}.paprikarecipe`, gzipSync(strToU8(JSON.stringify(r)))]))));

let jpeg: Buffer;
beforeAll(async () => {
  jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#a33" } }).jpeg().toBuffer();
});

describe("reading a Paprika export", () => {
  it("each recipe with its times, servings, source, categories, rating, notes and photo", () => {
    const { format, recipes, problems } = readRecipeFile("My Recipes.paprikarecipes", paprikaFile([paprikaRecipe({ photo_data: jpeg.toString("base64") })]));
    expect(format).toBe("Paprika");
    expect(problems).toEqual([]);
    expect(recipes).toHaveLength(1);
    const r = recipes[0];
    expect(r).toMatchObject({
      title: "Weeknight Chili",
      description: "Smoky and quick.",
      ingredients: ["SAUCE:", "2 lb ground beef", "1 onion, diced", "2 tbsp chili powder"],
      steps: ["Brown the beef with the onion.", "Stir in the chili powder.", "Simmer for 30 minutes."],
      servings: 6,
      prepMinutes: 15,
      cookMinutes: 60,
      totalMinutes: 75,
      sourceUrl: "https://www.seriouseats.com/chili",
      sourceName: "Serious Eats",
      categories: ["Dinner", "Beef"],
      rating: 4,
      notes: "Freezes well.\n\nNutrition: Calories: 410",
    });
    expect(r.photo?.equals(jpeg)).toBe(true);
  });

  it("servings written as words go to Makes; no rating stays empty; a recipe with no name is reported, not imported", () => {
    const { recipes, problems } = readRecipeFile(
      "export.paprikarecipes",
      paprikaFile([paprikaRecipe({ name: "Cookies", servings: "Makes 24 cookies", rating: 0, photo_data: null }), paprikaRecipe({ name: "", ingredients: "flour" })])
    );
    expect(recipes.map((r) => [r.title, r.servings, r.yieldText, r.rating, r.photo])).toEqual([["Cookies", 24, "Makes 24 cookies", null, null]]);
    expect(problems).toEqual([{ name: "1-.paprikarecipe", reason: "It has no name" }]);
  });

  it("a single recipe file (.paprikarecipe) works too", () => {
    const one = Buffer.from(gzipSync(strToU8(JSON.stringify(paprikaRecipe()))));
    expect(readRecipeFile("Chili.paprikarecipe", one).recipes.map((r) => r.title)).toEqual(["Weeknight Chili"]);
  });

  it("a file it doesn't know says so", () => {
    expect(() => readRecipeFile("notes.txt", Buffer.from("hello"))).toThrow("isn't a recipe file RecipeHub can read");
  });
});

describe("importing a file", () => {
  let t: TestApp;
  beforeAll(async () => (t = await setupTestApp()));
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.login();
  });
  const upload = (name: string, file: Buffer) => {
    const b = "----recipehub";
    const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`)]);
    return t.app.inject({ method: "POST", url: "/api/recipes/import/file", payload, headers: { authorization: `Bearer ${t.getToken()}`, "content-type": `multipart/form-data; boundary=${b}` } });
  };
  const run = async (name: string, file: Buffer) => {
    const r = await upload(name, file);
    expect(r.statusCode).toBe(202);
    await t.app.jobs.drain();
    return (await t.api("GET", `/api/imports/${r.json().id}`)).body;
  };

  it("doesn't ask AI for the nutrition of every recipe in the file", async () => {
    await t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
    await t.api("PUT", "/api/settings/features", { aiEnhance: false });
    await run("My Recipes.paprikarecipes", paprikaFile([paprikaRecipe(), paprikaRecipe({ name: "Toast", source_url: "", source: "", ingredients: "2 slices bread" })]));
    expect(t.ai.calls.filter((c) => String(c.body.messages[0].content).startsWith("You estimate nutrition"))).toHaveLength(0);
  });

  it("adds every recipe with its photo, categories and your rating, then skips them the second time", async () => {
    const file = paprikaFile([paprikaRecipe({ photo_data: jpeg.toString("base64") }), paprikaRecipe({ name: "Toast", source_url: "", source: "", ingredients: "2 slices bread", categories: [], rating: 0 })]);
    const job = await run("My Recipes.paprikarecipes", file);
    expect(job).toMatchObject({ status: "done", source: "My Recipes.paprikarecipes", result: { format: "Paprika", imported: 2, skipped: 0, problems: [] } });
    const list = (await t.api("GET", "/api/recipes?sort=title")).body.recipes;
    expect(list.map((r: any) => r.title)).toEqual(["Toast", "Weeknight Chili"]);
    const chili = (await t.api("GET", `/api/recipes/${list[1].id}`)).body;
    expect(chili).toMatchObject({ servings: 6, totalMinutes: 75, sourceName: "Serious Eats", notes: "Freezes well.\n\nNutrition: Calories: 410", me: { rating: 4 } });
    expect(chili.categories.map((c: any) => c.name).sort()).toEqual(["Beef", "Dinner"]);
    expect(chili.ingredients[0]).toMatchObject({ section: "SAUCE" });
    expect(chili.imageUrl).toMatch(/^\/api\/photos\/.+\.webp$/);
    expect((await t.app.inject({ method: "GET", url: chili.imageUrl })).statusCode).toBe(200);
    // the same file again: nothing doubled
    expect((await run("My Recipes.paprikarecipes", file)).result).toMatchObject({ imported: 0, skipped: 2 });
    expect((await t.api("GET", "/api/recipes")).body.total).toBe(2);
  });

  it("an unreadable file fails with a reason", async () => {
    const job = await run("broken.paprikarecipes", Buffer.from("not a zip"));
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/couldn't be opened/);
  });
});
