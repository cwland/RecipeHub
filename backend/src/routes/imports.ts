import fs from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { jobs, recipes } from "../db/schema.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam } from "../lib/validation.js";
import { jobView } from "../lib/importJobs.js";
import { userOf } from "./recipes.js";
import { requireEnhance } from "../lib/enhance.js";
import { whoSent } from "../lib/inbox.js";

export default async function importRoutes(app: FastifyInstance) {
  const { db, jobs: queue, photos } = app;

  // Import a recipe from a link, or from pasted text. Runs in the background: the answer is the
  // job (check GET /api/imports/:id). "wait": up to that many seconds for it to finish first,
  // handy for iOS Shortcuts and scripts. "force": import even if this page is already saved.
  // html: the page itself, sent from your browser (Send to RecipeHub), read instead of fetching url
  app.post("/api/recipes/import", { bodyLimit: 9 * 1024 * 1024 }, async (req, reply) => {
    const body = z
      .object({
        url: z.string().trim().max(2000).optional(),
        text: z.string().trim().max(50000).optional(),
        html: z.string().max(8 * 1024 * 1024).optional(),
        force: z.boolean().optional(),
        wait: z.number().int().min(0).max(60).optional(),
        improve: z.boolean().optional(), // then improve it with AI in the background (the Companion's "AI correction")
        inbox: z.boolean().optional(), // leave a note of it in the inbox's Imported list (the Companion's Import)
      })
      .strict()
      .refine((b) => !!b.url !== !!b.text, "Send a link (url) or pasted text (text)")
      .refine((b) => !b.html || !!b.url, "A page sent from your browser needs its link (url) too")
      .parse(req.body);
    if (body.url && !/^https?:\/\/\S+$/i.test(body.url)) throw new HttpError(400, "That doesn't look like a web address (it should start with https://)");
    if (body.text && body.text.length < 20) throw new HttpError(400, "Paste the whole recipe (title, ingredients and steps)");
    if (body.improve) await requireEnhance(db, app.ai); // say so before importing, not after
    const improve = { ...(body.improve ? { improve: true } : {}), ...(body.inbox ? { inbox: { sentBy: await whoSent(db, req.auth!), sourceApp: req.auth!.method === "apiKey" ? "RecipeHub Companion" : null } } : {}) };
    const job = body.url
      ? await queue.enqueue("import-url", { url: body.url, force: !!body.force, ...(body.html ? { html: body.html } : {}), ...improve }, userOf(req))
      : await queue.enqueue("import-text", { text: body.text!, ...improve }, userOf(req));
    const done = body.wait ? await queue.wait(job.id, body.wait * 1000) : job;
    const finished = done && (done.status === "done" || done.status === "failed");
    return reply.status(finished ? 200 : 202).send(jobView(done ?? job));
  });

  app.get("/api/imports/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const job = await queue.get(id);
    if (!job || !job.kind.startsWith("import-")) throw notFound("Import");
    return jobView(job);
  });

  // Recent imports, newest first
  app.get("/api/imports", async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    return (await db.select().from(jobs).orderBy(desc(jobs.id)).limit(limit)).filter((j) => j.kind.startsWith("import-")).map(jobView);
  });

  // In the background now (the status pill on every screen): file imports and AI batches waiting
  // or running, and AI batches that finished in the last minute (so the pill can say it's done)
  app.get("/api/imports/active", async () => {
    const rows = await db
      .select()
      .from(jobs)
      .where(sql`(${jobs.kind} in ('import-improve', 'import-file') and ${jobs.status} in ('queued', 'running')) or (${jobs.kind} = 'import-improve' and ${jobs.status} in ('done', 'failed') and ${jobs.finishedAt} > now() - interval '60 seconds')`)
      .orderBy(desc(jobs.id))
      .limit(20);
    return rows.map(jobView);
  });

  // Try a failed import again (or import a duplicate after all, with force)
  app.post("/api/imports/:id/retry", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { force } = z.object({ force: z.boolean().optional() }).strict().parse(req.body ?? {});
    const job = await queue.get(id);
    if (!job || !job.kind.startsWith("import-")) throw notFound("Import");
    const again = await queue.enqueue(job.kind, { ...job.payload, ...(force ? { force: true } : {}) }, userOf(req));
    return reply.status(202).send(jobView(again));
  });

  // A file listed first (?choose=1): import only the recipes picked (keep: their n). Once.
  app.post("/api/imports/:id/choose", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    // improve: then improve them all with AI, started by the import itself when it's done (so the
    // window can close and the pill shows it all, the import and then the improvements)
    const { keep, improve } = z.object({ keep: z.array(z.number().int().min(0)).max(10000), improve: z.boolean().optional() }).strict().parse(req.body ?? {});
    const job = await queue.get(id);
    if (!job || job.kind !== "import-file" || !job.result?.choices) throw notFound("Import");
    if (job.result.chosen) throw new HttpError(409, "These recipes have already been imported");
    const known = new Set(job.result.choices.map((c) => c.n));
    const picked = [...new Set(keep)].filter((n) => known.has(n));
    if (!picked.length) throw new HttpError(400, "Choose at least one recipe to import");
    if (improve) await requireEnhance(db, app.ai);
    const p = job.payload as { file: string; name: string; found?: unknown };
    const next = await queue.enqueue("import-file", { file: p.file, name: p.name, keep: picked, ...(p.found ? { found: p.found } : {}), ...(improve ? { improve: true } : {}) }, userOf(req));
    await db.update(jobs).set({ result: { ...job.result, chosen: next.id } }).where(eq(jobs.id, id));
    return reply.status(202).send(jobView(next));
  });

  // Improve every recipe this import brought in with AI, in the background (batch). The answer is
  // the new job: GET /api/imports/:id shows its progress (total, done, improved, unchanged, failed).
  app.post("/api/imports/:id/improve", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const job = await queue.get(id);
    if (!job || !job.kind.startsWith("import-")) throw notFound("Import");
    const recipeIds = job.result?.recipeIds ?? [];
    if (!recipeIds.length) throw new HttpError(400, "This import didn't bring in recipes to improve");
    await requireEnhance(db, app.ai);
    const batch = await queue.enqueue("import-improve", { importId: id, recipeIds, name: jobView(job).source }, userOf(req));
    return reply.status(202).send(jobView(batch));
  });

  // Stop a batch improve after the recipe it's working on
  app.post("/api/imports/:id/stop", async (req) => {
    const { id } = idParam.parse(req.params);
    const job = await queue.get(id);
    if (!job || job.kind !== "import-improve") throw notFound("Batch");
    await db.update(jobs).set({ result: sql`coalesce(${jobs.result}, '{}'::jsonb) || '{"stop": true}'::jsonb` }).where(eq(jobs.id, id));
    return jobView((await queue.get(id))!);
  });

  // ---------- photos ----------

  // Served without signing in (pictures can't send a login); the names are random
  app.get("/api/photos/:name", async (req, reply) => {
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const file = photos.path(name);
    if (!file || !fs.existsSync(file)) throw notFound("Photo");
    return reply.type("image/webp").header("Cache-Control", "public, max-age=31536000, immutable").send(fs.createReadStream(file));
  });

  const readUpload = async (req: FastifyRequest) => {
    const file = await req.file({ limits: { fileSize: 25 * 1024 * 1024 } });
    if (!file) throw new HttpError(400, "Choose a photo to upload");
    const buf = await file.toBuffer().catch(() => {
      throw new HttpError(413, "That photo is too large (25 MB at most)");
    });
    return photos.save(buf);
  };

  // A photo for a recipe you haven't saved yet: returns its address to put in imageUrl
  app.post("/api/photos", async (req, reply) => reply.status(201).send({ imageUrl: await readUpload(req) }));

  // Replace a recipe's photo (the old one is deleted if it was uploaded here)
  app.post("/api/recipes/:id/photo", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [r] = await db.select({ imageUrl: recipes.imageUrl }).from(recipes).where(eq(recipes.id, id));
    if (!r) throw notFound("Recipe");
    const imageUrl = await readUpload(req);
    await db.update(recipes).set({ imageUrl, updatedAt: new Date() }).where(eq(recipes.id, id));
    await photos.remove(r.imageUrl);
    return reply.status(201).send({ imageUrl });
  });
}
