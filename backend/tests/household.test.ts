import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login(); // alex, the owner
});

const signIn = async (username: string, password: string) => (await t.api("POST", "/api/auth/login", { username, password })).body;
const as = (token: string) => (method: string, url: string, body?: object) => t.api(method, url, body, { authorization: `Bearer ${token}` });
const setUpEmail = () => t.api("PUT", "/api/settings/email", { enabled: true, host: "smtp.test", port: 587, security: "starttls", username: "a", password: "b", fromAddress: "recipehub@test", appUrl: "https://recipes.test" });

describe("household", () => {
  it("the first account is the owner; the owner adds a member with a password", async () => {
    expect((await t.api("GET", "/api/auth/me")).body.user.role).toBe("owner");
    const m = await t.api("POST", "/api/household/members", { username: "sam", displayName: "Sam", password: "sam-password-1" });
    expect(m.status).toBe(201);
    expect(m.body).toMatchObject({ username: "sam", displayName: "Sam", role: "member", invited: false });
    const sam = await signIn("sam", "sam-password-1");
    expect(sam.user).toMatchObject({ username: "sam", role: "member" });
    // members see who's in the household, and share the recipes
    expect((await as(sam.token)("GET", "/api/household/members")).body.map((x: any) => x.username)).toEqual(["alex", "sam"]);
    const r = await as(sam.token)("POST", "/api/recipes", { title: "Sam's soup" });
    expect((await t.api("GET", `/api/recipes/${r.body.id}`)).body.createdBy).toBe(2);
    // ...but favorites are their own
    await as(sam.token)("PUT", `/api/recipes/${r.body.id}/me`, { favorite: true });
    expect((await t.api("GET", `/api/recipes/${r.body.id}`)).body.me.favorite).toBe(false);
  });

  it("members can't change server settings, keys, backups or members", async () => {
    await t.api("POST", "/api/household/members", { username: "sam", password: "sam-password-1" });
    const sam = as((await signIn("sam", "sam-password-1")).token);
    for (const [m, url, body] of [
      ["GET", "/api/settings/email"],
      ["PUT", "/api/settings/ai", { services: [] }],
      ["GET", "/api/keys"],
      ["GET", "/api/logs"],
      ["GET", "/api/backups"],
      ["GET", "/api/export"],
      ["POST", "/api/household/members", { username: "x", password: "xxxxxxxx" }],
      ["DELETE", "/api/household/members/1"],
    ] as [string, string, object?][]) {
      const r = await sam(m, url, body);
      expect(r.status, url).toBe(403);
      expect(r.body.error).toBe("Only the household owner can do this");
    }
    // their own profile and security are theirs
    expect((await sam("PATCH", "/api/profile", { displayName: "Sammy" })).status).toBe(200);
    expect((await sam("GET", "/api/auth/sessions")).status).toBe(200);
  });

  it("sign-in history: the owner sees everyone's, a member their own", async () => {
    await t.api("POST", "/api/household/members", { username: "sam", password: "sam-password-1" });
    const sam = await signIn("sam", "sam-password-1");
    await signIn("alex", "wrong-password");
    const own = (await as(sam.token)("GET", "/api/auth/logins")).body;
    expect(own.every((e: any) => e.username === "sam")).toBe(true);
    const all = (await t.api("GET", "/api/auth/logins")).body;
    expect(new Set(all.map((e: any) => e.username))).toEqual(new Set(["alex", "sam"]));
  });

  it("invite by email: they choose a password from the link", async () => {
    expect((await t.api("POST", "/api/household/members", { username: "jordan", email: "jordan@example.com", invite: true })).status).toBe(201);
    const mail = t.sent.find((m) => m.to === "jordan@example.com")!;
    expect(mail.subject).toBe("alex invited you to RecipeHub");
    expect((await t.api("GET", "/api/household/members")).body[1]).toMatchObject({ username: "jordan", invited: true });
    // no password works until then
    expect((await t.api("POST", "/api/auth/login", { username: "jordan", password: "invite:anything" })).status).toBe(401);
    const token = mail.text!.match(/token=([\w-]+)/)![1];
    const r = await t.api("POST", "/api/auth/reset", { token, newPassword: "jordan-password-1" });
    expect(r.status).toBe(200);
    expect((await signIn("jordan", "jordan-password-1")).user.username).toBe("jordan");
    expect((await t.api("GET", "/api/household/members")).body[1].invited).toBe(false);
    // an invite needs an email address
    expect((await t.api("POST", "/api/household/members", { username: "bo", invite: true })).status).toBe(400);
  });

  it("forgot password: for whoever asks, by username or email", async () => {
    await setUpEmail();
    await t.api("POST", "/api/household/members", { username: "sam", email: "sam@example.com", password: "sam-password-1" });
    t.sent.length = 0;
    expect((await t.api("POST", "/api/auth/forgot", { who: "SAM@example.com" })).status).toBe(200);
    expect(t.sent.map((m) => m.to)).toEqual(["sam@example.com"]);
    // unknown: the same answer, no email
    expect((await t.api("POST", "/api/auth/forgot", { who: "nobody" })).status).toBe(429); // (one a minute)
  });

  it("roles: there's always an owner; removing someone keeps their recipes", async () => {
    const sam = (await t.api("POST", "/api/household/members", { username: "sam", password: "sam-password-1" })).body;
    expect((await t.api("PATCH", "/api/household/members/1", { role: "member" })).body.error).toMatch(/needs an owner/);
    expect((await t.api("PATCH", `/api/household/members/${sam.id}`, { role: "owner" })).body.role).toBe("owner");
    expect((await t.api("PATCH", "/api/household/members/1", { role: "member" })).body.role).toBe("member");
    const samToken = (await signIn("sam", "sam-password-1")).token;
    const r = (await as(samToken)("POST", "/api/recipes", { title: "Stays" })).body;
    expect((await as(samToken)("DELETE", `/api/household/members/${sam.id}`)).body.error).toBe("You can't remove yourself");
    expect((await as(samToken)("DELETE", "/api/household/members/1")).status).toBe(204);
    // and the other way round
    expect((await t.api("GET", "/api/auth/me")).status).toBe(401);
    expect((await as(samToken)("GET", `/api/recipes/${r.id}`)).body.title).toBe("Stays");
  });

  it("the owner can set a new password for a member, which signs them out", async () => {
    const sam = (await t.api("POST", "/api/household/members", { username: "sam", password: "sam-password-1" })).body;
    const old = (await signIn("sam", "sam-password-1")).token;
    await t.api("PATCH", `/api/household/members/${sam.id}`, { password: "new-password-22" });
    expect((await as(old)("GET", "/api/auth/me")).status).toBe(401);
    expect((await signIn("sam", "new-password-22")).user.username).toBe("sam");
  });

  it("API keys never reach the household", async () => {
    const key = (await t.api("POST", "/api/keys", { name: "k", access: "admin" })).body.key;
    t.setToken("");
    expect((await t.api("GET", "/api/household/members", undefined, { "x-api-key": key })).status).toBe(403);
  });
});
