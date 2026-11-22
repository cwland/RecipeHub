import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// The setup wizard: each person's measurement preference, and whether they've been through setup
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const me = async () => (await t.api("GET", "/api/auth/me")).body.user;

describe("first-run setup", () => {
  it("a new account hasn't been through setup; As is is the starting measurement", async () => {
    expect(await me()).toMatchObject({ setupDone: false, units: "original" });
  });

  it("measurements: As is, Metric or US", async () => {
    expect((await t.api("PATCH", "/api/profile", { units: "metric" })).status).toBe(200);
    expect((await me()).units).toBe("metric");
    expect((await t.api("PATCH", "/api/profile", { units: "imperial" })).status).toBe(400);
  });

  it("Cook mode keeps the screen awake unless you switch it off (each person's own choice)", async () => {
    expect((await me()).keepAwake).toBe(true);
    expect((await t.api("PATCH", "/api/profile", { keepAwake: false })).body.keepAwake).toBe(false);
    expect((await me()).keepAwake).toBe(false);
  });

  it("a profile save answers with the whole account (the app keeps it as the signed-in user)", async () => {
    const r = await t.api("PATCH", "/api/profile", { displayName: "Alex Cook" });
    expect(r.body).toMatchObject({ displayName: "Alex Cook", role: "owner", units: expect.any(String), setupDone: false });
  });

  it("finishing setup is remembered", async () => {
    const r = await t.api("POST", "/api/profile/setup-done");
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ setupDone: true });
    expect((await me()).setupDone).toBe(true);
  });

  it("a member added later goes through it on their first sign-in", async () => {
    await t.api("POST", "/api/profile/setup-done");
    await t.api("POST", "/api/household/members", { username: "sam", password: "sam-password-1" });
    const token = (await t.api("POST", "/api/auth/login", { username: "sam", password: "sam-password-1" })).body.token;
    const sam = (await t.api("GET", "/api/auth/me", undefined, { authorization: `Bearer ${token}` })).body.user;
    expect(sam).toMatchObject({ role: "member", setupDone: false });
  });
});
