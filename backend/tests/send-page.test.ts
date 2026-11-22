import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// Send to RecipeHub (the bookmark): the page you have open in your browser comes with the import, so
// RecipeHub reads that instead of fetching the link (past a security check, or signed in)
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const URL_ = "https://kitchen.example.com/recipes/13647-slow-cooker-apple-cider-pork";
const send = async (body: object) => {
  const r = await t.api("POST", "/api/recipes/import", body);
  if (r.status !== 202) return r;
  await t.app.jobs.drain();
  return { status: r.status, body: (await t.api("GET", `/api/imports/${r.body.id}`)).body };
};

describe("importing a page sent from your browser", () => {
  it("reads the page that was sent; the link isn't fetched", async () => {
    t.web.pages[URL_] = { status: 403, body: "Forbidden" };
    const { body: job } = await send({ url: URL_, html: fixture("paywalled-recipe.html") });
    expect(job).toMatchObject({ status: "done", source: URL_, result: { title: "Slow-Cooker Apple Cider Pork", how: "schema.org", sent: true } });
    expect(t.web.calls).not.toContain(URL_);
    const [row] = (await t.app.db.execute(`select payload from jobs where id = ${job.id}` as never)).rows as { payload: Record<string, unknown> }[];
    expect(row.payload).toEqual({ url: URL_, force: false }); // the page copy is dropped once imported
    const r = (await t.api("GET", `/api/recipes/${job.result.recipeId}`)).body;
    expect(r).toMatchObject({ sourceUrl: URL_ });
    expect(r.ingredients).toHaveLength(12);
    expect((await t.api("GET", "/api/logs?category=import")).body[0]).toMatchObject({ event: 'Imported "Slow-Cooker Apple Cider Pork" (sent from your browser)' });
  });

  it("a big page is fine (a few MB); more than 8 MB is refused", async () => {
    const page = fixture("paywalled-recipe.html") + `<!-- ${"x".repeat(3 * 1024 * 1024)} -->`;
    expect((await send({ url: URL_, html: page })).body.status).toBe("done");
    const huge = await t.api("POST", "/api/recipes/import", { url: URL_, html: "x".repeat(9 * 1024 * 1024) });
    expect([400, 413]).toContain(huge.status);
  });

  it("needs the page's link too, and a web address", async () => {
    expect((await t.api("POST", "/api/recipes/import", { html: "<html></html>" })).status).toBe(400);
    expect((await t.api("POST", "/api/recipes/import", { url: "javascript:alert(1)", html: "<html></html>" })).status).toBe(400);
    expect((await t.api("POST", "/api/recipes/import", { text: "x".repeat(30), html: "<html></html>" })).status).toBe(400);
  });

  it("a sent page that's still a paywall says so, and doesn't go looking for saved copies", async () => {
    const { body: job } = await send({ url: "https://news.test/pork", html: '<html><head><script type="application/ld+json">{"@type":"WebPage","isAccessibleForFree":false}</script></head><body>Subscribe to unlock this recipe.</body></html>' });
    expect(job.status).toBe("failed");
    expect(job.error).toBe("news.test keeps this recipe behind a paywall or sign-in, so RecipeHub couldn't read it.");
    expect(t.web.calls.some((c) => c.includes("archive"))).toBe(false);
  });

  it("a recipe you already have is still caught", async () => {
    await send({ url: URL_, html: fixture("paywalled-recipe.html") });
    const { body: again } = await send({ url: URL_, html: fixture("paywalled-recipe.html") });
    expect(again.result.duplicateOf).toBeGreaterThan(0);
  });
});
