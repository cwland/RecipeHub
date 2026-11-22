import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import type { Db } from "../db/index.js";
import { buildExport } from "./dataExport.js";
import { logEvent } from "./appLog.js";
import type { BackupSecrets } from "./settingsBackup.js";
import { PHOTO_NAME } from "./photos.js";

// recipehub-2026-10-27-143005.tar.gz (the data as recipehub.json, plus photos/), or with a label:
// recipehub-2026-10-27-143005-before-restore.tar.gz. Backups from before the rename start
// culury- and hold culury.json; they still list, download and restore.
export const BACKUP_NAME = /^(recipehub|culury)-\d{4}-\d{2}-\d{2}-\d{6}(-[a-z-]+)?\.(json|tar\.gz)$/;
export const DATA_FILE = "recipehub.json";
const OLD_DATA_FILE = "culury.json";

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

// The data and every recipe photo, as a .tar.gz at `file`
export async function writeArchive(db: Db, file: string, secrets: BackupSecrets, photoDir: string) {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "recipehub-backup-"));
  try {
    await fs.writeFile(path.join(work, DATA_FILE), JSON.stringify(await buildExport(db, secrets), null, 2));
    const photos = (await fs.readdir(photoDir).catch(() => [] as string[])).filter((n) => PHOTO_NAME.test(n));
    await fs.mkdir(path.join(work, "photos"));
    // hard links where the disk allows (instant, no extra space), copies where it doesn't
    for (const n of photos) await fs.link(path.join(photoDir, n), path.join(work, "photos", n)).catch(() => fs.copyFile(path.join(photoDir, n), path.join(work, "photos", n)));
    await tar.c({ gzip: true, cwd: work, file, portable: true }, [DATA_FILE, "photos"]);
    return { photos: photos.length };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

export async function writeBackup(db: Db, dir: string, secrets: BackupSecrets, photoDir: string, label?: string) {
  await fs.mkdir(dir, { recursive: true });
  const name = `recipehub-${stamp(new Date())}${label ? `-${label}` : ""}.tar.gz`;
  const tmp = path.join(dir, `.${name}.tmp`);
  const { photos } = await writeArchive(db, tmp, secrets, photoDir);
  await fs.rename(tmp, path.join(dir, name)); // never leave a half-written backup
  const { size } = await fs.stat(path.join(dir, name));
  return { name, size, photos };
}

// A backup or export file -> its data, and (for .tar.gz) a folder with its photos to copy in.
// Only recipehub.json (or culury.json) and photos/<random name>.webp are taken out of an archive; anything else is ignored.
export async function readArchive(buf: Buffer): Promise<{ data: unknown; photosDir: string | null; cleanup: () => Promise<void> }> {
  if (buf[0] === 0x7b /* { */) return { data: JSON.parse(buf.toString("utf8")), photosDir: null, cleanup: async () => {} };
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) throw new Error("not a backup file");
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "recipehub-restore-"));
  const cleanup = () => fs.rm(work, { recursive: true, force: true });
  try {
    const file = path.join(work, "in.tar.gz");
    await fs.writeFile(file, buf);
    await fs.mkdir(path.join(work, "out"));
    await tar.x({
      file,
      cwd: path.join(work, "out"),
      strict: true,
      filter: (p, entry) => ("type" in entry ? entry.type === "File" || entry.type === "Directory" : true) && (p === DATA_FILE || p === OLD_DATA_FILE || p === "photos" || p === "photos/" || /^photos\/[^/]+$/.test(p) && PHOTO_NAME.test(p.slice(7))),
    });
    const out = path.join(work, "out");
    const dataFile = (await fs.stat(path.join(out, DATA_FILE)).catch(() => null)) ? DATA_FILE : OLD_DATA_FILE;
    const data = JSON.parse(await fs.readFile(path.join(out, dataFile), "utf8"));
    return { data, photosDir: path.join(work, "out", "photos"), cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

// Put a backup's photos into the photo folder (ones already there are kept)
export async function restorePhotos(from: string | null, photoDir: string) {
  if (!from) return 0;
  const names = (await fs.readdir(from).catch(() => [] as string[])).filter((n) => PHOTO_NAME.test(n));
  await fs.mkdir(photoDir, { recursive: true });
  for (const n of names) await fs.copyFile(path.join(from, n), path.join(photoDir, n));
  return names.length;
}

// "2026-10-27-143005" from a backup's name
const stampOf = (name: string) => name.match(/\d{4}-\d{2}-\d{2}-\d{6}/)?.[0] ?? "";

export async function listBackups(dir: string) {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const files = await Promise.all(
    names
      .filter((n) => BACKUP_NAME.test(n))
      .map(async (name) => {
        const st = await fs.stat(path.join(dir, name));
        return { name, size: st.size, createdAt: st.mtime.toISOString() };
      })
  );
  // Newest first, by the date and time in the name
  return files.sort((a, b) => stampOf(b.name).localeCompare(stampOf(a.name)) || b.name.localeCompare(a.name));
}

// Keep the newest `keep` backups, delete older ones
export async function pruneBackups(dir: string, keep: number) {
  const files = await listBackups(dir);
  const old = files.slice(keep);
  await Promise.all(old.map((f) => fs.unlink(path.join(dir, f.name))));
  return old.map((f) => f.name);
}

// Daily automatic backup: checks every hour, backs up if the newest backup is a day old
export function startBackupSchedule(
  db: Db,
  dir: string,
  keep: number,
  log: { info: (msg: string) => void; error: (err: unknown) => void },
  secrets: BackupSecrets,
  photoDir: string
) {
  const DAY = 24 * 60 * 60 * 1000;
  const check = async () => {
    try {
      const [newest] = await listBackups(dir);
      if (newest && Date.now() - new Date(newest.createdAt).getTime() < DAY) return;
      const { name } = await writeBackup(db, dir, secrets, photoDir);
      const removed = await pruneBackups(dir, keep);
      log.info(`Backup written: ${name}${removed.length ? ` (removed ${removed.length} old)` : ""}`);
      await logEvent(db, { category: "schedule", level: "info", source: "Daily backup", event: "Backup saved", detail: `${name}${removed.length ? ` (removed ${removed.length} old)` : ""}` });
    } catch (err) {
      log.error(err);
      await logEvent(db, { category: "schedule", level: "error", source: "Daily backup", event: "Backup failed", detail: (err as Error).message });
    }
  };
  void check();
  const timer = setInterval(check, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
