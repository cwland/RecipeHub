import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// Public share links: every recipe has an unguessable read-only link (/share/rcp_…) anyone can
// open without signing in. One switch turns them all off; New link replaces one that spread.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const chili = { title: "Texas Chili", description: "Big and beefy.", ingredients: "2 lb chuck\n3 dried anchos", steps: ["Brown the beef.", "Simmer 2 hours."], servings: 6, totalMinutes: 150, notes: "Grandma's secret: a square of chocolate.", tags: ["spicy"], categories: ["Dinner"], sourceUrl: "https://food.test/chili", sourceName: "Food Test" };
const add = async (over: object = {}) => (await t.api("POST", "/api/recipes", { ...chili, ...over })).body;
const linkOf = async (id: number) => (await t.api("GET", `/api/recipes/${id}/share-link`)).body;
const publicGet = (token: string) => t.app.inject({ method: "GET", url: `/api/public/share/${token}` });

describe("every recipe has a share link", () => {
  it("an unguessable token, the same each time, different per recipe", async () => {
    const [a, b] = [await add(), await add({ title: "Stew" })];
    const la = await linkOf(a.id);
    expect(la).toMatchObject({ on: true, path: expect.stringMatching(/^\/share\/rcp_[0-9a-f]{32}$/) });
    expect(la.url).toBe(`http://recipes.test${la.path}`); // the address it was asked on (the test helper's)
    expect((await linkOf(a.id)).path).toBe(la.path);
    expect((await t.api("POST", `/api/recipes/${a.id}/share-link`)).body.path).toBe(la.path); // "generate or fetch"
    expect((await linkOf(b.id)).path).not.toBe(la.path);
  });

  it("uses the app's address from Settings › Email when it's set", async () => {
    await t.api("PUT", "/api/settings/email", { enabled: true, host: "smtp.test", port: 587, username: "u", password: "p", fromAddress: "c@test.dev", appUrl: "https://recipes.example.com/" });
    const r = await add();
    const l = await linkOf(r.id);
    expect(l.url).toBe(`https://recipes.example.com${l.path}`);
  });
});

describe("the public page's recipe", () => {
  it("anyone can read it, without signing in", async () => {
    const r = await add();
    await t.api("PUT", `/api/recipes/${r.id}/me`, { favorite: true, rating: 5, notes: "My private note" });
    const token = (await linkOf(r.id)).path.split("/").pop();
    const res = await publicGet(token);
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p).toMatchObject({ title: "Texas Chili", description: "Big and beefy.", servings: 6, totalMinutes: 150, tags: ["spicy"], categories: ["Dinner"], sourceUrl: "https://food.test/chili", sourceName: "Food Test" });
    expect(p.ingredients.map((i: any) => i.raw)).toEqual(["2 lb chuck", "3 dried anchos"]);
    expect(p.steps).toEqual([{ text: "Brown the beef." }, { text: "Simmer 2 hours." }]);
    // nothing about the household: no ids, who added it, ratings, private or recipe notes
    for (const k of ["id", "me", "createdBy", "notes", "collections", "substitutions", "versioning"]) expect([k, k in p]).toEqual([k, false]);
    expect(JSON.stringify(p)).not.toMatch(/private note|chocolate/i);
  });

  it("an unknown token is not found", async () => {
    expect((await publicGet("rcp_00000000000000000000000000000000")).statusCode).toBe(404);
    expect((await publicGet("nope")).statusCode).toBe(404);
  });

  it("New link: the old one stops working", async () => {
    const r = await add();
    const old = (await linkOf(r.id)).path;
    const fresh = (await t.api("POST", `/api/recipes/${r.id}/share-link/new`)).body;
    expect(fresh.path).not.toBe(old);
    expect((await publicGet(old.split("/").pop()!)).statusCode).toBe(404);
    expect((await publicGet(fresh.path.split("/").pop())).statusCode).toBe(200);
    expect((await t.api("GET", "/api/logs?category=import")).body[0]).toMatchObject({ event: 'New share link for "Texas Chili" (the old one stopped working)' });
  });
});

describe("the switch for all public links", () => {
  it("on by default; off makes every link not found until it's back on", async () => {
    const r = await add();
    const token = (await linkOf(r.id)).path.split("/").pop();
    expect((await t.api("GET", "/api/settings/features")).body.publicLinks).toBe(true);
    await t.api("PUT", "/api/settings/features", { publicLinks: false });
    expect((await publicGet(token)).statusCode).toBe(404);
    expect((await linkOf(r.id)).on).toBe(false);
    expect((await t.api("GET", "/api/logs?category=import")).body[0]).toMatchObject({ event: "Public share links turned off" });
    await t.api("PUT", "/api/settings/features", { publicLinks: true });
    expect((await publicGet(token)).statusCode).toBe(200); // the same links work again
  });
});

describe("backups", () => {
  const exportJson = async () => JSON.parse((await t.app.inject({ method: "GET", url: "/api/export", headers: { authorization: `Bearer ${t.getToken()}` } })).body);

  it("a backup keeps each recipe's link", async () => {
    const r = await add();
    const before = (await linkOf(r.id)).path;
    expect((await t.api("POST", "/api/import?confirm=replace", await exportJson())).status).toBe(200);
    expect((await linkOf(r.id)).path).toBe(before);
  });

  it("a backup from before share links gives every recipe one of its own", async () => {
    await add();
    await add({ title: "Stew" });
    const old = await exportJson();
    for (const row of old.data.recipes) delete row.shareToken;
    expect((await t.api("POST", "/api/import?confirm=replace", old)).status).toBe(200);
    const list = (await t.api("GET", "/api/recipes")).body.recipes;
    const paths = await Promise.all(list.map(async (x: any) => (await linkOf(x.id)).path));
    expect(paths).toHaveLength(2);
    expect(new Set(paths).size).toBe(2);
    for (const p of paths) expect(p).toMatch(/^\/share\/rcp_[0-9a-f]{32}$/);
  });
});

describe("a share link's preview card", () => {
  it("title, summary and the photo's full address; nothing for an unknown or turned-off link", async () => {
    const { sharePreview } = await import("../src/lib/shareLinks.js");
    const r = await add({ imageUrl: "/api/photos/0e0d2c6f-1a2b-4c3d-8e9f-001122334455.webp" });
    const token = (await linkOf(r.id)).path.split("/").pop()!;
    expect(await sharePreview(t.app.db, token, "https://recipes.example.com/")).toEqual({ title: "Texas Chili", description: "Big and beefy.", image: "https://recipes.example.com/api/photos/0e0d2c6f-1a2b-4c3d-8e9f-001122334455.webp", url: `https://recipes.example.com/share/${token}` });
    expect(await sharePreview(t.app.db, "rcp_ffffffffffffffffffffffffffffffff", "https://x.test")).toBeNull();
    await t.api("PUT", "/api/settings/features", { publicLinks: false });
    expect(await sharePreview(t.app.db, token, "https://x.test")).toBeNull();
  });
});
