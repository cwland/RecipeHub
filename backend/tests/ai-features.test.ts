import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { setupTestApp, type TestApp } from "./helpers.js";
import { nutritionOf } from "../src/lib/importRecipe.js";

let t: TestApp;
let png: Buffer;
beforeAll(async () => {
  t = await setupTestApp();
  png = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#f5e9d0" } }).png().toBuffer();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
  t.ai.calls.length = 0;
});

const reply = (obj: object) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
const claudeReply = (obj: object) => ({ status: 200, json: { content: [{ type: "text", text: JSON.stringify(obj) }] } });
// A cheap local model for quick jobs (can't see pictures), and Claude for the rest
const twoServices = () =>
  t.api("PUT", "/api/settings/ai", {
    enabled: true,
    maxPerRun: 50,
    services: [
      { name: "Home AI", provider: "local", baseUrl: "http://10.0.0.5:11434/v1", model: "qwen", quick: true, photos: false },
      { name: "Claude", provider: "anthropic", model: "claude-sonnet", apiKey: "sk-test", quick: false, photos: true },
    ],
  });
const upload = (files: Buffer[]) => {
  const b = "----recipehub";
  const payload = Buffer.concat([...files.flatMap((f, i) => [Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="photo"; filename="p${i}.png"\r\nContent-Type: image/png\r\n\r\n`), f, Buffer.from("\r\n")]), Buffer.from(`--${b}--\r\n`)]);
  return t.app.inject({ method: "POST", url: "/api/recipes/import/photos", payload, headers: { authorization: `Bearer ${t.getToken()}`, "content-type": `multipart/form-data; boundary=${b}` } });
};

describe("which AI does which job", () => {
  it("says whether AI and photo reading are there", async () => {
    expect((await t.api("GET", "/api/ai/status")).body).toEqual({ ready: false, photos: false, enhance: false });
    await twoServices();
    expect((await t.api("GET", "/api/ai/status")).body).toEqual({ ready: true, photos: true, enhance: true });
    await t.api("PUT", "/api/settings/features", { aiEnhance: false });
    expect((await t.api("GET", "/api/ai/status")).body.enhance).toBe(false);
    const s = (await t.api("GET", "/api/settings/ai")).body.settings.services;
    expect(s.map((x: any) => [x.name, x.quick, x.photos])).toEqual([["Home AI", true, false], ["Claude", false, true]]);
  });

  it("reads a recipe card photo with the service that can see, and keeps the dish photo", async () => {
    expect((await upload([png])).statusCode).toBe(409); // AI off
    await twoServices();
    t.ai.respond = () => claudeReply({ isRecipe: true, title: "Grandma's Shortbread", ingredients: ["1 cup butter", "1/2 cup sugar", "2 cups flour"], steps: ["Cream butter and sugar.", "Add flour, press into a pan, bake 25 min at 325°F."], servings: 16, dishPhoto: 2 });
    const r = await upload([png, png]);
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ kind: "import-photo", source: "Photos" });
    await t.app.jobs.drain();
    const job = (await t.api("GET", `/api/imports/${r.json().id}`)).body;
    expect(job).toMatchObject({ status: "done", result: { title: "Grandma's Shortbread", how: "photo" } });
    // only Claude was asked, with both pictures before the words
    expect(t.ai.calls).toHaveLength(1);
    expect(t.ai.calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    const content = t.ai.calls[0].body.messages[0].content;
    expect(content.map((c: any) => c.type)).toEqual(["image", "image", "text"]);
    expect(content[0].source.media_type).toBe("image/jpeg");
    const recipe = (await t.api("GET", `/api/recipes/${job.result.recipeId}`)).body;
    expect(recipe.ingredients).toHaveLength(3);
    expect(recipe.imageUrl).toMatch(/^\/api\/photos\/.+\.webp$/);
  });

  it("sends pictures in each provider's own format", async () => {
    for (const [provider, check] of [
      ["openai", (b: any) => expect(b.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/)],
      ["gemini", (b: any) => expect(b.contents[0].parts[0].inlineData.mimeType).toBe("image/jpeg")],
    ] as const) {
      await t.api("PUT", "/api/settings/ai", { enabled: true, maxPerRun: 50, services: [{ provider, model: "m", apiKey: "k" }] });
      t.ai.calls.length = 0;
      t.ai.respond = () =>
        provider === "gemini"
          ? { status: 200, json: { candidates: [{ content: { parts: [{ text: JSON.stringify({ isRecipe: false }) }] } }] } }
          : reply({ isRecipe: false });
      const r = await upload([png]);
      await t.app.jobs.drain();
      check(t.ai.calls[0].body);
      expect((await t.api("GET", `/api/imports/${r.json().id}`)).body.error).toMatch(/No recipe was found in the photo/);
    }
  });
});

describe("nutrition", () => {
  it("reads it from a recipe page", () => {
    expect(nutritionOf({ calories: "320 calories", fatContent: "12 g", sodiumContent: "0.5 g", proteinContent: "21g" }, 4)).toMatchObject({ calories: 320, fat: 12, sodium: 500, protein: 21, source: "site", servings: 4 });
    expect(nutritionOf({ "@type": "NutritionInformation" }, 4)).toBeNull();
  });

  it("estimates it with the quick AI, and you can type it in or clear it", async () => {
    const r = (await t.api("POST", "/api/recipes", { title: "Chili", servings: 6, ingredients: "2 lb ground beef\n1 can beans" })).body;
    expect((await t.api("POST", `/api/recipes/${r.id}/nutrition`)).status).toBe(409);
    await twoServices();
    t.ai.respond = () => reply({ calories: "410", fat: 22.4, saturatedFat: 8, carbs: 18, fiber: 6, sugar: 3, protein: 33, sodium: 640, note: "Assumed 80/20 beef." });
    const n = (await t.api("POST", `/api/recipes/${r.id}/nutrition`)).body;
    expect(n).toMatchObject({ calories: 410, protein: 33, source: "ai", servings: 6, note: "Assumed 80/20 beef." });
    expect(t.ai.calls[0].url).toBe("http://10.0.0.5:11434/v1/chat/completions"); // the quick one
    expect(t.ai.calls[0].body.messages[1].content).toContain("Makes: 6 servings");
    expect((await t.api("GET", `/api/recipes/${r.id}`)).body.nutrition.calories).toBe(410);
    await t.api("PUT", `/api/recipes/${r.id}/nutrition`, { calories: 380, protein: 30 });
    expect((await t.api("GET", `/api/recipes/${r.id}`)).body.nutrition).toMatchObject({ calories: 380, fat: null, source: "you", servings: 6 });
    await t.app.inject({ method: "PUT", url: `/api/recipes/${r.id}/nutrition`, payload: "null", headers: { authorization: `Bearer ${t.getToken()}`, "content-type": "application/json" } });
    expect((await t.api("GET", `/api/recipes/${r.id}`)).body.nutrition).toBeNull();
  });

  it("serving size: asked of the AI, kept from its answer, and can be typed in", async () => {
    const r = (await t.api("POST", "/api/recipes", { title: "Chili", servings: 6, ingredients: "2 lb ground beef\n1 can beans" })).body;
    await twoServices();
    t.ai.respond = () => reply({ calories: 410, servingSize: "About 1½ cups (340 g)", note: "" });
    expect((await t.api("POST", `/api/recipes/${r.id}/nutrition`)).body).toMatchObject({ servingSize: "About 1½ cups (340 g)" });
    expect(t.ai.calls[0].body.messages[0].content).toContain("servingSize");
    await t.api("PUT", `/api/recipes/${r.id}/nutrition`, { calories: 400, servingSize: "1 bowl" });
    expect((await t.api("GET", `/api/recipes/${r.id}`)).body.nutrition).toMatchObject({ servingSize: "1 bowl", source: "you" });
    await t.api("PUT", `/api/recipes/${r.id}/nutrition`, { calories: 400 });
    expect((await t.api("GET", `/api/recipes/${r.id}`)).body.nutrition.servingSize).toBeNull();
  });

  it("added sugars: asked of the AI, kept from its answer, and can be typed in", async () => {
    const r = (await t.api("POST", "/api/recipes", { title: "Cookies", servings: 12, ingredients: "1 cup sugar\n2 cups flour" })).body;
    await twoServices();
    t.ai.respond = () => reply({ calories: 180, sugar: 14, addedSugar: 12, note: "" });
    expect((await t.api("POST", `/api/recipes/${r.id}/nutrition`)).body).toMatchObject({ sugar: 14, addedSugar: 12 });
    expect(t.ai.calls[0].body.messages[0].content).toContain("addedSugar");
    await t.api("PUT", `/api/recipes/${r.id}/nutrition`, { calories: 170, sugar: 13, addedSugar: 11 });
    expect((await t.api("GET", `/api/recipes/${r.id}`)).body.nutrition).toMatchObject({ sugar: 13, addedSugar: 11, source: "you" });
    // left out: unknown
    await t.api("PUT", `/api/recipes/${r.id}/nutrition`, { calories: 170 });
    expect((await t.api("GET", `/api/recipes/${r.id}`)).body.nutrition.addedSugar).toBeNull();
  });
});

describe("grocery aisles", () => {
  // the sort is queued just after the answer goes out
  const settle = async () => (await new Promise((r) => setTimeout(r, 150)), await t.app.jobs.drain());
  it("asks AI where unknown items go, and remembers", async () => {
    const list = (await t.api("GET", "/api/grocery/lists")).body[0].id;
    await t.api("POST", `/api/grocery/lists/${list}/items`, { text: "gochujang, eggs" }); // AI off: stays in Other
    await settle();
    expect(t.ai.calls).toHaveLength(0);
    await twoServices();
    t.ai.respond = () => reply({ aisles: { gochujang: "pantry", furikake: "pantry" } });
    await t.api("POST", `/api/grocery/lists/${list}/items`, { text: "furikake" });
    await settle();
    const items = (await t.api("GET", `/api/grocery/lists/${list}/items`)).body;
    expect(items.map((i: any) => [i.name, i.aisle, i.aisleBy])).toEqual(
      expect.arrayContaining([["gochujang", "pantry", "ai"], ["furikake", "pantry", "ai"], ["eggs", "dairy", "words"]])
    );
    // next time it goes straight there, no AI needed
    for (const i of items) await t.api("DELETE", `/api/grocery/items/${i.id}`);
    t.ai.calls.length = 0;
    await t.api("POST", `/api/grocery/lists/${list}/items`, { text: "gochujang" });
    await settle();
    expect((await t.api("GET", `/api/grocery/lists/${list}/items`)).body[0]).toMatchObject({ aisle: "pantry" });
    expect(t.ai.calls).toHaveLength(0);
  });
});

describe("meal ideas", () => {
  it("suggests meals from the pantry, your recipes and what you ate lately", async () => {
    const tacos = (await t.api("POST", "/api/recipes", { title: "Fish Tacos", ingredients: "1 lb cod" })).body;
    await t.api("POST", "/api/pantry", { text: "cod, tortillas" });
    await t.api("POST", "/api/pantry", { name: "salt", staple: true });
    await twoServices();
    t.ai.respond = () => reply({ ideas: [{ title: "fish tacos", why: "Uses the cod before it goes.", recipeId: tacos.id, uses: ["cod", "tortillas"] }, { title: "Cod chowder", why: "Something new.", recipeId: 999, uses: ["cod"] }] });
    const r = await t.api("POST", "/api/ai/ideas", { ask: "something quick" });
    expect(r.body.ideas).toEqual([
      { title: "Fish Tacos", why: "Uses the cod before it goes.", recipeId: tacos.id, uses: ["cod", "tortillas"] },
      { title: "Cod chowder", why: "Something new.", recipeId: null, uses: ["cod"] }, // made-up ids are dropped
    ]);
    const asked = t.ai.calls[0].body.messages[1].content;
    expect(asked).toContain("They asked for: something quick");
    expect(asked).toContain("Pantry: cod, tortillas");
    expect(asked).toContain(`${tacos.id}: Fish Tacos`);
  });
});

describe("when an answer can't be read", () => {
  it("Settings › Logs shows what the model sent back and why it stopped", async () => {
    await t.api("PUT", "/api/settings/ai", { enabled: true, maxPerRun: 50, services: [{ name: "OpenRouter", provider: "openrouter", model: "anthropic/claude-haiku-5.5", apiKey: "k" }] });
    const r = (await t.api("POST", "/api/recipes", { title: "Chili", servings: 6, ingredients: "2 lb ground beef" })).body;
    t.ai.respond = () => ({ status: 200, json: { choices: [{ finish_reason: "length", message: { content: "Let me work through each ingredient. Ground beef, 2 lb: about" } }] } });
    expect((await t.api("POST", `/api/recipes/${r.id}/nutrition`)).status).toBe(502);
    const log = (await t.api("GET", "/api/logs?category=ai")).body[0];
    expect(log).toMatchObject({ level: "warning", source: "OpenRouter" });
    expect(log.detail).toContain("Let me work through each ingredient");
    expect(log.detail).toContain("length");
  });
});
