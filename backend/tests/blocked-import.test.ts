import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// Importing a link that the site (or a security check, or a paywall) keeps from us: the import says
// why, and keeps the reason so the next steps (a saved copy, what to do instead) can use it
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
  await t.api("PUT", "/api/settings/features", { savedCopies: false }); // saved copies: archive-fallback.test.ts
});

const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const importUrl = async (url: string) => {
  const r = await t.api("POST", "/api/recipes/import", { url });
  await t.app.jobs.drain();
  return (await t.api("GET", `/api/imports/${r.body.id}`)).body;
};
const aiReply = (obj: object) => () => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
const turnOnAi = () => t.api("PUT", "/api/settings/ai", { services: [{ name: "Home AI", provider: "local", baseUrl: "http://10.0.0.5:11434/v1", model: "qwen" }], maxPerRun: 50 });
const cloudflare = '<html><head><title>Just a moment...</title></head><body><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>';

describe("a page that's marked paywalled but has the recipe in its data", () => {
  it("America's Test Kitchen imports normally", async () => {
    const url = "https://kitchen.example.com/recipes/13647-slow-cooker-apple-cider-pork";
    t.web.pages[url] = { body: fixture("paywalled-recipe.html") };
    const job = await importUrl(url);
    expect(job).toMatchObject({ status: "done", result: { title: "Slow-Cooker Apple Cider Pork", how: "schema.org" } });
    const r = (await t.api("GET", `/api/recipes/${job.result.recipeId}`)).body;
    expect([r.ingredients.length, r.steps.length, r.servings]).toEqual([12, 5, 8]);
  });
});

describe("blocked", () => {
  it("a security check (CAPTCHA) says so, and who runs it", async () => {
    t.web.pages["https://food.test/r"] = { status: 403, body: cloudflare };
    const job = await importUrl("https://food.test/r");
    expect(job.status).toBe("failed");
    expect(job.error).toBe("food.test asked for a security check (a CAPTCHA, by Cloudflare), so RecipeHub couldn't read the page.");
    expect(job.result).toEqual({ blocked: { reason: "captcha", by: "Cloudflare", url: "https://food.test/r" } });
    expect((await t.api("GET", "/api/logs?category=import")).body[0]).toMatchObject({ level: "warning", event: "Couldn't import a recipe", detail: job.error });
  });

  it("a challenge page that comes back as a normal page isn't sent to the AI", async () => {
    await turnOnAi();
    t.web.pages["https://food.test/r"] = { body: cloudflare };
    const job = await importUrl("https://food.test/r");
    expect(job.result.blocked).toMatchObject({ reason: "captcha" });
    expect(t.ai.calls).toHaveLength(0);
  });

  it("refused (403), too many requests (429), unavailable (503)", async () => {
    t.web.pages["https://a.test/r"] = { status: 403, body: "Forbidden" };
    t.web.pages["https://b.test/r"] = { status: 429, body: "" };
    t.web.pages["https://c.test/r"] = { status: 503, body: "Down" };
    const [a, b, c] = [await importUrl("https://a.test/r"), await importUrl("https://b.test/r"), await importUrl("https://c.test/r")];
    expect(a.error).toMatch(/turned the request away \(403\)/);
    expect(a.result.blocked).toMatchObject({ reason: "refused" });
    expect(b.result.blocked).toMatchObject({ reason: "rate-limited" });
    expect(c.result.blocked).toMatchObject({ reason: "unavailable" });
  });

  it("402 (Allrecipes and other Dotdash Meredith sites answer apps with it) counts as refused", async () => {
    t.web.pages["https://www.allrecipes.test/recipe/1"] = { status: 402, body: "Payment Required" };
    const job = await importUrl("https://www.allrecipes.test/recipe/1");
    expect(job.status).toBe("failed");
    expect(job.error).toBe("www.allrecipes.test turned the request away (402). Some sites block apps.");
    expect(job.result.blocked).toMatchObject({ reason: "refused", url: "https://www.allrecipes.test/recipe/1" });
  });

  it("a paywall: with AI off it says paywall, not “turn on AI”", async () => {
    t.web.pages["https://news.test/pork"] = { body: '<html><head><title>Pork</title><script type="application/ld+json">{"@type":"NewsArticle","headline":"Pork","isAccessibleForFree":false}</script></head><body><p>Subscribe to unlock this recipe.</p></body></html>' };
    const job = await importUrl("https://news.test/pork");
    expect(job.error).toBe("news.test keeps this recipe behind a paywall or sign-in, so RecipeHub couldn't read it.");
    expect(job.result.blocked).toMatchObject({ reason: "paywall" });
  });

  it("a paywall: the AI gets a go first (the recipe is sometimes hidden in the page), then it says paywall", async () => {
    await turnOnAi();
    t.web.pages["https://news.test/pork"] = { body: "<html><body><h1>Pork</h1><div>Become a member to see the full recipe. Start your free trial.</div></body></html>" };
    t.ai.respond = aiReply({ isRecipe: false });
    const job = await importUrl("https://news.test/pork");
    expect(t.ai.calls).toHaveLength(1);
    expect(job.result.blocked).toMatchObject({ reason: "paywall" });
  });

  it("a page that just isn't a recipe still says so (no paywall signs)", async () => {
    t.web.pages["https://plain.test/r"] = { body: "<html><body><p>My vacation photos</p></body></html>" };
    const job = await importUrl("https://plain.test/r");
    expect(job.error).toMatch(/AI is off/);
    expect(job.result).toBeNull();
  });
});
