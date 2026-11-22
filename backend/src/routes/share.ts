import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { groceryItems, groceryLists, users } from "../db/schema.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam } from "../lib/validation.js";
import { loadRecipe } from "../lib/recipes.js";
import { fileName, groceryEmail, recipeEmail, recipeJsonLd, recipePrintPage } from "../lib/share.js";
import { isoDay, planEmail } from "../lib/reminders.js";
import { userOf } from "./recipes.js";
import { isOn } from "../lib/features.js";
import { logEvent } from "../lib/appLog.js";
import { newShareToken, publicRecipe, recipeIdForToken, sharePath, shareTokenOf } from "../lib/shareLinks.js";
import { exportRecipe, FORMATS, photoJpeg, type ExportFormat } from "../lib/exports.js";

// Sharing: a recipe by email, as a printable page (save as PDF), or as schema.org JSON-LD; the
// grocery list by email; and each person's daily meal plan email.
export default async function shareRoutes(app: FastifyInstance) {
  const { db, mail } = app;

  const me = async (req: FastifyRequest) => {
    const id = userOf(req);
    const [u] = id ? await db.select().from(users).where(eq(users.id, id)) : [];
    return u ?? null;
  };
  // Emails go out in someone's name: only from a signed-in person, not an API key
  const signedIn = (req: FastifyRequest) => {
    if (req.auth?.method !== "token") throw new HttpError(403, "Sign in to send email (API keys can't)");
  };
  const mailOrStop = async () => {
    const a = await mail.active();
    if (!a) throw new HttpError(409, "Email isn't set up yet. The owner can set it up in Settings › Email.");
    return a.config;
  };
  const recipients = z
    .string()
    .trim()
    .min(1, "Who should get it?")
    .max(1000)
    .transform((s) => s.split(/[,;\s]+/).filter(Boolean))
    .pipe(z.array(z.string().email("That doesn't look like an email address")).min(1).max(10, "Up to 10 people at a time"));

  // ---------- public share links ----------
  // The link's full address: the app's address from Settings › Email, else the one this was asked on
  const linkTo = async (req: FastifyRequest, token: string) => {
    const appUrl = (await mail.active())?.config.appUrl;
    const base = appUrl ? appUrl.replace(/\/+$/, "") : `${req.protocol}://${req.host}`;
    return { path: sharePath(token), url: `${base}${sharePath(token)}`, on: await isOn(db, "publicLinks") };
  };
  const shareLink = async (req: FastifyRequest) => linkTo(req, (await shareTokenOf(db, idParam.parse(req.params).id)).token);
  app.get("/api/recipes/:id/share-link", shareLink);
  app.post("/api/recipes/:id/share-link", shareLink); // every recipe already has one: this fetches it

  // New link: the old one stops working (for a link that spread further than meant)
  app.post("/api/recipes/:id/share-link/new", async (req) => {
    const r = await newShareToken(db, idParam.parse(req.params).id);
    await logEvent(db, { category: "import", level: "info", source: "Sharing", event: `New share link for "${r.title}" (the old one stopped working)` });
    return linkTo(req, r.token);
  });

  // The public page's recipe: no sign-in (see PUBLIC_ROUTES)
  app.get("/api/public/share/:token", async (req, reply) => {
    const { token } = z.object({ token: z.string().max(64) }).parse(req.params);
    reply.header("Cache-Control", "no-store").header("X-Robots-Tag", "noindex");
    return publicRecipe(db, token);
  });

  // ---------- downloads: PDF, JSON-LD, Paprika, Meal-Master, CookML ----------
  const formatOf = (q: unknown) =>
    z
      .object({ format: z.enum(Object.keys(FORMATS) as [ExportFormat, ...ExportFormat[]], { error: `Choose a format: ${Object.keys(FORMATS).join(", ")}` }) })
      .parse(q).format;
  const sendFile = async (reply: FastifyReply, id: number, format: ExportFormat, opts: { notes: boolean }) => {
    const r = await loadRecipe(db, id, null);
    const appUrl = (await mail.active())?.config.appUrl ?? null;
    const file = await exportRecipe({ ...r, notes: opts.notes ? r.notes : null }, format, { appUrl, photoDir: app.photos.dir });
    return reply.type(file.type).header("Content-Disposition", `attachment; filename="${file.filename}"`).send(file.body);
  };
  // From the app: the recipe's notes come along
  app.get("/api/recipes/:id/export", async (req, reply) => sendFile(reply, idParam.parse(req.params).id, formatOf(req.query), { notes: true }));
  // From a share link (no sign-in): never the notes
  app.get("/api/public/share/:token/export", async (req, reply) => {
    const { token } = z.object({ token: z.string().max(64) }).parse(req.params);
    const format = formatOf(req.query);
    reply.header("Cache-Control", "no-store").header("X-Robots-Tag", "noindex");
    return sendFile(reply, await recipeIdForToken(db, token), format, { notes: false });
  });

  // ---------- a recipe ----------
  app.get("/api/recipes/:id/jsonld", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const r = await loadRecipe(db, id, null);
    const appUrl = (await mail.active())?.config.appUrl ?? null;
    return reply
      .type("application/ld+json")
      .header("Content-Disposition", `attachment; filename="${fileName(r.title)}.json"`)
      .send(JSON.stringify(recipeJsonLd(r, appUrl), null, 2));
  });

  app.get("/api/recipes/:id/print", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    return reply.type("text/html; charset=utf-8").send(recipePrintPage(await loadRecipe(db, id, null)));
  });

  // Send from RecipeHub: the email, with the recipe attached as a file if asked (attach). It goes to
  // other people, so the recipe's notes stay out, as on the public page.
  app.post("/api/recipes/:id/email", async (req) => {
    const { id } = idParam.parse(req.params);
    signedIn(req);
    const body = z
      .object({ to: recipients, note: z.string().trim().max(1000).optional(), attach: z.enum(["none", ...(Object.keys(FORMATS) as ExportFormat[])], { error: `Attach none, or one of: ${Object.keys(FORMATS).join(", ")}` }).optional() })
      .strict()
      .parse(req.body);
    const config = await mailOrStop();
    const r = { ...(await loadRecipe(db, id, null)), notes: null };
    const u = await me(req);
    const appUrl = config.appUrl ?? null;
    const shareUrl = appUrl && (await isOn(db, "publicLinks")) ? `${appUrl.replace(/\/+$/, "")}${sharePath((await shareTokenOf(db, id)).token)}` : null;
    const photo = await photoJpeg(r.imageUrl, app.photos.dir);
    const file = body.attach && body.attach !== "none" ? await exportRecipe(r, body.attach, { appUrl, photoDir: app.photos.dir }) : null;
    const msg = recipeEmail(r, { appUrl, from: u?.displayName || u?.username || "Someone", note: body.note, shareUrl, photoCid: !!photo, attached: file?.filename });
    const attachments = [
      ...(photo ? [{ cid: "recipe-photo", content: photo, contentType: "image/jpeg", contentDisposition: "inline" as const }] : []),
      ...(file ? [{ filename: file.filename, content: file.body, contentType: file.type }] : []),
    ];
    for (const to of body.to) await mail.send({ to, ...msg, attachments }, config, "recipe");
    return { sent: body.to.length };
  });

  // ---------- the grocery list ----------
  app.post("/api/grocery/lists/:id/email", async (req) => {
    const { id } = idParam.parse(req.params);
    signedIn(req);
    const body = z.object({ to: recipients.optional() }).strict().parse(req.body ?? {});
    const config = await mailOrStop();
    const [list] = await db.select().from(groceryLists).where(eq(groceryLists.id, id));
    if (!list) throw notFound("List");
    const u = await me(req);
    const to = body.to ?? (u?.email ? [u.email] : null);
    if (!to) throw new HttpError(400, "Add your email address in Settings › Profile, or say who should get it");
    const items = await db.select().from(groceryItems).where(eq(groceryItems.listId, id)).orderBy(asc(groceryItems.position));
    if (!items.some((i) => !i.checked)) throw new HttpError(400, "There's nothing left to get on this list");
    const msg = groceryEmail(list.name, items, u?.displayName || u?.username || "Someone");
    for (const addr of to) await mail.send({ to: addr, ...msg }, config, "grocery-list");
    return { sent: to.length };
  });

  // ---------- the daily meal plan email ----------
  app.put("/api/profile/reminder", async (req) => {
    const id = userOf(req);
    if (!id || req.auth?.method !== "token") throw new HttpError(403, "Log in to do this");
    const { remindAt } = z.object({ remindAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time like 17:30").nullable() }).strict().parse(req.body);
    const u = await me(req);
    if (remindAt && !u?.email) throw new HttpError(400, "Add your email address first");
    // turned on after today's time has passed: starts tomorrow
    const now = app.now();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    await db.update(users).set({ remindAt, ...(remindAt && remindAt <= hhmm ? { remindedOn: isoDay(now) } : {}) }).where(eq(users.id, id));
    return { remindAt };
  });

  // Send it now (to check how it looks)
  app.post("/api/profile/reminder/test", async (req) => {
    const u = await me(req);
    if (!u || req.auth?.method !== "token") throw new HttpError(403, "Log in to do this");
    if (!u.email) throw new HttpError(400, "Add your email address first");
    const config = await mailOrStop();
    const msg = await planEmail(db, isoDay(app.now()), config.appUrl ?? null);
    if (!msg) throw new HttpError(400, "Nothing is planned for today or tomorrow, so there's nothing to send");
    await mail.send({ to: u.email, ...msg }, config, "reminder");
    return { sent: 1 };
  });
}
