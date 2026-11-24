import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { buildSystemPrompt, historyForAi, splitMarker, type ChatMsg } from "../src/lib/recipeChat.js";

// ---------- the pieces ----------

const chili = {
  title: "Weeknight Chili",
  servings: 4,
  ingredients: [{ raw: "1 lb ground beef" }, { raw: "1 cup sour cream" }],
  steps: [{ text: "Brown the beef." }, { text: "Simmer 30 minutes." }],
  nutrition: null,
};
const msg = (id: number, role: "user" | "assistant", content = `m${id}`): ChatMsg => ({ id, role, content, canSave: false, timestamp: new Date(2026, 0, 1, 0, id).toISOString() });

describe("splitMarker", () => {
  it("takes off a [[CHANGES]] line at the end and says the reply can be saved", () => {
    expect(splitMarker("- Use olive oil instead of butter.\n\n[[CHANGES]]")).toEqual({ content: "- Use olive oil instead of butter.", canSave: true });
  });
  it("leaves a reply without it alone", () => {
    expect(splitMarker("Brown it well first.")).toEqual({ content: "Brown it well first.", canSave: false });
  });
});

describe("historyForAi", () => {
  it("sends only the last 12 messages", () => {
    const msgs = Array.from({ length: 20 }, (_, i) => msg(i + 1, i % 2 ? "assistant" : "user"));
    const h = historyForAi(msgs);
    expect(h).toHaveLength(12);
    expect(h[11].content).toBe("m20");
  });
  it("skips a question that never got an answer, but keeps the one being retried", () => {
    const msgs = [msg(1, "user"), msg(2, "assistant"), msg(3, "user"), msg(4, "user")];
    expect(historyForAi(msgs).map((m) => m.content)).toEqual(["m1", "m2"]);
    expect(historyForAi(msgs, 4).map((m) => m.content)).toEqual(["m1", "m2", "m4"]);
  });
});

describe("buildSystemPrompt", () => {
  const p = buildSystemPrompt(chili, { factor: 2, units: "metric" }, "We're dairy-free.");
  it("starts with the culinary assistant rules", () => {
    expect(p).toContain("You are a culinary assistant helping a cook modify and troubleshoot a specific recipe.");
    expect(p).toContain("politely decline and redirect them back to the recipe");
  });
  it("wraps the recipe and the household notes as data, not instructions", () => {
    const recipe = p.slice(p.indexOf("<<<RECIPE"), p.indexOf("RECIPE>>>"));
    expect(recipe).toContain("1 lb ground beef");
    expect(recipe).toContain("Simmer 30 minutes.");
    expect(p).toMatch(/<<<HOUSEHOLD[\s\S]*We're dairy-free\.[\s\S]*HOUSEHOLD>>>/);
    expect(p).toMatch(/not instructions/i);
  });
  it("says how the cook is viewing it", () => {
    expect(p).toContain("×2");
    expect(p).toContain("8 servings");
    expect(p).toMatch(/metric/i);
  });
  it("asks for the [[CHANGES]] line when changes are suggested", () => {
    expect(p).toContain("[[CHANGES]]");
  });
});

// ---------- the API ----------

let t: TestApp;
beforeAll(async () => (t = await setupTestApp({ aiTimeScale: 0.01 })));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const as = (token: string) => (method: string, url: string, body?: object) => t.api(method, url, body, { authorization: `Bearer ${token}` });
const text = (content: string) => ({ status: 200, json: { choices: [{ message: { content } }] } });
const setUpAi = (services = [{ name: "Home AI", provider: "local", baseUrl: "http://10.0.0.5:11434/v1", model: "qwen" }]) => t.api("PUT", "/api/settings/ai", { enabled: true, maxPerRun: 50, timeoutSec: 5, services });
const newRecipe = async () => (await t.api("POST", "/api/recipes", { title: "Weeknight Chili", servings: 4, ingredients: ["1 lb ground beef", "1 cup sour cream"], steps: ["Brown the beef.", "Simmer 30 minutes."] })).body.id as number;
const view = { factor: 1, units: "original" };

describe("chatting about a recipe", () => {
  it("answers, keeps both messages, and flags a reply that suggests changes", async () => {
    await setUpAi();
    const id = await newRecipe();
    t.ai.respond = () => text("- Use Greek yogurt instead of sour cream.\n[[CHANGES]]");
    const r = await t.api("POST", `/api/recipes/${id}/chat`, { message: "Make it lighter", view });
    expect(r.status).toBe(200);
    expect(r.body.userMessage).toMatchObject({ role: "user", content: "Make it lighter" });
    expect(r.body.reply).toMatchObject({ role: "assistant", content: "- Use Greek yogurt instead of sour cream.", canSave: true });
    const sent = t.ai.calls[0].body;
    expect(JSON.stringify(sent)).toContain("1 lb ground beef");
    expect(JSON.stringify(sent)).toContain("Make it lighter");
    expect((await t.api("GET", `/api/recipes/${id}/chat`)).body.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
  });

  it("keeps each person's chat to themselves", async () => {
    await setUpAi();
    const id = await newRecipe();
    t.ai.respond = () => text("Sure.");
    await t.api("POST", `/api/recipes/${id}/chat`, { message: "Hi", view });
    await t.api("POST", "/api/household/members", { username: "sam", password: "sam-password-1" });
    const sam = (await t.api("POST", "/api/auth/login", { username: "sam", password: "sam-password-1" })).body.token;
    expect((await as(sam)("GET", `/api/recipes/${id}/chat`)).body.messages).toEqual([]);
  });

  it("refuses long messages and API keys", async () => {
    await setUpAi();
    const id = await newRecipe();
    expect((await t.api("POST", `/api/recipes/${id}/chat`, { message: "x".repeat(2001), view })).status).toBe(400);
    const key = (await t.api("POST", "/api/keys", { name: "x" })).body.key;
    expect((await t.api("GET", `/api/recipes/${id}/chat`, undefined, { "x-api-key": key, authorization: "" })).status).toBe(403);
  });

  it("isn't there when recipe chat is off, or for a recipe that doesn't exist", async () => {
    await setUpAi();
    const id = await newRecipe();
    expect((await t.api("GET", "/api/recipes/9999/chat")).status).toBe(404);
    await t.api("PUT", "/api/settings/features", { recipeChat: false });
    expect((await t.api("GET", `/api/recipes/${id}/chat`)).status).toBe(404);
  });

  it("says plainly when the AI took too long, keeps the question, and Try again doesn't repeat it", async () => {
    await setUpAi();
    const id = await newRecipe();
    t.ai.respond = () => new Promise(() => {}); // hangs
    const r = await t.api("POST", `/api/recipes/${id}/chat`, { message: "Out of beef?", view });
    expect(r.status).toBe(504);
    expect(r.body.kind).toBe("timeout");
    const kept = (await t.api("GET", `/api/recipes/${id}/chat`)).body.messages;
    expect(kept).toHaveLength(1);
    t.ai.respond = () => text("Use ground turkey.");
    const again = await t.api("POST", `/api/recipes/${id}/chat`, { retryOf: kept[0].id, view });
    expect(again.status).toBe(200);
    expect((await t.api("GET", `/api/recipes/${id}/chat`)).body.messages.map((m: any) => m.content)).toEqual(["Out of beef?", "Use ground turkey."]);
  });

  it("calls an empty answer garbled", async () => {
    await setUpAi();
    const id = await newRecipe();
    t.ai.respond = () => text("   ");
    const r = await t.api("POST", `/api/recipes/${id}/chat`, { message: "Hi", view });
    expect(r.status).toBe(502);
    expect(r.body.kind).toBe("garbled");
  });

  it("clears the chat", async () => {
    await setUpAi();
    const id = await newRecipe();
    t.ai.respond = () => text("Sure.");
    await t.api("POST", `/api/recipes/${id}/chat`, { message: "Hi", view });
    expect((await t.api("DELETE", `/api/recipes/${id}/chat`)).status).toBe(204);
    expect((await t.api("GET", `/api/recipes/${id}/chat`)).body.messages).toEqual([]);
  });

  it("asks the chosen AI first, and goes back to the usual order if it's gone", async () => {
    await setUpAi([
      { name: "Home AI", provider: "local", baseUrl: "http://10.0.0.5:11434/v1", model: "qwen" },
      { name: "Backup", provider: "local", baseUrl: "http://10.0.0.6:11434/v1", model: "llama" },
    ]);
    const id = await newRecipe();
    const services = (await t.api("GET", "/api/settings/ai/recipe-chat")).body.services;
    await t.api("PUT", "/api/settings/ai/recipe-chat", { serviceId: services[1].id });
    t.ai.respond = () => text("Sure.");
    await t.api("POST", `/api/recipes/${id}/chat`, { message: "Hi", view });
    expect(t.ai.calls[0].url).toContain("10.0.0.6");
    // the chosen one is removed: the usual order again
    await setUpAi([{ name: "Home AI", provider: "local", baseUrl: "http://10.0.0.5:11434/v1", model: "qwen" }]);
    t.ai.calls.length = 0;
    expect((await t.api("POST", `/api/recipes/${id}/chat`, { message: "Again", view })).status).toBe(200);
    expect(t.ai.calls[0].url).toContain("10.0.0.5");
  });
});
