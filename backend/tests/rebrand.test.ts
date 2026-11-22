import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { readArchive } from "../src/lib/backup.js";
import { setupTestApp, type TestApp } from "./helpers.js";

// The app was called Culury before it became RecipeHub. Backups and exports made under the old
// name still have to list, download and restore.

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  for (const f of fs.readdirSync(t.backupDir)) fs.unlinkSync(`${t.backupDir}/${f}`);
  await t.login();
});
afterAll(async () => t.close());

const upload = async (body: Buffer) => {
  const login = await t.api("POST", "/api/auth/login", { username: "alex", password: "password123" });
  return t.app.inject({ method: "POST", url: "/api/import?confirm=replace", payload: body, headers: { authorization: `Bearer ${login.body.token}`, "content-type": "application/octet-stream" } });
};

// A .tar.gz laid out the way Culury wrote them: culury.json (app "Culury") and photos/
async function oldStyleArchive(): Promise<Buffer> {
  const exported = (await t.api("GET", "/api/export")).body;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "old-backup-"));
  fs.writeFileSync(path.join(work, "culury.json"), JSON.stringify({ ...exported, app: "Culury" }));
  fs.mkdirSync(path.join(work, "photos"));
  const file = path.join(work, "out.tar.gz");
  await tar.c({ gzip: true, cwd: work, file, portable: true }, ["culury.json", "photos"]);
  return fs.readFileSync(file);
}

describe("RecipeHub backups", () => {
  it("are named recipehub-… and hold recipehub.json", async () => {
    const made = (await t.api("POST", "/api/backups")).body;
    expect(made.name).toMatch(/^recipehub-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz$/);
    const entries: string[] = [];
    await tar.t({ file: path.join(t.backupDir, made.name), onReadEntry: (e) => entries.push(e.path) });
    expect(entries).toContain("recipehub.json");
    const { data, cleanup } = await readArchive(fs.readFileSync(path.join(t.backupDir, made.name)));
    expect((data as { app: string }).app).toBe("RecipeHub");
    await cleanup();
  });
});

describe("backups made when the app was Culury", () => {
  it("still show in the list and download", async () => {
    fs.writeFileSync(path.join(t.backupDir, "culury-2026-11-01-120000.tar.gz"), await oldStyleArchive());
    const names = (await t.api("GET", "/api/backups")).body.backups.map((b: { name: string }) => b.name);
    expect(names).toContain("culury-2026-11-01-120000.tar.gz");
    const login = await t.api("POST", "/api/auth/login", { username: "alex", password: "password123" });
    const dl = await t.app.inject({ method: "GET", url: "/api/backups/culury-2026-11-01-120000.tar.gz", headers: { authorization: `Bearer ${login.body.token}` } });
    expect(dl.statusCode).toBe(200);
  });

  it("restore from a .tar.gz with culury.json inside", async () => {
    await t.api("POST", "/api/recipes", { title: "Old Chili", ingredients: [{ raw: "1 lb beef" }], steps: [{ text: "Cook it." }] });
    const archive = await oldStyleArchive();
    await t.api("POST", "/api/recipes", { title: "Made Later", ingredients: [{ raw: "1 egg" }], steps: [{ text: "Fry it." }] });
    const res = await upload(archive);
    expect(res.statusCode).toBe(200);
    const titles = (await t.api("GET", "/api/recipes")).body.recipes.map((r: { title: string }) => r.title);
    expect(titles).toEqual(["Old Chili"]);
  });

  it("restore from a Culury JSON export", async () => {
    const exported = (await t.api("GET", "/api/export")).body;
    const res = await t.api("POST", "/api/import?confirm=replace", { ...exported, app: "Culury" });
    expect(res.status).toBe(200);
  });

  it("other apps' files are still refused", async () => {
    const exported = (await t.api("GET", "/api/export")).body;
    const res = await t.api("POST", "/api/import?confirm=replace", { ...exported, app: "Zero Budget" });
    expect([res.status, res.body.error]).toEqual([400, "That file isn't a RecipeHub backup"]);
  });
});

// Culury reached 1.3.6; RecipeHub starts again at 1.0.0. A "What's new" dismissed at 1.3.6 would
// otherwise hide every RecipeHub release until 1.3.7, so the upgrade forgets the old version.
const url = process.env.TEST_DATABASE_URL ?? "postgresql://localhost:5432/recipehub_test";
const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

describe("upgrading from Culury", () => {
  const { db, pool } = createDb(url);
  afterAll(async () => pool.end());

  it("clears the What's new version each person dismissed under Culury", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-migrations-"));
    fs.cpSync(migrations, dir, { recursive: true });
    const journalPath = path.join(dir, "meta/_journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    journal.entries = journal.entries.slice(0, journal.entries.findIndex((e: { tag: string }) => e.tag === "0022_grocery_unique_names") + 1);
    fs.writeFileSync(journalPath, JSON.stringify(journal));

    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`create schema public`);
    await migrate(db, { migrationsFolder: dir });
    await db.execute(sql`insert into users (username, password_hash, seen_version) values ('sam', 'x', '1.3.6')`);

    await runMigrations(db);
    const rows = (await db.execute(sql`select seen_version from users where username = 'sam'`)).rows;
    expect(rows).toEqual([{ seen_version: null }]);
  });
});
