import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());

const HOME = "http://10.0.0.5:11434/v1";
// Which servers are down / hanging, and what each one says per merchant
let down: Set<string>;
let hang: Set<string>;
const serverOf = (url: string) => (url.startsWith(HOME) ? "home" : "cloud");

function reply(url: string) {
  const who = serverOf(url);
  if (hang.has(who)) return new Promise<never>(() => {});
  if (down.has(who)) return { status: 503, json: { error: { message: "loading model" } } };
  return { status: 200, json: { choices: [{ message: { content: `${who} says hi` } }] } };
}

const settings = (extra: object = {}) => ({
  enabled: true,
  mode: "manual",
  maxPerRun: 50,
  timeoutSec: 3,
  services: [
    { name: "Home AI", provider: "local", baseUrl: HOME, model: "qwen" },
    { name: "Cloud backup", provider: "openrouter", apiKey: "or-key", model: "small" },
  ],
  ...extra,
});
// Ask through the failover chain, as recipe import and the other AI tasks will
const ask = async () => {
  const active = await t.app.ai.active();
  if (!active) throw new Error("AI isn't ready");
  return t.app.ai.chatWithFailover(active.services, "system", "hello", 100, active.timeoutSec * 1000);
};

beforeEach(async () => {
  await t.reset();
  await t.login();
  down = new Set();
  hang = new Set();
  t.ai.respond = reply as any;
});

describe("backup AI services", () => {
  it("saves a list in order, with each key kept and shown", async () => {
    const r = (await t.api("PUT", "/api/settings/ai", settings())).body.settings;
    expect(r.services.map((s: any) => [s.name, s.provider, s.apiKey])).toEqual([
      ["Home AI", "local", null],
      ["Cloud backup", "openrouter", "or-key"],
    ]);
    // Reorder (drag): send them the other way round; the key stays with its service
    const [home, cloud] = r.services;
    const again = (await t.api("PUT", "/api/settings/ai", { ...settings(), services: [{ ...cloud, apiKey: undefined }, home] })).body.settings;
    expect(again.services.map((s: any) => [s.name, s.apiKey])).toEqual([
      ["Cloud backup", "or-key"],
      ["Home AI", null],
    ]);
    // Every service needs a model (there's no per-service switch: all saved services are used)
    const bad = await t.api("PUT", "/api/settings/ai", { ...settings(), services: [{ name: "X", provider: "openai", model: "" }] });
    expect(bad.body.details[0].message).toBe("Choose a model");
    expect((await t.api("PUT", "/api/settings/ai", { ...settings(), enabled: false, services: [{ name: "X", provider: "openai", model: "" }] })).status).toBe(400);
  });

  it("uses the first service, and the next when the first is down", async () => {
    await t.api("PUT", "/api/settings/ai", settings());
    let r = await ask();
    expect([r.text, r.service.name, r.failures]).toEqual(["home says hi", "Home AI", []]);

    down.add("home");
    r = await ask();
    expect([r.text, r.service.name]).toEqual(["cloud says hi", "Cloud backup"]);
    expect(r.failures[0]).toMatch(/^Home AI: The AI service returned 503/);
    // ...and it's in Settings > Logs
    expect((await t.api("GET", "/api/logs?category=ai")).body[0]).toMatchObject({ level: "warning", source: "Home AI", event: "Home AI didn't answer, asking Cloud backup instead", detail: expect.stringMatching(/503/) });
  });

  it("moves on when a service hangs past the timeout", async () => {
    await t.api("PUT", "/api/settings/ai", settings());
    hang.add("home");
    const r = await ask();
    expect(r.service.name).toBe("Cloud backup");
    expect(r.failures[0]).toBe("Home AI: The AI service didn't answer within 3 seconds.");
  }, 10000);

  it("all down: says so", async () => {
    await t.api("PUT", "/api/settings/ai", settings());
    down.add("home").add("cloud");
    await expect(ask()).rejects.toThrow(/^None of your AI services answered\. Home AI: .* Cloud backup: /);
  });

  it("AI switched off in Settings: nothing is used", async () => {
    await t.api("PUT", "/api/settings/ai", settings());
    expect(await t.app.ai.active()).not.toBeNull();
    await t.api("PUT", "/api/settings/features", { ai: false });
    expect(await t.app.ai.active()).toBeNull();
  });

  it("services saved with their own switch off are all used now", async () => {
    await t.db.execute(sql`insert into app_settings (key, value) values ('ai', ${JSON.stringify({ enabled: true, mode: "manual", maxPerRun: 50, services: [{ id: "s0", name: "S0", enabled: false, provider: "local", model: "qwen", baseUrl: HOME, apiKeyEnc: null }] })}::jsonb)`);
    const s = (await t.api("GET", "/api/settings/ai")).body.settings;
    expect(s).toMatchObject({ ready: true });
    expect(s.services[0].enabled).toBe(true);
  });

  it("settings saved the old way become the first service", async () => {
    await t.api("PUT", "/api/settings/ai", { enabled: true, provider: "local", baseUrl: HOME, model: "qwen", mode: "manual", maxPerRun: 50 });
    const s = (await t.api("GET", "/api/settings/ai")).body.settings;
    expect(s.services).toHaveLength(1);
    expect(s.services[0]).toMatchObject({ name: "Home AI", provider: "local", model: "qwen" });
    expect(s).toMatchObject({ timeoutSec: 15, askNextOnNoMatch: false });
  });
});

describe("an answer that can't be read", () => {
  it("cut off (it ran out of room) or not JSON: the next service is asked, and the first one is logged", async () => {
    await t.api("PUT", "/api/settings/ai", settings());
    t.ai.respond = ((url: string) =>
      serverOf(url) === "home"
        ? { status: 200, json: { choices: [{ finish_reason: "length", message: { content: '```json\n{"ingredients": [{"line": "6 pork chops", "grams": 1190, "carbs":' } }] } }
        : { status: 200, json: { choices: [{ finish_reason: "stop", message: { content: '{"ok": true}' } }] } }) as any;
    const r = await t.app.ai.ask("quick", "system", "hello");
    expect(r).toMatchObject({ json: { ok: true }, service: { name: "Cloud backup" } });
    const [log] = (await t.app.db.execute(sql`select event, detail from app_log where category = 'ai' order by id`)).rows as { event: string; detail: string }[];
    expect(log.event).toBe("Home AI's answer couldn't be read");
    expect(log.detail).toMatch(/Stopped: length/);
  });

  it("every service's answer unreadable: says so", async () => {
    await t.api("PUT", "/api/settings/ai", settings());
    t.ai.respond = (() => ({ status: 200, json: { choices: [{ finish_reason: "length", message: { content: '{"ingredients": [' } }] } })) as any;
    await expect(t.app.ai.ask("quick", "system", "hello")).rejects.toThrow(/Cloud backup's answer couldn't be read/);
  });
});
