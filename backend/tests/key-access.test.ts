import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { keyAllows, KEY_ACCESS } from "../src/lib/keyAccess.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const makeKey = async (access?: string) => (await t.api("POST", "/api/keys", { name: `k-${access}`, ...(access ? { access } : {}) })).body;
const withKey = (key: string) => (method: string, url: string, payload?: object) => t.api(method, url, payload, { "x-api-key": key, authorization: "" });

describe("API key access", () => {
  it("is chosen when the key is made and shown in the list", async () => {
    const k = await makeKey("grocery_write");
    expect(k).toMatchObject({ access: "grocery_write" });
    expect((await t.api("GET", "/api/keys")).body.map((x: any) => x.access)).toEqual(["grocery_write"]);
    expect((await t.api("POST", "/api/keys", { name: "x", access: "everything" })).status).toBe(400);
    expect((await makeKey()).access).toBe("read"); // default: the safest
  });

  it("can be changed later, by a signed-in user only", async () => {
    const k = await makeKey("read");
    const as = withKey(k.key);
    expect((await as("GET", "/api/info")).status).toBe(200);
    expect((await t.api("PATCH", `/api/keys/${k.id}`, { access: "recipe_push" })).body).toMatchObject({ access: "recipe_push" });
    expect((await as("GET", "/api/info")).status).toBe(403);
    expect((await as("PATCH", `/api/keys/${k.id}`, { access: "admin" })).status).toBe(403);
    expect((await t.api("PATCH", "/api/keys/999", { access: "read" })).status).toBe(404);
  });

  it("admin keys see logs and backups; no key reaches settings, keys, sign-in or restore", async () => {
    const admin = withKey((await makeKey("admin")).key);
    const read = withKey((await makeKey("read")).key);
    expect((await admin("GET", "/api/logs")).status).toBe(200);
    expect((await admin("GET", "/api/backups")).status).toBe(200);
    expect((await read("GET", "/api/logs")).status).toBe(403);
    for (const [m, url] of [["GET", "/api/settings/email"], ["GET", "/api/keys"], ["GET", "/api/auth/me"], ["POST", "/api/import?confirm=replace"], ["PATCH", "/api/profile"]] as const) {
      expect((await admin(m, url, {})).status, url).toBe(403);
    }
  });
});

// The rules themselves, for routes the coming features add
describe("key rules", () => {
  const allowed = (method: string, path: string) => KEY_ACCESS.filter((a) => keyAllows(a, method, path));
  it("read reads, write writes", () => {
    expect(allowed("GET", "/api/recipes/:id")).toEqual(["read", "admin"]);
    expect(allowed("PATCH", "/api/recipes/:id")).toEqual(["write", "admin"]);
  });
  it("recipe push only sends recipes in", () => {
    expect(allowed("POST", "/api/recipes/import")).toEqual(["write", "recipe_push", "admin"]);
    expect(allowed("GET", "/api/imports/:id")).toEqual(["read", "recipe_push", "admin"]);
    expect(keyAllows("recipe_push", "DELETE", "/api/recipes/:id")).toBe(false);
  });
  it("grocery write only changes grocery lists", () => {
    expect(allowed("POST", "/api/grocery/lists/:id/items")).toEqual(["write", "grocery_write", "admin"]);
    expect(keyAllows("grocery_write", "GET", "/api/grocery/lists")).toBe(false);
    expect(keyAllows("grocery_write", "POST", "/api/recipes")).toBe(false);
  });
});
