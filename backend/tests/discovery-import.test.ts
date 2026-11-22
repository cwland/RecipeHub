import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// Import Recipe from Discovery: the recipe's own site first; if the site keeps RecipeHub out, the
// feed's copy of the post (read by AI, as any page without recipe data is)
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const FEED = "https://kitchen.example.com/feed";
const LINK = "https://kitchen.example.com/pork-roast";
const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Test Kitchen</title><link>https://kitchen.example.com/</link>
<item><title>Pork Roast</title><link>${LINK}</link><guid>p1</guid><content:encoded><![CDATA[<h2>Ingredients</h2><ul><li>1 pork butt</li><li>3 tbsp brown sugar</li></ul><h2>Instructions</h2><ol><li>Roast it low and slow.</li></ol>]]></content:encoded></item>
<item><title>No link here</title><guid>p2</guid><description>Just words.</description></item>
</channel></rss>`;
const site = `<!doctype html><html><head><title>Pork Roast</title><script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name: "Pork Roast (from the site)", recipeIngredient: ["1 (5-pound) pork butt", "3 tbsp brown sugar"], recipeInstructions: ["Roast at 300°F for 4 hours."] })}</script></head><body></body></html>`;
const reply = (obj: object) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
const subscribe = async () => {
  t.web.pages[FEED] = { type: "application/rss+xml", body: rss };
  await t.api("POST", "/api/discovery/feeds", { url: FEED });
  return (await t.api("GET", "/api/discovery/items")).body.items as { id: number; title: string; recipeId: number | null }[];
};
const importItem = async (id: number) => {
  const r = await t.api("POST", `/api/discovery/items/${id}/import`);
  await t.app.jobs.drain();
  return { start: r, job: r.body.id ? (await t.api("GET", `/api/imports/${r.body.id}`)).body : null };
};

describe("Import Recipe from a discovered post", () => {
  it("reads the recipe's own site (its recipe data, no AI), and the post is then In your recipes", async () => {
    const items = await subscribe();
    t.web.pages[LINK] = { type: "text/html", body: site };
    const pork = items.find((i) => i.title === "Pork Roast")!;
    expect(pork.recipeId).toBeNull();
    const { start, job } = await importItem(pork.id);
    expect(start.status).toBe(202);
    expect(job).toMatchObject({ status: "done", result: { recipeId: expect.any(Number), title: "Pork Roast (from the site)", how: "schema.org" } });
    expect(job.result.fromFeed).toBeUndefined();
    expect(t.ai.calls).toHaveLength(0);
    const after = (await t.api("GET", "/api/discovery/items")).body.items.find((i: any) => i.id === pork.id);
    expect(after.recipeId).toBe(job.result.recipeId);
    expect((await t.api("GET", `/api/discovery/items/${pork.id}`)).body.recipeId).toBe(job.result.recipeId);
    // the recipe is v1, imported, with its link
    const recipe = (await t.api("GET", `/api/recipes/${job.result.recipeId}`)).body;
    expect(recipe.sourceUrl).toBe(LINK);
    expect((await t.api("GET", `/api/recipes/${recipe.id}/versions`)).body.map((v: any) => [v.number, v.source])).toEqual([[1, "import"]]);
  });

  it("the site keeps RecipeHub out: the feed's copy of the post is read instead", async () => {
    const items = await subscribe();
    t.web.pages[LINK] = { status: 403, type: "text/html", body: "<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing. cf-chl</body></html>" };
    await t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
    await t.api("PUT", "/api/settings/features", { autoNutrition: false });
    t.ai.respond = () => reply({ title: "Pork Roast", ingredients: ["1 pork butt", "3 tbsp brown sugar"], steps: ["Roast it low and slow."] });
    const { job } = await importItem(items.find((i) => i.title === "Pork Roast")!.id);
    expect(job).toMatchObject({ status: "done", result: { recipeId: expect.any(Number), fromFeed: true } });
    const sent = String(t.ai.calls.at(-1)!.body.messages.at(-1).content);
    expect(sent).toContain("1 pork butt");
    expect((await t.api("GET", `/api/recipes/${job.result.recipeId}`)).body.sourceUrl).toBe(LINK);
  });

  it("the site keeps RecipeHub out (Allrecipes: 402): a saved copy of the page comes before the feed's copy", async () => {
    const items = await subscribe();
    t.web.pages[LINK] = { status: 402, type: "text/html", body: "Payment Required" };
    const ts = "20251201185510";
    t.web.pages[`https://archive.org/wayback/available?url=${encodeURIComponent(LINK)}`] = { type: "application/json", body: JSON.stringify({ url: LINK, archived_snapshots: { closest: { status: "200", available: true, url: `http://web.archive.org/web/${ts}/${LINK}`, timestamp: ts } } }) };
    t.web.pages[`https://web.archive.org/web/${ts}id_/${LINK}`] = { type: "text/html", body: site };
    const { job } = await importItem(items.find((i) => i.title === "Pork Roast")!.id);
    expect(job).toMatchObject({ status: "done", result: { title: "Pork Roast (from the site)", how: "schema.org", savedCopy: { from: "Wayback Machine" } } });
    expect(job.result.fromFeed).toBeUndefined();
    expect(t.ai.calls).toHaveLength(0);
    expect((await t.api("GET", `/api/recipes/${job.result.recipeId}`)).body.sourceUrl).toBe(LINK);
  });

  it("kept out and no saved copy: the feed's copy, and the reason says both", async () => {
    const items = await subscribe();
    t.web.pages[LINK] = { status: 402, type: "text/html", body: "Payment Required" };
    await t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
    await t.api("PUT", "/api/settings/features", { autoNutrition: false });
    t.ai.respond = () => reply({ title: "Pork Roast", ingredients: ["1 pork butt", "3 tbsp brown sugar"], steps: ["Roast it low and slow."] });
    const { job } = await importItem(items.find((i) => i.title === "Pork Roast")!.id);
    expect(job).toMatchObject({ status: "done", result: { fromFeed: true } });
    const log = (await t.api("GET", "/api/logs?category=import")).body[0];
    expect(log.detail).toMatch(/\(402\).*No saved copy could be found either\..*feed's copy/);
  });

  it("neither works: says why", async () => {
    const items = await subscribe();
    t.web.pages[LINK] = { status: 404, type: "text/html", body: "gone" };
    const { job } = await importItem(items.find((i) => i.title === "Pork Roast")!.id);
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/feed's copy/);
  });

  it("already in your recipes: says so, and the post shows it", async () => {
    const items = await subscribe();
    t.web.pages[LINK] = { type: "text/html", body: site };
    const pork = items.find((i) => i.title === "Pork Roast")!;
    const first = (await importItem(pork.id)).job;
    const again = (await importItem(pork.id)).job;
    expect(again.result).toMatchObject({ duplicateOf: first.result.recipeId });
  });

  it("a post without a link: can't be imported from here", async () => {
    const items = await subscribe();
    expect((await t.api("POST", `/api/discovery/items/${items.find((i) => i.title === "No link here")!.id}/import`)).status).toBe(400);
    expect((await t.api("POST", "/api/discovery/items/9999/import")).status).toBe(404);
  });

  it("a recipe you deleted: the post isn't In your recipes any more", async () => {
    const items = await subscribe();
    t.web.pages[LINK] = { type: "text/html", body: site };
    const pork = items.find((i) => i.title === "Pork Roast")!;
    const { job } = await importItem(pork.id);
    await t.api("DELETE", `/api/recipes/${job.result.recipeId}`);
    expect((await t.api("GET", "/api/discovery/items")).body.items.find((i: any) => i.id === pork.id).recipeId).toBeNull();
  });
});
