import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login(); // the owner
});

const as = (token: string) => (method: string, url: string, body?: object) => t.api(method, url, body, { authorization: `Bearer ${token}` });
const twoServices = () =>
  t.api("PUT", "/api/settings/ai", {
    enabled: true,
    maxPerRun: 50,
    services: [
      { name: "Home AI", provider: "local", baseUrl: "http://10.0.0.5:11434/v1", model: "qwen" },
      { name: "Claude", provider: "anthropic", model: "claude-sonnet", apiKey: "sk-test" },
    ],
  });

describe("recipe chat switch", () => {
  it("is off without AI, comes on with AI, and can be switched off", async () => {
    expect((await t.api("GET", "/api/ai/status")).body.recipeChat).toBe(false);
    await twoServices();
    expect((await t.api("GET", "/api/ai/status")).body.recipeChat).toBe(true);
    expect((await t.api("GET", "/api/settings/features")).body.recipeChat).toBe(true);
    await t.api("PUT", "/api/settings/features", { recipeChat: false });
    expect((await t.api("GET", "/api/ai/status")).body.recipeChat).toBe(false);
  });
});

describe("recipe chat settings", () => {
  it("starts empty and lists the AI services to pick from", async () => {
    await twoServices();
    const r = await t.api("GET", "/api/settings/ai/recipe-chat");
    expect(r.status).toBe(200);
    expect(r.body.notes).toBe("");
    expect(r.body.serviceId).toBeNull();
    expect(r.body.services.map((s: any) => s.name)).toEqual(["Home AI", "Claude"]);
    expect(typeof r.body.services[0].id).toBe("string");
  });

  it("saves household notes and the chosen service", async () => {
    await twoServices();
    const claude = (await t.api("GET", "/api/settings/ai/recipe-chat")).body.services[1].id;
    const put = await t.api("PUT", "/api/settings/ai/recipe-chat", { notes: "We're dairy-free.", serviceId: claude });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ notes: "We're dairy-free.", serviceId: claude });
    expect((await t.api("GET", "/api/settings/ai/recipe-chat")).body).toMatchObject({ notes: "We're dairy-free.", serviceId: claude });
    // back to the usual order
    expect((await t.api("PUT", "/api/settings/ai/recipe-chat", { serviceId: null })).body.serviceId).toBeNull();
  });

  it("refuses notes over 1000 characters and a service that isn't set up", async () => {
    await twoServices();
    expect((await t.api("PUT", "/api/settings/ai/recipe-chat", { notes: "x".repeat(1001) })).status).toBe(400);
    expect((await t.api("PUT", "/api/settings/ai/recipe-chat", { serviceId: "nope" })).status).toBe(400);
  });

  it("is the owner's to change", async () => {
    await t.api("POST", "/api/household/members", { username: "sam", password: "sam-password-1" });
    const sam = (await t.api("POST", "/api/auth/login", { username: "sam", password: "sam-password-1" })).body.token;
    expect((await as(sam)("PUT", "/api/settings/ai/recipe-chat", { notes: "hi" })).status).toBe(403);
  });
});
