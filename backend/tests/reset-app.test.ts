import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { setupTestApp, type TestApp } from "./helpers.js";

// Settings › Data › Reset the entire app: back to a fresh install (a backup is made first and the
// backups are kept), and the next visit shows the first-run screen
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

describe("Reset the entire app", () => {
  it("needs RESET typed in", async () => {
    expect((await t.api("POST", "/api/wipe/all", {})).status).toBe(400);
    expect((await t.api("POST", "/api/wipe/all", { confirm: "DELETE" })).status).toBe(400);
  });

  it("owner only", async () => {
    await t.api("POST", "/api/household/members", { username: "sam", password: "sam-password-123" });
    const sam = (await t.api("POST", "/api/auth/login", { username: "sam", password: "sam-password-123" })).body.token;
    const res = await t.app.inject({ method: "POST", url: "/api/wipe/all", headers: { authorization: `Bearer ${sam}` }, payload: { confirm: "RESET" } });
    expect(res.statusCode).toBe(403);
  });

  it("removes everything, keeps the backups (with one made first), and the first-run screen comes back", async () => {
    await t.api("POST", "/api/recipes", { title: "Chili", ingredients: ["1 onion"], steps: ["Cook."] });
    await t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
    await t.api("POST", "/api/household/members", { username: "sam", password: "sam-password-123" });
    const res = await t.api("POST", "/api/wipe/all", { confirm: "RESET" });
    expect(res.status).toBe(200);
    expect(res.body.backup).toMatch(/before-reset/);
    expect(fs.readdirSync(t.app.backupDir).some((f) => f.includes("before-reset"))).toBe(true);
    // signed out, nobody left: setup is needed again
    expect((await t.api("GET", "/api/auth/me")).status).toBe(401);
    expect((await t.api("GET", "/api/auth/status")).body).toMatchObject({ setupRequired: true });
    // a new owner starts fresh, with the defaults a new install has
    const owner = await t.api("POST", "/api/auth/setup", { username: "alex", password: "correct-horse-battery", email: "alex@example.com" });
    expect(owner.body.token).toBeTruthy();
    t.setToken(owner.body.token);
    const list = (await t.api("GET", "/api/recipes")).body;
    expect(list.total).toBe(0);
    expect((await t.api("GET", "/api/settings/ai")).body.settings).toBeNull();
    expect((await t.api("GET", "/api/categories")).body.map((c: any) => c.name)).toContain("Dinner");
    expect((await t.api("GET", "/api/auth/me")).body.user.setupDone).toBe(false);
  });
});
