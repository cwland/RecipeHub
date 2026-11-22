import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { readArchive } from "../src/lib/backup.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { toCsv } from "../src/lib/dataExport.js";
import { sql } from "drizzle-orm";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  for (const f of fs.readdirSync(t.backupDir)) fs.unlinkSync(`${t.backupDir}/${f}`);
  await t.login();
});
afterAll(async () => t.close());

const raw = async (url: string) => {
  const login = await t.api("POST", "/api/auth/login", { username: "alex", password: "password123" });
  return t.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${login.body.token}` } });
};

describe("CSV", () => {
  it("quotes commas and defuses formulas", () => {
    expect(toCsv([["Name", "Note"], ["Salt, kosher", '=HYPERLINK("x")'], ["-1", 2]])).toBe('Name,Note\r\n"Salt, kosher","\'=HYPERLINK(""x"")"\r\n-1,2\r\n');
  });
});

describe("backups", () => {
  it("backs up now, lists, downloads, and prunes to the keep limit", async () => {
    const made = await t.api("POST", "/api/backups");
    expect(made.status).toBe(201);
    expect(made.body.name).toMatch(/^recipehub-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz$/);

    const list = await t.api("GET", "/api/backups");
    expect(list.body.backups).toHaveLength(1);
    expect(list.body.keep).toBe(3);

    const dl = await raw(`/api/backups/${made.body.name}`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toBe("application/gzip");
    const archive = await readArchive(dl.rawPayload);
    expect(archive.data).toMatchObject({ app: "RecipeHub", exportVersion: 1, data: {} });
    await archive.cleanup();

    // keep = 3: older files are removed
    for (let i = 0; i < 4; i++) fs.writeFileSync(`${t.backupDir}/recipehub-2020-01-0${i + 1}-000000.json`, "{}");
    await t.api("POST", "/api/backups");
    const after = (await t.api("GET", "/api/backups")).body.backups.map((b: { name: string }) => b.name);
    expect(after).toHaveLength(3);
    expect(after.some((n: string) => n.startsWith("recipehub-2020-01-01"))).toBe(false);
  });

  it("won't serve files outside the backup folder", async () => {
    expect((await raw("/api/backups/..%2F..%2Fpackage.json")).statusCode).toBe(404);
    expect((await raw("/api/backups/passwd")).statusCode).toBe(404);
  });
});

describe("restore", () => {
  it("round-trips settings and keeps the login", async () => {
    await t.api("PUT", "/api/settings/features", { apiKeys: true, ai: false });
    const exported = JSON.parse((await raw("/api/export")).body);
    await t.api("PUT", "/api/settings/features", { apiKeys: false });

    const res = await t.api("POST", "/api/import?confirm=replace", exported);
    expect(res.status).toBe(200);
    expect(res.body.safetyBackup).toMatch(/before-restore\.tar\.gz$/);
    expect((await t.api("GET", "/api/settings/features")).body).toEqual({ apiKeys: true, ai: false, aiEnhance: false, autoNutrition: false, recipeVersions: true, savedCopies: true, publicLinks: true, discoveryRefresh: true });
    expect((await t.api("GET", "/api/auth/me")).body.user.username).toBe("alex");
  });

  it("a backup brings back recipe photos too", async () => {
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#c33" } }).png().toBuffer();
    const imageUrl = await t.app.photos.save(png);
    await t.api("POST", "/api/recipes", { title: "Tomato Soup", ingredients: "2 lb tomatoes", imageUrl });
    const made = (await t.api("POST", "/api/backups")).body;
    expect(made.photos).toBe(1);
    const file = fs.readFileSync(path.join(t.backupDir, made.name));
    // lost: the recipe and its photo
    const id = (await t.api("GET", "/api/recipes")).body.recipes[0].id;
    await t.api("DELETE", `/api/recipes/${id}`);
    expect(fs.existsSync(path.join(t.app.photos.dir, imageUrl.split("/").pop()!))).toBe(false);
    const res = await t.app.inject({ method: "POST", url: "/api/import?confirm=replace", payload: file, headers: { authorization: `Bearer ${t.getToken()}`, "content-type": "application/gzip" } });
    expect(res.json()).toMatchObject({ ok: true, photos: 1 });
    const back = (await t.api("GET", "/api/recipes")).body.recipes[0];
    expect(back).toMatchObject({ title: "Tomato Soup", imageUrl });
    expect((await t.app.inject({ method: "GET", url: imageUrl })).statusCode).toBe(200);
    // the same as an export download
    const ex = await raw("/api/export?photos=true");
    expect(ex.headers["content-disposition"]).toMatch(/\.tar\.gz"$/);
    expect(((await readArchive(ex.rawPayload)).data as any).data.recipes).toHaveLength(1);
  });

  it("a backup keeps every version of a recipe", async () => {
    const id = (await t.api("POST", "/api/recipes", { title: "Chili", ingredients: "1 lb beef" })).body.id;
    await t.app.db.execute(sql`delete from recipe_versions where recipe_id = ${id}`);
    await t.app.db.execute(sql`insert into recipe_versions (recipe_id, number, source, summary, data, active) values (${id}, 1, 'created', 'Added', '{"title":"Chili"}', false), (${id}, 2, 'edit', 'Changed the title', '{"title":"Texas Chili"}', true)`);
    const exported = JSON.parse((await raw("/api/export")).body);
    expect(exported.data.recipeVersions).toHaveLength(2);
    await t.app.db.execute(sql`delete from recipe_versions`);
    expect((await t.api("POST", "/api/import?confirm=replace", exported)).status).toBe(200);
    const back = (await t.app.db.execute(sql`select number, summary, active from recipe_versions order by number`)).rows;
    expect(back).toEqual([
      { number: 1, summary: "Added", active: false },
      { number: 2, summary: "Changed the title", active: true },
    ]);
  });

  it("a backup keeps the inbox", async () => {
    await t.api("POST", "/api/inbox", { type: "RECIPE_LINK", url: "https://example.com/pork", title: "Pork Roast" });
    const exported = JSON.parse((await raw("/api/export")).body);
    expect(exported.data.inboxItems).toHaveLength(1);
    await t.app.db.execute(sql`delete from inbox_items`);
    expect((await t.api("POST", "/api/import?confirm=replace", exported)).status).toBe(200);
    expect((await t.api("GET", "/api/inbox")).body).toMatchObject([{ title: "Pork Roast", status: "PENDING" }]);
  });

  it("refuses an archive that isn't a backup", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/import?confirm=replace", payload: Buffer.from([0x1f, 0x8b, 1, 2, 3]), headers: { authorization: `Bearer ${t.getToken()}`, "content-type": "application/gzip" } });
    expect([res.statusCode, res.json().error]).toEqual([400, "That file isn't a RecipeHub backup"]);
  });

  it("requires confirm=replace and a RecipeHub file", async () => {
    const exported = JSON.parse((await raw("/api/export")).body);
    expect((await t.api("POST", "/api/import", exported)).status).toBe(400);
    const r = await t.api("POST", "/api/import?confirm=replace", { ...exported, app: "Some Other App" });
    expect([r.status, r.body.error]).toEqual([400, "That file isn't a RecipeHub backup"]);
  });

  it("API keys can't restore, even admin keys", async () => {
    const key = (await t.api("POST", "/api/keys", { name: "n8n", access: "admin" })).body.key;
    const exported = JSON.parse((await raw("/api/export")).body);
    t.setToken("");
    expect((await t.api("POST", "/api/import?confirm=replace", exported, { "x-api-key": key })).status).toBe(403);
  });
});
