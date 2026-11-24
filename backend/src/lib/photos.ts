import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { fetchUrl, FetchError, type FetchOptions } from "./fetchPage.js";
import { HttpError } from "./errors.js";

// Recipe photos live in <data>/photos as WebP, at most 1600 px on the long side, with random
// names. They're served at /api/photos/<name> without signing in (an <img> can't send a login), and
// the names can't be guessed.

export const PHOTO_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
export const photoUrl = (name: string) => `/api/photos/${name}`;
export const photoNameOf = (url: string | null | undefined) => {
  const name = url?.match(/^\/api\/photos\/([^/?#]+)$/)?.[1];
  return name && PHOTO_NAME.test(name) ? name : null;
};

export class Photos {
  constructor(public dir: string) {}

  // Any common image (JPEG, PNG, WebP, GIF, AVIF...) -> a saved photo; returns its address
  async save(input: Buffer): Promise<string> {
    let out: Buffer;
    try {
      out = await sharp(input, { failOn: "none" }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch {
      throw new HttpError(400, "That file isn't a photo RecipeHub can read (try a JPEG or PNG)");
    }
    await fs.mkdir(this.dir, { recursive: true });
    const name = `${randomUUID()}.webp`;
    await fs.writeFile(path.join(this.dir, name), out);
    return photoUrl(name);
  }

  // A photo from the web (an imported recipe's picture)
  async download(url: string, opts: FetchOptions = {}): Promise<string> {
    const { body, contentType } = await fetchUrl(url, { ...opts, maxBytes: 15 * 1024 * 1024, accept: "image/*,*/*;q=0.5" });
    if (contentType && !/^image\//i.test(contentType) && !/octet-stream/i.test(contentType)) throw new FetchError(`That address isn't a picture (${contentType.split(";")[0]})`);
    return this.save(body);
  }

  // A recipe's photo for another recipe: an uploaded one gets its own copy (deleting either recipe
  // deletes its file), a picture from the web keeps its address
  async copy(url: string | null | undefined): Promise<string | null> {
    if (!url) return null;
    const name = photoNameOf(url);
    if (!name) return url;
    const copy = `${randomUUID()}.webp`;
    try {
      await fs.copyFile(path.join(this.dir, name), path.join(this.dir, copy));
    } catch {
      return null; // the file is gone: no photo
    }
    return photoUrl(copy);
  }

  async remove(url: string | null | undefined) {
    const name = photoNameOf(url);
    if (name) await fs.unlink(path.join(this.dir, name)).catch(() => {});
  }

  // Photos sent to be read by AI (recipe cards): kept as JPEG until the import is done
  private incoming() {
    return path.join(this.dir, "incoming");
  }
  async saveIncoming(input: Buffer): Promise<string> {
    let out: Buffer;
    try {
      out = await sharp(input, { failOn: "none" }).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    } catch {
      throw new HttpError(400, "That file isn't a photo RecipeHub can read (try a JPEG or PNG)");
    }
    await fs.mkdir(this.incoming(), { recursive: true });
    const name = `${randomUUID()}.jpg`;
    await fs.writeFile(path.join(this.incoming(), name), out);
    return name;
  }
  // A recipe file from another app (Paprika, Mealie…), as it was uploaded
  async saveIncomingFile(input: Buffer): Promise<string> {
    await fs.mkdir(this.incoming(), { recursive: true });
    const name = `${randomUUID()}.bin`;
    await fs.writeFile(path.join(this.incoming(), name), input);
    return name;
  }

  async readIncoming(name: string): Promise<Buffer> {
    if (!/^[0-9a-f-]{36}\.(jpg|bin)$/.test(name)) throw new Error("Bad file name");
    return fs.readFile(path.join(this.incoming(), name)).catch(() => {
      throw new Error("The photo is no longer here (photos waiting to be read are kept for 2 days). Add it again.");
    });
  }
  async removeIncoming(names: string[]) {
    for (const n of names) if (/^[0-9a-f-]{36}\.(jpg|bin)$/.test(n)) await fs.unlink(path.join(this.incoming(), n)).catch(() => {});
  }

  path(name: string) {
    return PHOTO_NAME.test(name) ? path.join(this.dir, name) : null;
  }

  // Photos no recipe uses any more (uploaded but never saved, or replaced), a day old or more
  async sweep(db: Db) {
    for (const n of await fs.readdir(this.incoming()).catch(() => [] as string[])) {
      const st = await fs.stat(path.join(this.incoming(), n)).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 2 * 24 * 3600 * 1000) await fs.unlink(path.join(this.incoming(), n)).catch(() => {});
    }
    let names: string[];
    try {
      names = (await fs.readdir(this.dir)).filter((n) => PHOTO_NAME.test(n));
    } catch {
      return 0;
    }
    if (!names.length) return 0;
    const used = new Set((await db.execute(sql`select image_url from recipes where image_url like '/api/photos/%'`)).rows.map((r) => photoNameOf((r as { image_url: string }).image_url)));
    let removed = 0;
    for (const n of names) {
      if (used.has(n)) continue;
      const st = await fs.stat(path.join(this.dir, n)).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 24 * 3600 * 1000) {
        await fs.unlink(path.join(this.dir, n)).catch(() => {});
        removed++;
      }
    }
    return removed;
  }
}
