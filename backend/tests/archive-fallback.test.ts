import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// When a site keeps a recipe from us, try a saved copy: the Wayback Machine, then archive.ph and
// its mirrors. On by default; Settings › Recipes can turn it off.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const importUrl = async (url: string) => {
  const r = await t.api("POST", "/api/recipes/import", { url });
  await t.app.jobs.drain();
  return (await t.api("GET", `/api/imports/${r.body.id}`)).body;
};
const aiReply = (obj: object) => () => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
const turnOnAi = () => t.api("PUT", "/api/settings/ai", { services: [{ name: "Home AI", provider: "local", baseUrl: "http://10.0.0.5:11434/v1", model: "qwen" }], maxPerRun: 50 });

const URL_ = "https://kitchen.example.com/recipes/13647-slow-cooker-apple-cider-pork";
const cloudflare = '<html><head><title>Just a moment...</title></head><body><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>';
const waybackApi = (url: string) => `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
const waybackHas = (url: string, timestamp = "20251201185510") => {
  t.web.pages[waybackApi(url)] = { type: "application/json", body: JSON.stringify({ url, archived_snapshots: { closest: { status: "200", available: true, url: `http://web.archive.org/web/${timestamp}/${url}`, timestamp } } }) };
  return `https://web.archive.org/web/${timestamp}id_/${url}`;
};
const waybackHasNone = (url: string) => (t.web.pages[waybackApi(url)] = { type: "application/json", body: JSON.stringify({ url, archived_snapshots: {} }) });
const archivePh = (host: string, url: string) => `https://${host}/newest/${url}`;

describe("a saved copy when the site blocks the import", () => {
  it("the Wayback Machine's copy (its raw page, with the recipe data) is used", async () => {
    t.web.pages[URL_] = { status: 403, body: cloudflare };
    t.web.pages[waybackHas(URL_)] = { body: fixture("paywalled-recipe.html") };
    const job = await importUrl(URL_);
    expect(job).toMatchObject({ status: "done", result: { title: "Slow-Cooker Apple Cider Pork", how: "schema.org", savedCopy: { from: "Wayback Machine", url: `https://web.archive.org/web/20251201185510/${URL_}`, date: "2025-12-01" } } });
    const r = (await t.api("GET", `/api/recipes/${job.result.recipeId}`)).body;
    expect(r).toMatchObject({ sourceUrl: URL_ }); // the recipe's own page, not the archive's
    expect(r.ingredients).toHaveLength(12);
    const log = (await t.api("GET", "/api/logs?category=import")).body[0];
    expect(log).toMatchObject({ event: 'Imported "Slow-Cooker Apple Cider Pork" from a saved copy (Wayback Machine)' }); // a warning here: the test has no photo to save
    expect(log.detail).toMatch(/asked for a security check/);
  });

  it("a 402 (how Allrecipes turns apps away) tries the saved copy too", async () => {
    const url = "https://www.allrecipes.test/recipe/13647/pork";
    t.web.pages[url] = { status: 402, body: "Payment Required" };
    t.web.pages[waybackHas(url)] = { body: fixture("paywalled-recipe.html") };
    const job = await importUrl(url);
    expect(job).toMatchObject({ status: "done", result: { how: "schema.org", savedCopy: { from: "Wayback Machine" } } });
    expect((await t.api("GET", `/api/recipes/${job.result.recipeId}`)).body.sourceUrl).toBe(url);
  });

  it("no Wayback copy: archive.ph (its pages have no recipe data, so the AI reads the text)", async () => {
    await turnOnAi();
    t.web.pages["https://food.test/pork"] = { status: 403, body: "Forbidden" };
    waybackHasNone("https://food.test/pork");
    t.web.pages[archivePh("archive.ph", "https://food.test/pork")] = { status: 302, location: "https://archive.ph/AbC12", body: "" };
    t.web.pages["https://archive.ph/AbC12"] = { body: "<html><body><h1>Pork</h1><p>Ingredients: 2 lb pork. Steps: Roast it.</p></body></html>" };
    t.ai.respond = aiReply({ isRecipe: true, title: "Pork", ingredients: ["2 lb pork"], steps: ["Roast it."] });
    const job = await importUrl("https://food.test/pork");
    expect(job.result).toMatchObject({ title: "Pork", how: "ai", savedCopy: { from: "archive.ph", url: "https://archive.ph/AbC12" } });
    expect((await t.api("GET", `/api/recipes/${job.result.recipeId}`)).body.sourceUrl).toBe("https://food.test/pork");
  });

  it("archive.ph unreachable: its other addresses are tried (archive.today, .is, .li)", async () => {
    await turnOnAi();
    t.web.pages["https://food.test/pork"] = { status: 403, body: "Forbidden" };
    waybackHasNone("https://food.test/pork");
    // archive.ph and archive.today not answering (no fake page = 404); archive.is has it
    t.web.pages[archivePh("archive.is", "https://food.test/pork")] = { body: "<html><body><h1>Pork</h1><p>2 lb pork. Roast.</p></body></html>" };
    t.ai.respond = aiReply({ isRecipe: true, title: "Pork", ingredients: ["2 lb pork"], steps: ["Roast."] });
    const job = await importUrl("https://food.test/pork");
    expect(job.result.savedCopy).toMatchObject({ from: "archive.is" });
    const tried = t.web.calls.filter((c) => c.includes("/newest/"));
    expect(tried.map((c) => new URL(c).hostname)).toEqual(["archive.ph", "archive.today", "archive.is"]);
  });

  it("archive.ph's security check: it stops there (the other addresses share it) and keeps the link for you", async () => {
    t.web.pages["https://food.test/pork"] = { status: 403, body: "Forbidden" };
    waybackHasNone("https://food.test/pork");
    t.web.pages[archivePh("archive.ph", "https://food.test/pork")] = { status: 429, body: fixture("archive-captcha.html") };
    const job = await importUrl("https://food.test/pork");
    expect(job.status).toBe("failed");
    expect(job.error).toBe("food.test turned the request away (403). Some sites block apps. No saved copy could be read either: archive.ph asked for a security check.");
    expect(job.result).toEqual({
      blocked: { reason: "refused", url: "https://food.test/pork" },
      savedCopies: [
        { from: "Wayback Machine", outcome: "none" },
        { from: "archive.ph", outcome: "captcha", link: "https://archive.ph/newest/https://food.test/pork" },
      ],
    });
    expect(t.web.calls.some((c) => c.includes("archive.today"))).toBe(false);
  });

  it("a saved copy that's a paywall too, or has no recipe, moves on to the next", async () => {
    t.web.pages["https://food.test/pork"] = { status: 403, body: "Forbidden" };
    t.web.pages[waybackHas("https://food.test/pork")] = { body: '<html><head><script type="application/ld+json">{"@type":"WebPage","isAccessibleForFree":false}</script></head><body>Subscribe to unlock this recipe.</body></html>' };
    t.web.pages[archivePh("archive.ph", "https://food.test/pork")] = { body: `<html><head><script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name: "Pork", recipeIngredient: ["2 lb pork"], recipeInstructions: ["Roast."] })}</script></head><body></body></html>` };
    const job = await importUrl("https://food.test/pork");
    expect(job.result).toMatchObject({ title: "Pork", savedCopy: { from: "archive.ph" } });
  });

  it("nothing anywhere: says so, and lists what was tried", async () => {
    t.web.pages["https://food.test/pork"] = { status: 403, body: "Forbidden" };
    waybackHasNone("https://food.test/pork");
    const job = await importUrl("https://food.test/pork");
    expect(job.error).toBe("food.test turned the request away (403). Some sites block apps. No saved copy could be found either.");
    expect(job.result.savedCopies).toEqual([
      { from: "Wayback Machine", outcome: "none" },
      { from: "archive.ph", outcome: "none" },
      { from: "archive.today", outcome: "none" },
      { from: "archive.is", outcome: "none" },
      { from: "archive.li", outcome: "none" },
    ]);
  });

  it("only for blocked pages: a missing page (404) or a page that isn't a recipe doesn't go looking", async () => {
    t.web.pages["https://plain.test/r"] = { body: "<html><body><p>My vacation photos</p></body></html>" };
    await importUrl("https://nowhere.test/r");
    await importUrl("https://plain.test/r");
    expect(t.web.calls.some((c) => c.includes("archive"))).toBe(false);
  });

  it("turned off in Settings: no saved copies are tried", async () => {
    await t.api("PUT", "/api/settings/features", { savedCopies: false });
    t.web.pages["https://food.test/pork"] = { status: 403, body: "Forbidden" };
    const job = await importUrl("https://food.test/pork");
    expect(job.error).toBe("food.test turned the request away (403). Some sites block apps.");
    expect(t.web.calls.some((c) => c.includes("archive"))).toBe(false);
    expect(job.result).toEqual({ blocked: { reason: "refused", url: "https://food.test/pork" } });
  });

  it("the switch is on by default and logged when flipped", async () => {
    expect((await t.api("GET", "/api/settings/features")).body.savedCopies).toBe(true);
    await t.api("PUT", "/api/settings/features", { savedCopies: false });
    expect((await t.api("GET", "/api/logs?category=import")).body[0]).toMatchObject({ event: "Saved copies turned off" });
  });
});
