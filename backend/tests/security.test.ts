import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => {
  t = await setupTestApp({ rateLimit: { max: 3, windowMs: 60_000, badKeyMax: 3 } });
  await t.reset();
  await t.login();
});
afterAll(async () => t.close());

describe("security", () => {
  it("sends security headers", async () => {
    const r = await t.app.inject({ method: "GET", url: "/api/health" });
    expect(r.headers).toMatchObject({ "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "same-origin" });
  });

  it("limits tries at sign-in routes per address, per route", async () => {
    const tries = [];
    for (let i = 0; i < 4; i++) tries.push((await t.api("POST", "/api/auth/login", { username: "nobody", password: "wrong-password" })).status);
    expect(tries).toEqual([401, 401, 401, 429]);
    expect((await t.api("POST", "/api/auth/login", { username: "nobody", password: "x" })).body.error).toMatch(/Too many tries/);
    // Other routes keep their own count
    expect((await t.api("POST", "/api/auth/forgot", { who: "alex" })).status).not.toBe(429);
  });

  it("blocks an address guessing API keys", async () => {
    const tok = t.getToken();
    t.setToken("");
    const s = [];
    for (let i = 0; i < 3; i++) s.push((await t.api("GET", "/api/info", undefined, { "x-api-key": `cd_guess${i}` })).status);
    expect(s).toEqual([401, 401, 429]);
    t.setToken(tok);
    expect((await t.api("GET", "/api/logs?category=api")).body[0].event).toMatch(/Too many unknown API keys/);
  });

  it("knows where it is behind a reverse proxy", async () => {
    const r = await t.app.inject({ method: "GET", url: "/api/info", headers: { authorization: `Bearer ${t.getToken()}`, "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9" } });
    expect(r.headers["strict-transport-security"]).toBeDefined();
  });
});

describe("API docs", () => {
  it("lists the routes at /api/docs without signing in", async () => {
    const r = await t.app.inject({ method: "GET", url: "/api/docs/json" });
    expect(r.statusCode).toBe(200);
    const spec = r.json();
    expect(spec.info.title).toBe("RecipeHub API");
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(["/api/info", "/api/keys", "/api/auth/login"]));
    expect((await t.app.inject({ method: "GET", url: "/api/docs" })).statusCode).toBeLessThan(400);
  });
});
