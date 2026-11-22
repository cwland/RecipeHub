import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { refreshAllFeeds, scheduledRefresh } from "../src/lib/discovery.js";
import { readFileSync } from "node:fs";

// Discovery: RSS feeds the household subscribes to, read and filtered with plain code (no AI)
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const FEED = "https://kitchen.example.com/feed";
const item = (n: number, more = "") => `<item><title>Recipe ${n}${more}</title><link>https://kitchen.example.com/r${n}</link><guid>r${n}</guid><pubDate>${new Date(Date.UTC(2026, 10, n)).toUTCString()}</pubDate><category>Dinner</category><description>Post ${n}.</description></item>`;
const rss = (...items: string[]) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Test Kitchen</title><link>https://kitchen.example.com/</link>${items.join("")}</channel></rss>`;
const serve = (url: string, body: string, type = "application/rss+xml") => (t.web.pages[url] = { type, body });
const add = (url = FEED) => t.api("POST", "/api/discovery/feeds", { url });

describe("subscribing to a feed", () => {
  it("reads it straight away: its name, site and posts", async () => {
    serve(FEED, rss(item(1), item(2)));
    const r = await add();
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ id: expect.any(Number), url: FEED, title: "Test Kitchen", siteUrl: "https://kitchen.example.com/", iconUrl: "https://kitchen.example.com/favicon.ico", items: 2, lastError: null });
    expect((await t.api("GET", "/api/discovery/feeds")).body).toMatchObject([{ title: "Test Kitchen", items: 2 }]);
  });

  it("a website's address: finds the feed it names", async () => {
    serve("https://kitchen.example.com/", '<html><head><link rel="alternate" type="application/rss+xml" href="/feed"></head></html>', "text/html");
    serve(FEED, rss(item(1)));
    expect((await add("https://kitchen.example.com/")).body).toMatchObject({ url: FEED, items: 1 });
  });

  it("not a feed, can't be reached, or already subscribed: says so", async () => {
    serve("https://plain.example.com/", "<html><body>Hi</body></html>", "text/html");
    expect((await add("https://plain.example.com/")).body.error).toMatch(/isn't an RSS or Atom feed/);
    expect((await add("https://nowhere.example.com/feed")).status).toBe(400);
    expect((await add("ftp://x.example.com/feed")).status).toBe(400);
    serve(FEED, rss(item(1)));
    await add();
    expect((await add()).status).toBe(409);
  });

  it("unsubscribing removes its posts too", async () => {
    serve(FEED, rss(item(1)));
    const { id } = (await add()).body;
    expect((await t.api("DELETE", `/api/discovery/feeds/${id}`)).status).toBe(204);
    expect((await t.api("GET", "/api/discovery/items")).body.items).toEqual([]);
  });
});

describe("the posts", () => {
  it("newest first, from all feeds or one, with the feed's name; no AI is asked", async () => {
    serve(FEED, rss(item(1), item(3)));
    serve("https://other.example.com/feed", rss(item(2)).replace("Test Kitchen", "Other"));
    const a = (await add()).body;
    await add("https://other.example.com/feed");
    const all = (await t.api("GET", "/api/discovery/items")).body.items;
    expect(all.map((i: any) => [i.title, i.feedTitle])).toEqual([
      ["Recipe 3", "Test Kitchen"],
      ["Recipe 2", "Other"],
      ["Recipe 1", "Test Kitchen"],
    ]);
    expect(all[0]).not.toHaveProperty("contentHtml"); // the list is light; one post has it all
    expect((await t.api("GET", `/api/discovery/items?feed=${a.id}`)).body.items.map((i: any) => i.title)).toEqual(["Recipe 3", "Recipe 1"]);
    expect(t.ai.calls).toHaveLength(0);
  });

  it("one post, with its safe HTML", async () => {
    serve(FEED, rss(`<item><title>Soup</title><link>https://kitchen.example.com/soup</link><description><![CDATA[<p>Hot.</p><script>x()</script>]]></description></item>`));
    await add();
    const [first] = (await t.api("GET", "/api/discovery/items")).body.items;
    expect((await t.api("GET", `/api/discovery/items/${first.id}`)).body).toMatchObject({ title: "Soup", link: "https://kitchen.example.com/soup", contentHtml: "<p>Hot.</p>", feedTitle: "Test Kitchen" });
  });

  it("pages of 48, then ?before= for more", async () => {
    serve(FEED, rss(...Array.from({ length: 30 }, (_, i) => item(i + 1))));
    await add();
    const first = (await t.api("GET", "/api/discovery/items?limit=20")).body;
    expect(first.items).toHaveLength(20);
    expect(first.more).toBe(true);
    const next = (await t.api("GET", `/api/discovery/items?limit=20&before=${first.next}`)).body;
    expect(next.items).toHaveLength(10);
    expect(next.more).toBe(false);
    expect(new Set([...first.items, ...next.items].map((i: any) => i.id)).size).toBe(30);
  });
});

describe("your tags", () => {
  it("each person keeps their own", async () => {
    expect((await t.api("PUT", "/api/discovery/tags", { tags: ["Air Fryer", "keto", "keto", " "] })).body).toEqual({ tags: ["Air Fryer", "keto"] });
    expect((await t.api("GET", "/api/discovery/tags")).body).toEqual({ tags: ["Air Fryer", "keto"] });
    await t.api("POST", "/api/household/members", { username: "sam", password: "sam-password-123" });
    const sam = (await t.api("POST", "/api/auth/login", { username: "sam", password: "sam-password-123" }, { authorization: "" })).body.token;
    expect((await t.api("GET", "/api/discovery/tags", undefined, { authorization: `Bearer ${sam}` })).body).toEqual({ tags: [] });
  });

  it("Filter by tags: only posts matching one of them, each saying which", async () => {
    serve(FEED, rss(item(1, " (Air Fryer)"), item(2), item(3, " keto bowl")));
    await add();
    await t.api("PUT", "/api/discovery/tags", { tags: ["air fryer", "KETO"] });
    const all = (await t.api("GET", "/api/discovery/items")).body.items;
    expect(all.map((i: any) => i.matchedTags)).toEqual([["KETO"], [], ["air fryer"]]);
    const only = (await t.api("GET", "/api/discovery/items?match=tags")).body.items;
    expect(only.map((i: any) => i.title)).toEqual(["Recipe 3 keto bowl", "Recipe 1 (Air Fryer)"]);
  });
});

describe("filtering by the tags you pick", () => {
  it("?tags= only posts matching any of those (any case, part of a word), each saying which", async () => {
    serve(FEED, rss(item(1, " (Air Fryer)"), item(2, " chicken soup"), item(3, " keto bowl")));
    await add();
    await t.api("PUT", "/api/discovery/tags", { tags: ["air fryer", "KETO", "chicken"] });
    const pick = async (tags: string[]) => (await t.api("GET", `/api/discovery/items?tags=${encodeURIComponent(tags.join(","))}`)).body.items.map((i: any) => [i.title, i.matchedTags]);
    expect(await pick(["keto"])).toEqual([["Recipe 3 keto bowl", ["keto"]]]);
    expect(await pick(["Air Fryer", "chicken"])).toEqual([["Recipe 2 chicken soup", ["chicken"]], ["Recipe 1 (Air Fryer)", ["Air Fryer"]]]);
    expect((await t.api("GET", "/api/discovery/items?tags=")).body.items).toHaveLength(3); // none picked: everything
  });
});

describe("feeds on your own network", () => {
  // e.g. a feed a script on your own server writes for RecipeHub to read
  it("a feed on a LAN address (192.168.x.x) subscribes and reads, pictures and all", async () => {
    const LAN = "http://192.168.1.50:8180/weeknight.xml";
    serve(LAN, readFileSync(new URL("./fixtures/lan-feed.xml", import.meta.url), "utf8"));
    const r = await add(LAN);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ title: "Example Kitchen: Weeknight", items: 6 });
    const [first] = (await t.api("GET", "/api/discovery/items")).body.items;
    expect(first).toMatchObject({ title: "Potato and Sun-Dried Tomato Tart", link: "https://recipes.example.com/recipes/100-potato-and-sun-dried-tomato-tart", author: "Sample Cook" });
    expect(first.thumbnailUrl).toMatch(/^https:\/\/images\.example\.com\//);
  });

  it("the server's own address (localhost) is still refused", async () => {
    serve("http://127.0.0.1:8180/feed.xml", rss(item(1)));
    const r = await add("http://127.0.0.1:8180/feed.xml");
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/server itself/);
  });
});

describe("keeping feeds fresh", () => {
  it("the timed check follows the Discovery refresh switch (on unless switched off)", async () => {
    serve(FEED, rss(item(1)));
    await add();
    serve(FEED, rss(item(1), item(2)));
    await t.api("PUT", "/api/settings/features", { discoveryRefresh: false });
    expect(await scheduledRefresh(t.app.db, t.app.fetchOptions)).toBeNull();
    expect((await t.api("GET", "/api/discovery/items")).body.items).toHaveLength(1);
    await t.api("PUT", "/api/settings/features", { discoveryRefresh: true });
    expect(await scheduledRefresh(t.app.db, t.app.fetchOptions)).toMatchObject({ added: 1 });
    // Refresh (by hand) works either way
  });

  it("a refresh adds new posts and updates changed ones, without doubles", async () => {
    serve(FEED, rss(item(1)));
    await add();
    serve(FEED, rss(item(1, " (updated)"), item(2)));
    expect((await t.api("POST", "/api/discovery/refresh")).body).toMatchObject({ feeds: 1, added: 1 });
    expect((await t.api("GET", "/api/discovery/items")).body.items.map((i: any) => i.title)).toEqual(["Recipe 2", "Recipe 1 (updated)"]);
  });

  it("a feed that fails says why, and keeps its posts", async () => {
    serve(FEED, rss(item(1)));
    await add();
    delete t.web.pages[FEED];
    await refreshAllFeeds(t.app.db, t.app.fetchOptions);
    const [f] = (await t.api("GET", "/api/discovery/feeds")).body;
    expect(f.lastError).toMatch(/./);
    expect(f.items).toBe(1);
  });

  it("posts gone from the feed are kept 60 days, then dropped; ones still in it stay", async () => {
    serve(FEED, rss(item(1), item(2)));
    await add();
    await t.app.db.execute(sql`update discovery_items set last_seen_at = now() - interval '61 days'`);
    serve(FEED, rss(item(2))); // 1 left the feed; 2 is still in it
    await refreshAllFeeds(t.app.db, t.app.fetchOptions);
    expect((await t.api("GET", "/api/discovery/items")).body.items.map((i: any) => i.title)).toEqual(["Recipe 2"]);
  });
});
