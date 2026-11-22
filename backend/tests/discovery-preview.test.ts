import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// The recipe on a discovered post's page, shown before anything is saved: read with plain code
// (the page's recipe data, or the feed post's Ingredients / Instructions), AI only when asked
// (Read with AI, Calculate nutrition). Import saves it as shown.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const FEED = "https://kitchen.example.com/feed";
const LINK = "https://kitchen.example.com/pork-roast";
const PLAIN = "https://kitchen.example.com/plain";
const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Test Kitchen</title><link>https://kitchen.example.com/</link>
<item><title>Pork Roast</title><link>${LINK}</link><guid>p1</guid><content:encoded><![CDATA[<p>Our favourite.</p><h2>Ingredients</h2><ul><li>1 pork butt</li><li>3 tbsp brown sugar</li></ul><h2>Instructions</h2><ol><li>Roast it low and slow.</li></ol>]]></content:encoded></item>
<item><title>Plain Soup</title><link>${PLAIN}</link><guid>p2</guid><description>A soup we like a lot.</description></item>
<item><title>No link here</title><guid>p3</guid><description>Just words.</description></item>
</channel></rss>`;
const site = (name = "Pork Roast (from the site)") =>
  `<!doctype html><html><head><title>Pork Roast</title><meta property="og:image" content="https://cdn.example.com/pork.jpg"><script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name, recipeIngredient: ["1 (5-pound) pork butt", "3 tbsp brown sugar"], recipeInstructions: ["Rub the pork.", "Roast at 300°F for 4 hours."], recipeYield: "8 servings", prepTime: "PT15M", cookTime: "PT4H" })}</script></head><body></body></html>`;
const reply = (obj: object) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
const aiOn = async () => {
  await t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
  await t.api("PUT", "/api/settings/features", { autoNutrition: false });
};
const subscribe = async () => {
  t.web.pages[FEED] = { type: "application/rss+xml", body: rss };
  await t.api("POST", "/api/discovery/feeds", { url: FEED });
  const items = (await t.api("GET", "/api/discovery/items")).body.items as { id: number; title: string }[];
  return (title: string) => items.find((i) => i.title === title)!.id;
};
const preview = (id: number, fresh = false) => t.api("GET", `/api/discovery/items/${id}/recipe${fresh ? "?fresh=1" : ""}`);

describe("the recipe preview on a discovered post", () => {
  it("reads the recipe's page: its recipe data, no AI, and nothing is saved", async () => {
    const id = (await subscribe())("Pork Roast");
    t.web.pages[LINK] = { type: "text/html", body: site() };
    const r = await preview(id);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      how: "schema.org",
      from: "site",
      problem: null,
      recipe: { title: "Pork Roast (from the site)", ingredients: ["1 (5-pound) pork butt", "3 tbsp brown sugar"], steps: ["Rub the pork.", "Roast at 300°F for 4 hours."], servings: 8, prepMinutes: 15, cookMinutes: 240, imageUrl: "https://cdn.example.com/pork.jpg", sourceUrl: LINK },
    });
    expect(t.ai.calls).toHaveLength(0);
    expect((await t.api("GET", "/api/recipes")).body.recipes).toHaveLength(0);
  });

  it("is kept for a day: opening the post again doesn't fetch the page again (?fresh=1 does)", async () => {
    const id = (await subscribe())("Pork Roast");
    t.web.pages[LINK] = { type: "text/html", body: site() };
    await preview(id);
    t.web.pages[LINK] = { type: "text/html", body: site("Pork Roast, updated") };
    const fetches = t.web.calls.filter((u) => u === LINK).length;
    expect((await preview(id)).body.recipe.title).toBe("Pork Roast (from the site)");
    expect(t.web.calls.filter((u) => u === LINK).length).toBe(fetches);
    expect((await preview(id, true)).body.recipe.title).toBe("Pork Roast, updated");
  });

  it("the site keeps RecipeHub out: the feed post's own Ingredients and Instructions, still no AI", async () => {
    const id = (await subscribe())("Pork Roast");
    t.web.pages[LINK] = { status: 403, type: "text/html", body: "<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing. cf-chl</body></html>" };
    await aiOn();
    const r = (await preview(id)).body;
    expect(r).toMatchObject({ how: "text", from: "feed", recipe: { title: "Pork Roast", ingredients: ["1 pork butt", "3 tbsp brown sugar"], steps: ["Roast it low and slow."], sourceUrl: LINK } });
    expect(r.problem).toBeTruthy();
    expect(t.ai.calls).toHaveLength(0);
  });

  it("no recipe data anywhere: says so, and whether Read with AI can be offered", async () => {
    const id = (await subscribe())("Plain Soup");
    t.web.pages[PLAIN] = { type: "text/html", body: "<html><head><title>Plain Soup</title></head><body><p>Soup. Simmer the vegetables in stock.</p></body></html>" };
    const off = (await preview(id)).body;
    expect(off).toMatchObject({ recipe: null, how: null, canAi: false });
    expect(off.problem).toMatch(/recipe data/);
    await aiOn();
    expect((await preview(id)).body.canAi).toBe(true);
    expect(t.ai.calls).toHaveLength(0);
  });

  it("Read with AI: the page's text, read by AI when asked, and kept", async () => {
    const id = (await subscribe())("Plain Soup");
    t.web.pages[PLAIN] = { type: "text/html", body: "<html><head><title>Plain Soup</title></head><body><p>Soup: 1 onion, 4 cups stock. Simmer the vegetables in stock.</p></body></html>" };
    await aiOn();
    await preview(id);
    t.ai.respond = () => reply({ isRecipe: true, title: "Plain Soup", ingredients: ["1 onion", "4 cups stock"], steps: ["Simmer the vegetables in stock."], servings: 4 });
    const r = await t.api("POST", `/api/discovery/items/${id}/recipe/ai`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ how: "ai", from: "site", problem: null, recipe: { title: "Plain Soup", ingredients: ["1 onion", "4 cups stock"], sourceUrl: PLAIN } });
    expect(String(t.ai.calls.at(-1)!.body.messages.at(-1).content)).toContain("1 onion, 4 cups stock");
    expect((await preview(id)).body.how).toBe("ai");
    expect(t.ai.calls).toHaveLength(1);
  });

  it("Read with AI, the site blocked: the feed's copy is read", async () => {
    const id = (await subscribe())("Plain Soup");
    t.web.pages[PLAIN] = { status: 404, type: "text/html", body: "gone" };
    await aiOn();
    t.ai.respond = () => reply({ isRecipe: true, title: "Plain Soup", ingredients: ["1 onion"], steps: ["Simmer."] });
    const r = (await t.api("POST", `/api/discovery/items/${id}/recipe/ai`)).body;
    expect(r).toMatchObject({ how: "ai", from: "feed" });
    expect(String(t.ai.calls.at(-1)!.body.messages.at(-1).content)).toContain("A soup we like a lot.");
  });

  // A site that keeps RecipeHub out (Allrecipes answers 402): a saved copy of the page, like Import
  const waybackHas = (url: string, ts = "20251201185510") => {
    t.web.pages[`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`] = { type: "application/json", body: JSON.stringify({ url, archived_snapshots: { closest: { status: "200", available: true, url: `http://web.archive.org/web/${ts}/${url}`, timestamp: ts } } }) };
    return `https://web.archive.org/web/${ts}id_/${url}`;
  };

  it("the site keeps RecipeHub out: a saved copy's recipe data comes before the feed's post, still no AI", async () => {
    const id = (await subscribe())("Pork Roast");
    t.web.pages[LINK] = { status: 402, type: "text/html", body: "Payment Required" };
    t.web.pages[waybackHas(LINK)] = { type: "text/html", body: site("Pork Roast (saved copy)") };
    await aiOn();
    const r = (await preview(id)).body;
    expect(r).toMatchObject({
      how: "schema.org",
      from: "copy",
      savedCopy: { from: "Wayback Machine", url: `https://web.archive.org/web/20251201185510/${LINK}`, date: "2025-12-01" },
      recipe: { title: "Pork Roast (saved copy)", ingredients: ["1 (5-pound) pork butt", "3 tbsp brown sugar"], sourceUrl: LINK },
    });
    expect(r.problem).toMatch(/turned the request away \(402\)/);
    expect(t.ai.calls).toHaveLength(0);
    // Import saves it as shown, and says it came from the saved copy
    const start = await t.api("POST", `/api/discovery/items/${id}/import`);
    await t.app.jobs.drain();
    const job = (await t.api("GET", `/api/imports/${start.body.id}`)).body;
    expect(job).toMatchObject({ status: "done", result: { title: "Pork Roast (saved copy)", savedCopy: { from: "Wayback Machine", date: "2025-12-01" } } });
  });

  it("saved copies turned off in Settings: straight to the feed's post", async () => {
    const id = (await subscribe())("Pork Roast");
    t.web.pages[LINK] = { status: 402, type: "text/html", body: "Payment Required" };
    t.web.pages[waybackHas(LINK)] = { type: "text/html", body: site("Pork Roast (saved copy)") };
    await t.api("PUT", "/api/settings/features", { savedCopies: false });
    const r = (await preview(id)).body;
    expect(r).toMatchObject({ how: "text", from: "feed" });
    expect(t.web.calls.some((u) => u.includes("archive.org"))).toBe(false);
  });

  it("Read with AI, the site blocked: a saved copy's text is read before the feed's post", async () => {
    const id = (await subscribe())("Plain Soup");
    t.web.pages[PLAIN] = { status: 402, type: "text/html", body: "Payment Required" };
    t.web.pages[`https://archive.ph/newest/${PLAIN}`] = { status: 302, location: "https://archive.ph/Xy12", body: "" };
    t.web.pages["https://archive.ph/Xy12"] = { type: "text/html", body: "<html><body><h1>Plain Soup</h1><p>Saved copy: 2 onions, 6 cups stock. Simmer.</p></body></html>" };
    await aiOn();
    await preview(id);
    t.ai.respond = () => reply({ isRecipe: true, title: "Plain Soup", ingredients: ["2 onions", "6 cups stock"], steps: ["Simmer."] });
    const r = (await t.api("POST", `/api/discovery/items/${id}/recipe/ai`)).body;
    expect(r).toMatchObject({ how: "ai", from: "copy", savedCopy: { from: "archive.ph", url: "https://archive.ph/Xy12" }, recipe: { sourceUrl: PLAIN } });
    expect(String(t.ai.calls.at(-1)!.body.messages.at(-1).content)).toContain("2 onions, 6 cups stock");
  });

  it("Read with AI, blocked and no saved copy anywhere: the feed's post, and the problem says both", async () => {
    const id = (await subscribe())("Plain Soup");
    t.web.pages[PLAIN] = { status: 402, type: "text/html", body: "Payment Required" };
    await aiOn();
    t.ai.respond = () => reply({ isRecipe: true, title: "Plain Soup", ingredients: ["1 onion"], steps: ["Simmer."] });
    const r = (await t.api("POST", `/api/discovery/items/${id}/recipe/ai`)).body;
    expect(r).toMatchObject({ how: "ai", from: "feed" });
    expect(r.problem).toMatch(/\(402\).*No saved copy could be found either\./);
  });

  it("Read with AI with AI off (409), or nothing to read (422): says why", async () => {
    const id = (await subscribe())("Plain Soup");
    t.web.pages[PLAIN] = { type: "text/html", body: "<html><body>Soup.</body></html>" };
    expect((await t.api("POST", `/api/discovery/items/${id}/recipe/ai`)).status).toBe(409); // AI off
    await aiOn();
    t.ai.respond = () => reply({ isRecipe: false });
    const r = await t.api("POST", `/api/discovery/items/${id}/recipe/ai`);
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/recipe/i);
  });

  it("Calculate nutrition: each ingredient, added up per serving, and kept with the preview", async () => {
    const id = (await subscribe())("Pork Roast");
    t.web.pages[LINK] = { type: "text/html", body: site() };
    await preview(id);
    expect((await t.api("POST", `/api/discovery/items/${id}/recipe/nutrition`)).status).toBe(409); // AI off
    await aiOn();
    t.ai.respond = () => reply({ ingredients: [{ line: "1 (5-pound) pork butt", grams: 2268, calories: 5600, protein: 400 }, { line: "3 tbsp brown sugar", grams: 36, calories: 140, carbohydrates: 36 }] });
    const r = await t.api("POST", `/api/discovery/items/${id}/recipe/nutrition`);
    expect(r.status).toBe(200);
    expect(r.body.recipe.nutrition).toMatchObject({ calories: 717.5, protein: 50, servings: 8, source: "ai" });
    expect(r.body.recipe.nutrition.perIngredient.map((x: any) => [x.line, x.calories])).toEqual([["1 (5-pound) pork butt", 5600], ["3 tbsp brown sugar", 140]]);
    expect(String(t.ai.calls.at(-1)!.body.messages[0].content)).toMatch(/^You estimate nutrition/);
    expect((await preview(id)).body.recipe.nutrition.calories).toBe(717.5);
  });

  it("Calculate nutrition with nothing previewed: 400", async () => {
    const id = (await subscribe())("Plain Soup");
    t.web.pages[PLAIN] = { type: "text/html", body: "<html><body>Soup.</body></html>" };
    await preview(id);
    await aiOn();
    expect((await t.api("POST", `/api/discovery/items/${id}/recipe/nutrition`)).status).toBe(400);
  });

  it("Import saves the recipe as previewed, nutrition included, without reading the page again or AI", async () => {
    const id = (await subscribe())("Pork Roast");
    t.web.pages[LINK] = { type: "text/html", body: site() };
    await preview(id);
    await aiOn();
    t.ai.respond = () => reply({ ingredients: [{ line: "1 (5-pound) pork butt", calories: 5600 }, { line: "3 tbsp brown sugar", calories: 140 }] });
    await t.api("POST", `/api/discovery/items/${id}/recipe/nutrition`);
    const aiCalls = t.ai.calls.length;
    t.web.pages[LINK] = { type: "text/html", body: site("Changed since") };
    const fetches = t.web.calls.filter((u) => u === LINK).length;
    const start = await t.api("POST", `/api/discovery/items/${id}/import`);
    expect(start.status).toBe(202);
    await t.app.jobs.drain();
    const job = (await t.api("GET", `/api/imports/${start.body.id}`)).body;
    expect(job).toMatchObject({ status: "done", result: { recipeId: expect.any(Number), title: "Pork Roast (from the site)", how: "schema.org" } });
    expect(t.web.calls.filter((u) => u === LINK).length).toBe(fetches);
    expect(t.ai.calls.length).toBe(aiCalls);
    const recipe = (await t.api("GET", `/api/recipes/${job.result.recipeId}`)).body;
    expect(recipe).toMatchObject({ title: "Pork Roast (from the site)", servings: 8, sourceUrl: LINK, nutrition: { calories: 717.5 } });
    expect(recipe.ingredients.map((i: any) => i.raw)).toEqual(["1 (5-pound) pork butt", "3 tbsp brown sugar"]);
    expect((await t.api("GET", `/api/discovery/items/${id}`)).body.recipeId).toBe(recipe.id);
  });

  it("a post without a link has no preview", async () => {
    const id = (await subscribe())("No link here");
    expect((await preview(id)).status).toBe(400);
    expect((await preview(9999)).status).toBe(404);
  });
});
