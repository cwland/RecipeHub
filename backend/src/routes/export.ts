import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import os from "node:os";
import { BACKUP_NAME, listBackups, pruneBackups, readArchive, restorePhotos, writeArchive, writeBackup } from "../lib/backup.js";
import { buildExport, importData, importSchema } from "../lib/dataExport.js";
import { checkBackupKey, type SettingsSection } from "../lib/settingsBackup.js";
import { HttpError, notFound } from "../lib/errors.js";
import { resetApp, wipeRecipes } from "../lib/wipe.js";
import { resetSessionTouches } from "../lib/sessions.js";
import { logEvent } from "../lib/appLog.js";

const today = () => new Date().toISOString().slice(0, 10);

function requireLogin(req: FastifyRequest) {
  if (req.auth?.method !== "token") throw new HttpError(403, "Log in to do this");
}

export default async function exportRoutes(app: FastifyInstance) {
  const { db } = app;
  // Backups with photos are sent as the .tar.gz file itself
  app.addContentTypeParser(["application/gzip", "application/x-gzip", "application/octet-stream"], { parseAs: "buffer", bodyLimit: 2 * 1024 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  // ---------- downloads ----------

  // The data as JSON; ?photos=true: a .tar.gz with every recipe photo too
  app.get("/api/export", async (req, reply) => {
    const { photos } = z.object({ photos: z.enum(["true", "false"]).optional() }).parse(req.query);
    if (photos === "true") {
      const file = path.join(os.tmpdir(), `recipehub-export-${Date.now()}-${Math.random().toString(36).slice(2)}.tar.gz`);
      await writeArchive(db, file, app.backupSecrets(), app.photos.dir);
      const data = await fs.readFile(file);
      await fs.rm(file, { force: true });
      return reply.type("application/gzip").header("Content-Disposition", `attachment; filename="recipehub-${today()}.tar.gz"`).send(data);
    }
    const data = await buildExport(db, app.backupSecrets());
    return reply.header("Content-Disposition", `attachment; filename="recipehub-${today()}.json"`).send(data);
  });

  // ---------- backups ----------

  app.get("/api/backups", async () => ({
    dir: app.backupDir,
    keep: app.backupKeep,
    // Saved keys and passwords go into backups (encrypted) only when BACKUP_KEY is set
    secretsIncluded: !!app.backupKey.key,
    backupKeyProblem: app.backupKey.problem,
    backups: await listBackups(app.backupDir),
  }));

  app.post("/api/backups", async (_req, reply) => {
    const created = await writeBackup(db, app.backupDir, app.backupSecrets(), app.photos.dir);
    await pruneBackups(app.backupDir, app.backupKeep);
    return reply.status(201).send(created);
  });

  app.get("/api/backups/:name", async (req, reply) => {
    const { name } = z.object({ name: z.string() }).parse(req.params);
    if (!BACKUP_NAME.test(name)) throw notFound("Backup"); // also blocks ../ paths
    try {
      const data = await fs.readFile(path.join(app.backupDir, name));
      return reply.type(name.endsWith(".json") ? "application/json" : "application/gzip").header("Content-Disposition", `attachment; filename="${name}"`).send(data);
    } catch {
      throw notFound("Backup");
    }
  });

  // ---------- restore ----------
  // Replaces all recipe data with an export/backup file. Must be logged in (not an API key)
  // and pass ?confirm=replace. A safety backup is written first.
  // Wipe all recipes (owner, signed in; never an API key). A backup is made first.
  app.post("/api/wipe/recipes", async (req) => {
    requireLogin(req);
    const { confirm } = z.object({ confirm: z.string().optional() }).parse(req.body ?? {});
    if (confirm !== "DELETE") throw new HttpError(400, "Type DELETE to wipe all recipes");
    const backup = await writeBackup(db, app.backupDir, app.backupSecrets(), app.photos.dir, "before-wipe");
    const { recipes } = await wipeRecipes(db, app.photos);
    await logEvent(db, { category: "import", level: "warning", source: "Settings", event: `All recipes wiped (${recipes} recipe${recipes === 1 ? "" : "s"})`, detail: `Backup made first: ${backup.name}` });
    app.events.emit({ topic: "recipes", by: null });
    return { recipes, backup: backup.name };
  });

  // Back to a fresh install: everything goes (a backup is made first; the backups stay)
  app.post("/api/wipe/all", async (req) => {
    requireLogin(req);
    const { confirm } = z.object({ confirm: z.string().optional() }).parse(req.body ?? {});
    if (confirm !== "RESET") throw new HttpError(400, "Type RESET to reset the entire app");
    const backup = await writeBackup(db, app.backupDir, app.backupSecrets(), app.photos.dir, "before-reset");
    await resetApp(db, app.photos);
    resetSessionTouches();
    await logEvent(db, { category: "import", level: "warning", source: "Settings", event: "The app was reset to a fresh install", detail: `Backup made first: ${backup.name}` });
    app.events.emit({ topic: "recipes", by: null });
    return { ok: true, backup: backup.name };
  });

  app.post("/api/import", { bodyLimit: 2 * 1024 * 1024 * 1024 }, async (req) => {
    requireLogin(req);
    const { confirm } = z.object({ confirm: z.string().optional() }).parse(req.query);
    if (confirm !== "replace") throw new HttpError(400, "Add ?confirm=replace to restore (this replaces all recipe data)");

    // JSON (an export, or an older backup), or a .tar.gz backup with photos
    let archive: Awaited<ReturnType<typeof readArchive>> | null = null;
    if (Buffer.isBuffer(req.body)) {
      try {
        archive = await readArchive(req.body);
      } catch {
        throw new HttpError(400, "That file isn't a RecipeHub backup");
      }
    }
    try {
    const parsed = importSchema.safeParse(archive ? archive.data : req.body);
    if (!parsed.success) throw new HttpError(400, "That file isn't a RecipeHub backup");

    // A backup from another server: its BACKUP_KEY can be given for this restore (X-Backup-Key
    // header, so it never lands in a URL or log). Checked before anything changes.
    const given = req.headers["x-backup-key"];
    const otherKey = typeof given === "string" && given.trim() ? given.trim() : null;
    if (otherKey) {
      if (parsed.data.settings?.secrets !== "encrypted") throw new HttpError(400, "This backup has no encrypted keys or passwords, so no backup key is needed. Leave the key blank.");
      const { total, readable } = checkBackupKey(parsed.data.settings as SettingsSection, otherKey);
      if (total && !readable) throw new HttpError(400, "That backup key doesn't match this file. Nothing was changed. Check the key and try again.");
    }
    const secrets = otherKey ? { ...app.backupSecrets(), backupKey: otherKey } : app.backupSecrets();

    const safety = await writeBackup(db, app.backupDir, app.backupSecrets(), app.photos.dir, "before-restore");
    let counts;
    try {
      counts = await importData(db, parsed.data, secrets);
    } catch (err) {
      req.log.error(err);
      throw new HttpError(400, `Couldn't restore that file, nothing was changed (${(err as Error).message.split("\n")[0]})`);
    }
    const photos = await restorePhotos(archive?.photosDir ?? null, app.photos.dir);
    return { ok: true, safetyBackup: safety.name, photos, ...counts };
    } finally {
      await archive?.cleanup();
    }
  });
}
