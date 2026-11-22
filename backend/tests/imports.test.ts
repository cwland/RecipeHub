import fs from "node:fs";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
let png: Buffer;
beforeAll(async () => {
  t = await setupTestApp();
  png = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#e07a3f" } }).png().toBuffer();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const ld = (r: object) => `<html><head><meta property="og:site_name" content="Serious Eats"><script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", ...r })}</script></head><body></body></html>`;
const chili = { name: "Texas Chili", recipeIngredient: ["2 lb chuck, cubed", "3 dried anchos"], recipeInstructions: ["Brown the beef.", "Simmer 2 hours."], totalTime: "PT2H30M", image: "https://img.test/chili.jpg", recipeCategory: "Main Course" };
const importUrl = async (url: string, extra: object = {}) => {
  const r = await t.api("POST", "/api/recipes/import", { url, ...extra });
  await t.app.jobs.drain();
  return (await t.api("GET", `/api/imports/${r.body.id}`)).body;
};
const aiReply = (obj: object) => () => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
const turnOnAi = () => t.api("PUT", "/api/settings/ai", { services: [{ name: "Home AI", provider: "local", baseUrl: "http://10.0.0.5:11434/v1", model: "qwen" }], maxPerRun: 50 });

describe("importing a link", () => {
  it("reads schema.org data, saves the photo here, matches your category", async () => {
    t.web.pages["https://www.seriouseats.com/texas-chili?utm_source=pin"] = { body: ld(chili) };
    t.web.pages["https://img.test/chili.jpg"] = { type: "image/png", body: png };
    const job = await importUrl("https://www.seriouseats.com/texas-chili?utm_source=pin");
    expect(job).toMatchObject({ status: "done", source: "https://www.seriouseats.com/texas-chili?utm_source=pin", result: { title: "Texas Chili", how: "schema.org" } });
    const r = (await t.api("GET", `/api/recipes/${job.result.recipeId}`)).body;
    expect(r).toMatchObject({ title: "Texas Chili", totalMinutes: 150, sourceName: "Serious Eats", sourceUrl: "https://www.seriouseats.com/texas-chili?utm_source=pin", createdBy: 1 });
    expect(r.categories.map((c: any) => c.name)).toEqual(["Dinner"]);
    expect(r.ingredients[0]).toMatchObject({ quantity: 2, unit: "lb", name: "chuck", note: "cubed" });
    // the photo is a local copy, resized to 1600 px, and anyone can load it (pictures can't sign in)
    expect(r.imageUrl).toMatch(/^\/api\/photos\/[0-9a-f-]{36}\.webp$/);
    const img = await t.app.inject({ method: "GET", url: r.imageUrl });
    expect([img.statusCode, img.headers["content-type"]]).toEqual([200, "image/webp"]);
    expect((await sharp(img.rawPayload).metadata()).width).toBe(1600);
    expect((await t.app.inject({ method: "GET", url: "/api/photos/../../etc/passwd" })).statusCode).toBe(404);
    // in Settings › Logs
    expect((await t.api("GET", "/api/logs?category=import")).body[0]).toMatchObject({ level: "info", event: 'Imported "Texas Chili"' });
  });

  it("amounts written in words come in as numbers, so they scale", async () => {
    t.web.pages["https://example.test/squash"] = { body: ld({ name: "Spaghetti Squash Bake", recipeIngredient: ["One medium spaghetti squash, about 2 to 3 lbs", "One pound of ground Italian sausage", "6 tbsp olive oil"], recipeInstructions: ["Roast."] }) };
    const job = await importUrl("https://example.test/squash");
    const r = (await t.api("GET", `/api/recipes/${job.result.recipeId}`)).body;
    expect(r.ingredients.map((i: any) => i.raw)).toEqual(["1 medium spaghetti squash, about 2 to 3 lbs", "1 lb ground Italian sausage", "6 tbsp olive oil"]);
    expect(r.ingredients[1]).toMatchObject({ quantity: 1, unit: "lb", name: "ground Italian sausage" });
  });

  it("the AI is told to write amounts as numbers", async () => {
    await turnOnAi();
    t.web.pages["https://example.test/plain"] = { body: "<html><body><h1>Soup</h1><p>One onion. Simmer.</p></body></html>" };
    t.ai.respond = aiReply({ isRecipe: true, title: "Soup", ingredients: ["One onion"], steps: ["Simmer."] });
    const job = await importUrl("https://example.test/plain");
    expect(t.ai.calls[0].body.messages[0].content).toMatch(/amounts as numbers/i);
    expect((await t.api("GET", `/api/recipes/${job.result.recipeId}`)).body.ingredients[0].raw).toBe("1 onion");
  });

  it("knows a page it already has, unless you insist", async () => {
    t.web.pages["https://seriouseats.com/texas-chili"] = { body: ld({ ...chili, image: undefined }) };
    t.web.pages["https://www.seriouseats.com/texas-chili/#comments"] = t.web.pages["https://seriouseats.com/texas-chili"];
    const first = await importUrl("https://seriouseats.com/texas-chili");
    expect(first.error).toBeNull();
    const again = await importUrl("https://www.seriouseats.com/texas-chili/#comments");
    expect(again.result).toEqual({ duplicateOf: first.result.recipeId });
    expect((await t.api("GET", "/api/logs?category=import")).body[0]).toMatchObject({ level: "info", event: 'Already saved: "Texas Chili"', source: "https://www.seriouseats.com/texas-chili/#comments" });
    const retry = await t.api("POST", `/api/imports/${again.id}/retry`, { force: true });
    await t.app.jobs.drain();
    expect((await t.api("GET", `/api/imports/${retry.body.id}`)).body.result.recipeId).toBeGreaterThan(first.result.recipeId);
  });

  it("follows redirects; a photo that won't download stays linked, with a warning", async () => {
    t.web.pages["https://short.test/abc"] = { status: 301, body: "", location: "https://food.test/real" };
    t.web.pages["https://food.test/real"] = { body: ld(chili) };
    const job = await importUrl("https://short.test/abc");
    expect(job.status).toBe("done");
    expect(job.result.warnings[0]).toMatch(/photo couldn't be saved/);
    expect((await t.api("GET", `/api/recipes/${job.result.recipeId}`)).body).toMatchObject({ imageUrl: "https://img.test/chili.jpg", sourceUrl: "https://food.test/real" });
  });

  it("explains what went wrong", async () => {
    t.web.pages["https://blocked.test/r"] = { status: 403, body: "no" };
    expect((await importUrl("https://blocked.test/r")).error).toMatch(/turned the request away \(403\)/);
    expect((await importUrl("https://nowhere.test/r")).error).toMatch(/answered 404/);
    t.web.pages["https://plain.test/r"] = { body: "<html><body><p>My vacation photos</p></body></html>" };
    expect((await importUrl("https://plain.test/r")).error).toMatch(/AI is off/);
    expect((await t.api("POST", "/api/recipes/import", { url: "ftp://x" })).status).toBe(400);
    expect((await t.api("POST", "/api/recipes/import", { url: "https://a.test", text: "both" })).status).toBe(400);
    expect((await t.api("GET", "/api/logs?category=import")).body[0]).toMatchObject({ level: "warning", event: "Couldn't import a recipe" });
  });

  it("won't fetch from the server itself", async () => {
    const own = await setupTestApp();
    await own.reset();
    await own.login();
    const r = await own.api("POST", "/api/recipes/import", { url: "http://127.0.0.1:4000/api/keys", wait: 5 });
    expect(r.body.error).toMatch(/points at the server itself/);
    await own.close();
  });

  it("no recipe data: the page's text goes to your AI", async () => {
    await turnOnAi();
    t.web.pages["https://www.tiktok.com/@cook/video/1"] = { body: `<html><head><meta property="og:description" content="Garlic noodles! 1 lb noodles, 4 cloves garlic"></head><body><p>video</p></body></html>` };
    t.ai.respond = aiReply({ isRecipe: true, title: "Garlic Noodles", ingredients: ["1 lb noodles", "4 cloves garlic"], steps: ["Boil noodles.", "Toss with garlic butter."], servings: 2, totalMinutes: 15, tags: ["noodles"] }) as any;
    const job = await importUrl("https://www.tiktok.com/@cook/video/1");
    expect(job.result).toMatchObject({ title: "Garlic Noodles", how: "ai" });
    expect(t.ai.calls[0].body.messages[1].content).toContain("Garlic noodles! 1 lb noodles");
    const r = (await t.api("GET", `/api/recipes/${job.result.recipeId}`)).body;
    expect(r).toMatchObject({ servings: 2, totalMinutes: 15, tags: ["noodles"], sourceName: "tiktok.com" });
    // the AI says there's no recipe
    t.web.pages["https://blog.test/post"] = { body: "<html><body><p>Hi</p></body></html>" };
    t.ai.respond = aiReply({ isRecipe: false }) as any;
    expect((await importUrl("https://blog.test/post")).error).toBe("No recipe was found there.");
  });
});

describe("importing pasted text", () => {
  const text = "Weeknight Fried Rice\nServes 2\n\nIngredients\n2 cups cooked rice\n2 eggs\n\nDirections\nScramble the eggs.\nAdd rice and fry.";
  it("with Ingredients / Directions headings: read without AI", async () => {
    const r = await t.api("POST", "/api/recipes/import", { text, wait: 10 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "done", source: "Pasted text", result: { title: "Weeknight Fried Rice", how: "text" } });
    expect(t.ai.calls).toHaveLength(0);
  });

  it("anything else: AI", async () => {
    await turnOnAi();
    t.ai.respond = aiReply({ title: "Lemonade", ingredients: ["4 lemons", "1/2 cup sugar"], steps: ["Squeeze.", "Stir."] }) as any;
    const r = await t.api("POST", "/api/recipes/import", { text: "squeeze 4 lemons into a jug with half a cup of sugar and stir", wait: 10 });
    expect(r.body.result).toMatchObject({ title: "Lemonade", how: "ai" });
    expect((await t.api("POST", "/api/recipes/import", { text: "too short" })).status).toBe(400);
  });
});

describe("API keys and imports", () => {
  it("a Recipe push key can import and check on it, and nothing else", async () => {
    const key = (await t.api("POST", "/api/keys", { name: "Shortcuts", access: "recipe_push" })).body.key;
    t.web.pages["https://food.test/x"] = { body: ld({ ...chili, image: undefined }) };
    t.setToken("");
    const as = (m: string, url: string, body?: object) => t.api(m, url, body, { "x-api-key": key });
    const r = await as("POST", "/api/recipes/import", { url: "https://food.test/x", wait: 10 });
    expect(r.body).toMatchObject({ status: "done", result: { title: "Texas Chili" } });
    expect((await as("GET", `/api/imports/${r.body.id}`)).status).toBe(200);
    expect((await as("GET", "/api/imports")).status).toBe(403);
    expect((await as("GET", `/api/recipes/${r.body.result.recipeId}`)).status).toBe(403);
  });
});

describe("photos", () => {
  const upload = (url: string, file: Buffer, name = "photo.png") => {
    const boundary = "----recipehub";
    const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`), file, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return t.app.inject({ method: "POST", url, payload, headers: { authorization: `Bearer ${t.getToken()}`, "content-type": `multipart/form-data; boundary=${boundary}` } });
  };

  it("upload for a recipe; replacing or deleting it removes the old file", async () => {
    const recipe = (await t.api("POST", "/api/recipes", { title: "Toast" })).body;
    const first = await upload(`/api/recipes/${recipe.id}/photo`, png);
    expect(first.statusCode).toBe(201);
    const firstFile = `${t.photoDir}/${first.json().imageUrl.split("/").pop()}`;
    expect(fs.existsSync(firstFile)).toBe(true);
    const second = await upload(`/api/recipes/${recipe.id}/photo`, png);
    expect(fs.existsSync(firstFile)).toBe(false);
    expect((await t.api("GET", `/api/recipes/${recipe.id}`)).body.imageUrl).toBe(second.json().imageUrl);
    await t.api("DELETE", `/api/recipes/${recipe.id}`);
    expect(fs.readdirSync(t.photoDir)).toEqual([]);
  });

  it("upload before saving a new recipe; not-a-photo is refused", async () => {
    const r = await upload("/api/photos", png);
    const created = (await t.api("POST", "/api/recipes", { title: "Toast", imageUrl: r.json().imageUrl })).body;
    expect(created.imageUrl).toBe(r.json().imageUrl);
    // a link instead: the uploaded file goes
    await t.api("PATCH", `/api/recipes/${created.id}`, { imageUrl: "https://example.com/toast.jpg" });
    expect(fs.readdirSync(t.photoDir)).toEqual([]);
    expect((await upload("/api/photos", Buffer.from("not an image"))).json().error).toMatch(/isn't a photo/);
  });

  it("unused photos are swept after a day", async () => {
    const r = (await upload("/api/photos", png)).json();
    const file = `${t.photoDir}/${r.imageUrl.split("/").pop()}`;
    expect(await t.app.photos.sweep(t.db)).toBe(0); // too new
    const old = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    fs.utimesSync(file, old, old);
    expect(await t.app.photos.sweep(t.db)).toBe(1);
  });
});

describe("the job queue", () => {
  it("picks up jobs that were running when the server stopped", async () => {
    t.web.pages["https://food.test/y"] = { body: ld({ ...chili, image: undefined }) };
    const [job] = (await t.db.execute(`insert into jobs (kind, payload, status, attempts) values ('import-url', '{"url":"https://food.test/y"}', 'running', 1) returning id` as never)).rows as { id: number }[];
    await t.app.jobs.start();
    await t.app.jobs.drain();
    t.app.jobs.stop();
    expect((await t.api("GET", `/api/imports/${job.id}`)).body.status).toBe("done");
  });
});
