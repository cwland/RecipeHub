import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { logEvent } from "../src/lib/appLog.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
  await t.api("PATCH", "/api/profile", { email: "alex@example.com" });
});

const logs = async (q = "") => (await t.api("GET", `/api/logs${q}`)).body as any[];

describe("logs", () => {
  it("emails: each one sent or failed, with its type and subject (never the message)", async () => {
    await t.api("POST", "/api/settings/email/test", {});
    t.failNext.value = "535 Authentication failed";
    await t.api("POST", "/api/settings/email/test", {});
    const rows = await logs("?category=email");
    expect(rows.map((r) => [r.level, r.event])).toEqual([
      ["error", 'Couldn\'t send "RecipeHub test email" to alex@example.com'],
      ["info", 'Sent "RecipeHub test email" to alex@example.com'],
    ]);
    expect(rows[0].detail).toMatch(/535 Authentication failed/);
    expect(JSON.stringify(await logs())).not.toMatch(/is working/);
  });

  it("API: refused API key requests and unknown keys", async () => {
    const key = (await t.api("POST", "/api/keys", { name: "n8n", access: "recipe_push" })).body.key;
    const token = t.getToken();
    t.setToken("");
    await t.api("GET", "/api/info", undefined, { "x-api-key": key });
    await t.api("GET", "/api/info", undefined, { "x-api-key": "cd_notarealkey" });
    t.setToken(token);
    expect((await logs("?category=api")).map((r) => [r.level, r.source, r.event])).toEqual([
      ["warning", expect.any(String), "Refused GET /api/info: unknown API key"],
      ["warning", 'API key "n8n"', "Refused GET /api/info: not allowed for this key"],
    ]);
  });

  it("filters by type and problems; All is everything, newest first", async () => {
    await logEvent(t.db, { category: "schedule", level: "info", source: "Daily backup", event: "Backup saved" });
    await logEvent(t.db, { category: "ai", level: "warning", source: "Home AI", event: "Home AI didn't answer, asking Cloud instead", detail: "timed out" });
    await logEvent(t.db, { category: "api", level: "error", source: "GET /api/x", event: "Server error" });
    expect((await logs()).map((r) => r.category)).toEqual(["api", "ai", "schedule"]);
    expect((await logs("?category=ai")).map((r) => r.source)).toEqual(["Home AI"]);
    expect((await logs("?problems=true")).map((r) => r.category)).toEqual(["api", "ai"]);
    expect((await t.api("GET", "/api/logs?category=nope")).status).toBe(400);
  });

  it("keeps 30 days, and only a signed-in user can read them", async () => {
    await t.db.execute(sql`insert into app_log (category, level, event, at) values
      ('schedule', 'info', 'old', ${new Date(Date.now() - 31 * 24 * 3600 * 1000)}), ('schedule', 'info', 'recent', ${new Date(Date.now() - 29 * 24 * 3600 * 1000)})`);
    expect((await logs()).map((r) => r.event)).toEqual(["recent"]);
    const key = (await t.api("POST", "/api/keys", { name: "x", access: "read" })).body.key;
    t.setToken("");
    expect((await t.api("GET", "/api/logs", undefined, { "x-api-key": key })).status).toBe(403);
  });
});
