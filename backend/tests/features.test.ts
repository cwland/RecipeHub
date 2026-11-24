import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const features = async () => (await t.api("GET", "/api/settings/features")).body;
const turn = (changes: object) => t.api("PUT", "/api/settings/features", changes);

describe("feature switches", () => {
  it("AI Enhance follows AI: on once AI is set up, and can be switched off", async () => {
    expect((await features()).aiEnhance).toBe(false);
    await t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
    expect((await features()).aiEnhance).toBe(true);
    expect((await turn({ aiEnhance: false })).body.aiEnhance).toBe(false);
    expect((await features()).aiEnhance).toBe(false);
  });

  it("Auto nutrition follows AI: on once AI is set up, and can be switched off", async () => {
    expect((await features()).autoNutrition).toBe(false);
    await t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
    expect((await features()).autoNutrition).toBe(true);
    expect((await turn({ autoNutrition: false })).body.autoNutrition).toBe(false);
    expect((await features()).autoNutrition).toBe(false);
  });

  it("Recipe Versioning is on from the start, and can be switched off", async () => {
    expect((await features()).recipeVersions).toBe(true);
    expect((await turn({ recipeVersions: false })).body.recipeVersions).toBe(false);
    expect((await features()).recipeVersions).toBe(false);
    const log = (await t.api("GET", "/api/logs")).body[0];
    expect(log.event).toBe("Recipe versioning turned off");
  });

  it("start off when nothing is set up, and on for what is", async () => {
    expect(await features()).toEqual({ ai: false, apiKeys: false, aiEnhance: false, autoNutrition: false, recipeVersions: true, savedCopies: true, publicLinks: true, discoveryRefresh: true, recipeChat: false });
    await t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
    await t.api("POST", "/api/keys", { name: "n8n" });
    expect(await features()).toEqual({ ai: true, apiKeys: true, aiEnhance: true, autoNutrition: true, recipeVersions: true, savedCopies: true, publicLinks: true, discoveryRefresh: true, recipeChat: true });
  });

  it("only flipped switches are stored; the rest follow what's set up", async () => {
    await turn({ apiKeys: true });
    await t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
    expect(await features()).toEqual({ ai: true, apiKeys: true, aiEnhance: true, autoNutrition: true, recipeVersions: true, savedCopies: true, publicLinks: true, discoveryRefresh: true, recipeChat: true });
    expect((await turn({ ai: false })).body).toEqual({ ai: false, apiKeys: true, aiEnhance: true, autoNutrition: true, recipeVersions: true, savedCopies: true, publicLinks: true, discoveryRefresh: true, recipeChat: true });
    expect((await t.api("PUT", "/api/settings/features", { nope: true })).status).toBe(400);
  });

  it("signed in only, never with an API key", async () => {
    const key = (await t.api("POST", "/api/keys", { name: "n8n", access: "admin" })).body.key;
    t.setToken("");
    expect((await t.api("GET", "/api/settings/features", undefined, { "x-api-key": key })).status).toBe(403);
    expect((await t.api("PUT", "/api/settings/features", { apiKeys: true }, { "x-api-key": key })).status).toBe(403);
  });

  it("API keys off: every key is refused and logged; keys are kept", async () => {
    const key = (await t.api("POST", "/api/keys", { name: "n8n", access: "read" })).body.key;
    const token = t.getToken();
    t.setToken("");
    expect((await t.api("GET", "/api/info", undefined, { "x-api-key": key })).status).toBe(200);
    t.setToken(token);
    await turn({ apiKeys: false });
    t.setToken("");
    const r = await t.api("GET", "/api/info", undefined, { "x-api-key": key });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/turned off/);
    t.setToken(token);
    expect((await t.api("GET", "/api/keys")).body).toHaveLength(1);
    const logs = (await t.api("GET", "/api/logs?category=api")).body;
    expect(logs.map((l: any) => l.event)).toEqual(["Refused GET /api/info: API keys are turned off", "API keys turned off"]);
    await turn({ apiKeys: true });
    t.setToken("");
    expect((await t.api("GET", "/api/info", undefined, { "x-api-key": key })).status).toBe(200);
  });

  it("AI off: hidden and not used, the services kept", async () => {
    await t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
    await turn({ ai: false });
    const s = (await t.api("GET", "/api/settings/ai")).body.settings;
    expect([s.available, s.ready, s.services.length]).toEqual([false, true, 1]);
    expect(await t.app.ai.active()).toBeNull();
    await turn({ ai: true });
    expect(await t.app.ai.active()).not.toBeNull();
  });
});
