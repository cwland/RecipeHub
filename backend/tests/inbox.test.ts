import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { keyAllows } from "../src/lib/keyAccess.js";

// The inbox: things sent in by other apps (the RecipeHub Companion extension) to look at later.
// "Inbox only" keys can push to it and do nothing else; only signed-in people can read it.

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const makeKey = async (access: string) => (await t.api("POST", "/api/keys", { name: "RecipeHub Companion", access })).body.key as string;
const withKey = (key: string) => (method: string, url: string, payload?: object) => t.api(method, url, payload, { "x-api-key": key, authorization: "" });
const link = { type: "RECIPE_LINK", url: "https://example.com/pork-roast", title: "Pork Roast", sourceApp: "RecipeHub Companion", metadata: { pageTitle: "Pork Roast | Example", favIconUrl: "https://example.com/favicon.ico", capturedAt: "2026-11-02T10:00:00Z" } };

describe("an Inbox only key", () => {
  it("is a key type of its own, labelled Inbox only", async () => {
    expect((await t.api("POST", "/api/keys", { name: "x", access: "inbox_push" })).body).toMatchObject({ access: "inbox_push" });
  });

  it("can push to the inbox", async () => {
    const as = withKey(await makeKey("inbox_push"));
    const r = await as("POST", "/api/inbox", link);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ id: expect.any(Number), type: "RECIPE_LINK", title: "Pork Roast", status: "PENDING" });
  });

  it("can't read, change or clear the inbox, or do anything else", async () => {
    const as = withKey(await makeKey("inbox_push"));
    const { id } = (await as("POST", "/api/inbox", link)).body;
    for (const [method, url] of [["GET", "/api/inbox"], ["GET", "/api/inbox/count"], ["PATCH", `/api/inbox/${id}`], ["DELETE", `/api/inbox/${id}`], ["GET", "/api/recipes"], ["POST", "/api/recipes"], ["POST", "/api/recipes/import"]] as const)
      expect((await as(method, url, method === "PATCH" ? { status: "DISMISSED" } : undefined)).status, `${method} ${url}`).toBe(403);
  });

  it("other keys can't read or clear the inbox either (even admin keys); write and admin keys can push", () => {
    for (const access of ["read", "write", "recipe_push", "grocery_write", "admin"] as const) {
      expect(keyAllows(access, "GET", "/api/inbox")).toBe(false);
      expect(keyAllows(access, "GET", "/api/inbox/count")).toBe(false);
      expect(keyAllows(access, "PATCH", "/api/inbox/:id")).toBe(false);
      expect(keyAllows(access, "DELETE", "/api/inbox/:id")).toBe(false);
    }
    expect(keyAllows("write", "POST", "/api/inbox")).toBe(true);
    expect(keyAllows("admin", "POST", "/api/inbox")).toBe(true);
    expect(keyAllows("read", "POST", "/api/inbox")).toBe(false);
    expect(keyAllows("recipe_push", "POST", "/api/inbox")).toBe(false);
    expect(keyAllows("inbox_push", "POST", "/api/inbox")).toBe(true);
  });
});

describe("pushing to the inbox", () => {
  it("a link, an Instagram link, a note, or recipe data the page carried", async () => {
    expect((await t.api("POST", "/api/inbox", { type: "INSTAGRAM_LINK", url: "https://www.instagram.com/p/abc123/" })).status).toBe(201);
    expect((await t.api("POST", "/api/inbox", { type: "TEXT_NOTE", content: "Try brining overnight\nand less salt" })).body).toMatchObject({ title: "Try brining overnight" });
    expect((await t.api("POST", "/api/inbox", { type: "RAW_RECIPE_DATA", url: "https://example.com/x", content: '{"@type":"Recipe","name":"Chili"}' })).status).toBe(201);
  });

  it("without a title, uses the page title, then the link's site", async () => {
    expect((await t.api("POST", "/api/inbox", { type: "RECIPE_LINK", url: "https://example.com/a", metadata: { pageTitle: "Best Chili" } })).body.title).toBe("Best Chili");
    expect((await t.api("POST", "/api/inbox", { type: "RECIPE_LINK", url: "https://www.example.com/b" })).body.title).toBe("example.com");
  });

  it("checks what's sent", async () => {
    const bad = async (body: object) => (await t.api("POST", "/api/inbox", body)).status;
    expect(await bad({ type: "RECIPE_LINK" })).toBe(400); // a link needs its url
    expect(await bad({ type: "TEXT_NOTE" })).toBe(400); // a note needs text
    expect(await bad({ type: "SOMETHING", url: "https://example.com" })).toBe(400);
    expect(await bad({ type: "RECIPE_LINK", url: "javascript:alert(1)" })).toBe(400);
    expect(await bad({ type: "RECIPE_LINK", url: "https://example.com", metadata: { favIconUrl: "javascript:x" } })).toBe(400);
  });

  it("the same link sent again while it's waiting isn't added twice", async () => {
    const a = (await t.api("POST", "/api/inbox", link)).body;
    const again = await t.api("POST", "/api/inbox", { ...link, title: "Pork Roast again" });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: a.id, duplicate: true });
    expect((await t.api("GET", "/api/inbox/count")).body).toEqual({ pending: 1 });
  });

  it("the same note sent again while it's waiting isn't added twice either", async () => {
    const a = (await t.api("POST", "/api/inbox", { type: "TEXT_NOTE", content: "Dry brine overnight" })).body;
    expect((await t.api("POST", "/api/inbox", { type: "TEXT_NOTE", content: "Dry brine overnight" })).body).toMatchObject({ id: a.id, duplicate: true });
    expect((await t.api("POST", "/api/inbox", { type: "TEXT_NOTE", content: "Dry brine for 2 days" })).status).toBe(201);
  });

  it("open copies of the app hear about it (for the badge)", async () => {
    const heard: unknown[] = [];
    const off = t.app.events.on((e) => heard.push(e));
    await withKey(await makeKey("inbox_push"))("POST", "/api/inbox", link);
    off();
    expect(heard).toContainEqual({ topic: "inbox", by: null });
  });
});

describe("the inbox, for signed-in people", () => {
  it("lists what's waiting, newest first, with who or what sent it", async () => {
    const key = await makeKey("inbox_push");
    await withKey(key)("POST", "/api/inbox", link);
    await t.api("POST", "/api/inbox", { type: "TEXT_NOTE", content: "A note" });
    const list = (await t.api("GET", "/api/inbox")).body;
    expect(list.map((i: any) => i.title)).toEqual(["A note", "Pork Roast"]);
    expect(list[1]).toMatchObject({ url: link.url, sourceApp: "RecipeHub Companion", sentBy: "RecipeHub Companion", metadata: link.metadata, createdAt: expect.any(String) });
    expect((await t.api("GET", "/api/inbox/count")).body).toEqual({ pending: 2 });
  });

  it("is shared by the household", async () => {
    await t.api("POST", "/api/inbox", link);
    await t.api("POST", "/api/household/members", { username: "sam", password: "sam-password-123" });
    const sam = (await t.api("POST", "/api/auth/login", { username: "sam", password: "sam-password-123" }, { authorization: "" })).body.token;
    expect((await t.api("GET", "/api/inbox", undefined, { authorization: `Bearer ${sam}` })).body).toHaveLength(1);
  });

  it("dismissed or processed items leave the waiting list (and the count); ?status= shows them", async () => {
    const a = (await t.api("POST", "/api/inbox", link)).body;
    const b = (await t.api("POST", "/api/inbox", { type: "TEXT_NOTE", content: "A note" })).body;
    expect((await t.api("PATCH", `/api/inbox/${a.id}`, { status: "DISMISSED" })).body).toMatchObject({ status: "DISMISSED" });
    await t.api("PATCH", `/api/inbox/${b.id}`, { status: "PROCESSED" });
    expect((await t.api("GET", "/api/inbox")).body).toEqual([]);
    expect((await t.api("GET", "/api/inbox/count")).body).toEqual({ pending: 0 });
    expect((await t.api("GET", "/api/inbox?status=DISMISSED")).body.map((i: any) => i.id)).toEqual([a.id]);
    expect((await t.api("PATCH", `/api/inbox/${a.id}`, { status: "WHATEVER" })).status).toBe(400);
    // the same link can come in again once the first one was dealt with
    expect((await t.api("POST", "/api/inbox", link)).status).toBe(201);
  });

  it("delete removes an item for good", async () => {
    const a = (await t.api("POST", "/api/inbox", link)).body;
    expect((await t.api("DELETE", `/api/inbox/${a.id}`)).status).toBe(204);
    expect((await t.api("DELETE", `/api/inbox/${a.id}`)).status).toBe(404);
    expect((await t.api("PATCH", "/api/inbox/999", { status: "DISMISSED" })).status).toBe(404);
  });
});

// ---------- for the extension: is this key right, and what may it do? ----------

describe("checking a key", () => {
  it("any key can ask what it is (and nothing more)", async () => {
    const key = await makeKey("inbox_push");
    const r = await withKey(key)("GET", "/api/key-check");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ app: "RecipeHub", version: expect.any(String), name: "RecipeHub Companion", access: "inbox_push", canPushToInbox: true, canImport: false, aiCorrection: false });
    const push = await t.api("POST", "/api/keys", { name: "Importer", access: "recipe_push" });
    expect((await withKey(push.body.key)("GET", "/api/key-check")).body).toMatchObject({ access: "recipe_push", canPushToInbox: false, canImport: true });
  });

  it("a wrong key gets 401; signed in, it says so", async () => {
    expect((await withKey("cul_not-a-real-key")("GET", "/api/key-check")).status).toBe(401);
    expect((await t.api("GET", "/api/key-check")).body).toMatchObject({ app: "RecipeHub", signedIn: true });
  });
});

describe("a note sent from a page", () => {
  it("keeps the page's link, and isn't mistaken for the link itself", async () => {
    await t.api("POST", "/api/inbox", link);
    const note = await t.api("POST", "/api/inbox", { type: "TEXT_NOTE", url: link.url, content: "Brine it overnight" });
    expect(note.status).toBe(201);
    expect(note.body).toMatchObject({ type: "TEXT_NOTE", url: link.url, title: "Brine it overnight" });
    // its own first line names it, not the page it was written on
    const withPage = await t.api("POST", "/api/inbox", { type: "TEXT_NOTE", url: link.url, content: "Less salt next time\nmaybe 2 tbsp", metadata: { pageTitle: "Pork Roast | Example" } });
    expect(withPage.body.title).toBe("Less salt next time");
  });
});

describe("imported from the inbox", () => {
  it("the item moves to Imported, with its recipe; deleting the recipe keeps the entry", async () => {
    const a = (await t.api("POST", "/api/inbox", link)).body;
    const recipe = (await t.api("POST", "/api/recipes", { title: "Pork Roast", ingredients: "1 pork butt" })).body;
    expect((await t.api("PATCH", `/api/inbox/${a.id}`, { status: "PROCESSED", recipeId: recipe.id })).body).toMatchObject({ status: "PROCESSED", recipeId: recipe.id });
    expect((await t.api("GET", "/api/inbox?status=PROCESSED")).body).toMatchObject([{ id: a.id, recipeId: recipe.id }]);
    await t.api("DELETE", `/api/recipes/${recipe.id}`);
    expect((await t.api("GET", "/api/inbox?status=PROCESSED")).body).toMatchObject([{ id: a.id, recipeId: null }]);
    expect((await t.api("PATCH", `/api/inbox/${a.id}`, { status: "PROCESSED", recipeId: 99999 })).status).toBe(400);
  });
});
