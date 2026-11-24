import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { buildApp } from "../src/app.js";
import { resetLoginLockouts } from "../src/routes/auth.js";
import { resetPasskeyChallenges } from "../src/routes/passkeys.js";
import { resetOAuthFlows } from "../src/routes/oauth.js";
import { resetOAuthCache } from "../src/lib/oauth.js";
import { resetSessionTouches } from "../src/lib/sessions.js";
import type { EmailConfig, MailMessage } from "../src/lib/mail.js";
import type { UpdateFetch } from "../src/lib/updates.js";
import type { AiFetch } from "../src/lib/ai.js";
import type { RateLimitOptions } from "../src/lib/security.js";

// Tests use their own database so they never touch your real recipes.
// Create it once with: createdb recipehub_test
const url = process.env.TEST_DATABASE_URL ?? "postgresql://localhost:5432/recipehub_test";
if (!url.includes("test")) throw new Error("TEST_DATABASE_URL must point at a test database");

export async function setupTestApp(opts: { email?: boolean; pages?: Record<string, { status?: number; type?: string; body: string | Buffer; location?: string }>; backupKey?: string; jwtSecret?: string; oauthFetch?: typeof fetch; githubToken?: string; rateLimit?: RateLimitOptions; aiTimeScale?: number } = {}) {
  const { db, pool } = createDb(url);
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-backups-"));
  const photoDir = fs.mkdtempSync(path.join(os.tmpdir(), "recipehub-photos-"));
  // Fake web for imports: pages[url] = { status, type, body, location }. Unknown addresses: 404.
  const web = { pages: { ...(opts.pages ?? {}) } as Record<string, { status?: number; type?: string; body: string | Buffer; location?: string }>, calls: [] as string[] };
  const importFetch = async (url: string) => {
    web.calls.push(url);
    const p = web.pages[url];
    if (!p) return new Response("not found", { status: 404 });
    const headers: Record<string, string> = { "content-type": p.type ?? "text/html; charset=utf-8" };
    if (p.location) headers.location = p.location;
    return new Response(typeof p.body === "string" ? p.body : new Uint8Array(p.body), { status: p.status ?? 200, headers });
  };
  // Fake mail transport: records messages (and the settings used) instead of sending
  const sent: (MailMessage & { from: string; config: EmailConfig })[] = [];
  const failNext = { value: "" };
  const emailEnv: EmailConfig | null =
    opts.email === false
      ? null
      : { host: "env.smtp", port: 25, security: "none", username: null, password: null, fromName: null, fromAddress: "app@test", appUrl: "http://recipes.test" };
  // Fake AI: records calls; answer with ai.respond(url, body, headers) -> { status, json }, or a
  // streamed reply: { status, sse: ["data: {...}", ...], gapMs?: pause between pieces, hang?: stop
  // sending after the pieces without closing }
  type Streamed = { status: number; sse: string[]; gapMs?: number; hang?: boolean };
  const ai = {
    calls: [] as { url: string; method: string; headers: Record<string, string>; body: any }[],
    // (may return a promise, e.g. one that never settles to act like a server that hangs)
    respond: (_url: string, _body: any, _headers: Record<string, string>): { status: number; json: unknown } | Streamed | Promise<{ status: number; json: unknown } | Streamed> => ({ status: 200, json: { choices: [{ message: { content: '{"ok": true}' } }] } }),
    down: false,
  };
  const aiFetch: AiFetch = async (url, init) => {
    if (ai.down) throw new Error("ECONNREFUSED");
    const body = init.body ? JSON.parse(init.body) : undefined;
    ai.calls.push({ url, method: init.method, headers: init.headers, body });
    const r = await ai.respond(url, body, init.headers);
    if ("sse" in r) {
      const enc = new TextEncoder();
      const pieces = r.sse;
      const stream = new ReadableStream<Uint8Array>({
        async start(c) {
          init.signal?.addEventListener("abort", () => c.error(new Error("aborted")));
          for (const p of pieces) {
            if (init.signal?.aborted) return;
            if (r.gapMs) await new Promise((res) => setTimeout(res, r.gapMs));
            if (init.signal?.aborted) return;
            c.enqueue(enc.encode(p + "\n\n"));
          }
          if (!r.hang) c.close();
        },
      });
      return { ok: r.status < 300, status: r.status, json: async () => ({}), body: stream };
    }
    return { ok: r.status < 300, status: r.status, json: async () => r.json };
  };
  // Fake GitHub releases: answer with github.respond(url, headers) -> { status, json }; down = unreachable
  const github = {
    calls: [] as { url: string; headers: Record<string, string> }[],
    down: false,
    token: null as string | null,
    respond: (_url: string, _headers: Record<string, string>): { status: number; json: unknown } => ({ status: 404, json: { message: "Not Found" } }),
  };
  const updateFetch: UpdateFetch = async (url, init) => {
    if (github.down) throw new Error("ECONNREFUSED");
    github.calls.push({ url, headers: init.headers });
    const r = github.respond(url, init.headers);
    return { status: r.status, json: async () => r.json };
  };
  // The app's clock ("today"); tests can set clock.date
  const clock = { date: null as Date | null };
  const app = buildApp({
    now: () => clock.date ?? new Date(),
    aiFetch,
    aiTimeScale: opts.aiTimeScale,
    updateFetch,
    updateRepo: "cwland/RecipeHub",
    githubToken: opts.githubToken ?? null,
    db,
    jwtSecret: opts.jwtSecret ?? "test-secret-that-is-long-enough",
    backupDir,
    backupKey: opts.backupKey ?? "",
    oauthFetch: opts.oauthFetch,
    backupKeep: 3,
    rateLimit: opts.rateLimit ?? false,
    photoDir,
    importFetch,
    importResolve: async () => ["93.184.216.34"],
    emailEnv,
    mailTransport: (config) => ({
      sendMail: async (m) => {
        if (failNext.value) {
          const msg = failNext.value;
          failNext.value = "";
          throw new Error(msg);
        }
        sent.push({ ...m, config });
      },
    }),
  });
  await app.ready();

  let token = "";

  const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({
      method: method as "GET",
      url: path,
      payload: body as object,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    });
    return { status: res.statusCode, body: res.body ? res.json() : undefined };
  };

  return {
    app,
    db,
    api,
    backupDir,
    photoDir,
    web,
    sent,
    failNext,
    ai,
    github,
    clock,
    async reset() {
      clock.date = null;
      web.pages = {};
      web.calls.length = 0;
      for (const f of fs.readdirSync(photoDir)) fs.rmSync(path.join(photoDir, f), { force: true, recursive: true });
      sent.length = 0;
      failNext.value = "";
      ai.calls.length = 0;
      ai.down = false;
      ai.respond = () => ({ status: 200, json: { choices: [{ message: { content: '{"ok": true}' } }] } });
      github.calls.length = 0;
      github.down = false;
      github.respond = () => ({ status: 404, json: { message: "Not Found" } });
      await db.execute(sql`truncate users, password_resets, app_settings, api_keys, sessions, login_events, app_log, passkeys, recipes, tags, categories, collections, substitutions, jobs, meal_plan, grocery_lists, pantry_items, aisle_choices, inbox_items, discovery_feeds, recipe_chat_messages restart identity cascade`);
      await db.execute(sql`insert into grocery_lists (name) values ('Groceries')`);
      await db.execute(sql`insert into categories (name, sort_order) values ('Breakfast', 0), ('Lunch', 1), ('Dinner', 2), ('Side', 3), ('Snack', 4), ('Dessert', 5), ('Drink', 6)`);
      resetSessionTouches();
      resetLoginLockouts();
      resetPasskeyChallenges();
      resetOAuthFlows();
      resetOAuthCache();
      token = "";
    },
    async login() {
      const res = await api("POST", "/api/auth/setup", { username: "alex", password: "password123", email: "alex@example.com" });
      token = res.body.token;
    },
    getToken: () => token,
    setToken(t: string) {
      token = t;
    },
    async close() {
      fs.rmSync(backupDir, { recursive: true, force: true });
      fs.rmSync(photoDir, { recursive: true, force: true });
      await app.close();
      await pool.end();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof setupTestApp>>;
