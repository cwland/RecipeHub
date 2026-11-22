import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { apiKeys, inboxItems, INBOX_STATUSES, INBOX_TYPES, recipes } from "../db/schema.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam } from "../lib/validation.js";
import { whoSent } from "../lib/inbox.js";
import { KEY_CHECK, keyAllows, type KeyAccess } from "../lib/keyAccess.js";
import { APP_VERSION } from "../lib/version.js";
import { isOn } from "../lib/features.js";

// The inbox: links, notes and recipe data sent in by other apps (the RecipeHub Companion browser
// extension) to look at later. Shared by the household. API keys can only push to it (see
// lib/keyAccess.ts); reading, changing and clearing it is for signed-in people.

const webUrl = z
  .string()
  .trim()
  .max(2000)
  .url("That isn't a web address")
  .refine((u) => /^https?:\/\//i.test(u), "Only http:// and https:// addresses");
const short = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);

const pushBody = z
  .object({
    type: z.enum(INBOX_TYPES, { error: "type is RECIPE_LINK, INSTAGRAM_LINK, TEXT_NOTE or RAW_RECIPE_DATA" }),
    url: webUrl.optional(),
    title: short(300),
    content: z.string().max(1_000_000, "That's too much text (1 MB at most)").optional().transform((v) => (v?.trim() ? v : undefined)),
    sourceApp: short(100),
    metadata: z
      .object({ pageTitle: short(300), favIconUrl: webUrl.optional(), capturedAt: short(40) })
      .partial()
      .optional(),
  })
  .refine((b) => b.type === "TEXT_NOTE" || b.url, { message: "A link needs its url", path: ["url"] })
  .refine((b) => b.type !== "TEXT_NOTE" || b.content, { message: "A note needs its text (content)", path: ["content"] });

// What to call it: the title given, the note's first line, the page's title, or the link's site
function titleOf(b: z.infer<typeof pushBody>) {
  const firstLine = b.type === "TEXT_NOTE" ? b.content?.trim().split("\n")[0].trim() : undefined;
  const site = b.url ? new URL(b.url).hostname.replace(/^www\./, "") : undefined;
  // a note is named by its own first line, not the page it was written on
  return (b.title || firstLine || b.metadata?.pageTitle || site || "Untitled").slice(0, 300);
}

function requireSignedIn(req: FastifyRequest) {
  if (req.auth?.method !== "token") throw new HttpError(403, "Sign in to see the inbox");
}

const shown = (i: typeof inboxItems.$inferSelect) => ({
  id: i.id,
  type: i.type,
  title: i.title,
  url: i.url,
  content: i.content,
  sourceApp: i.sourceApp,
  metadata: i.metadata,
  status: i.status,
  sentBy: i.sentBy,
  recipeId: i.recipeId,
  createdAt: i.createdAt,
  reviewedAt: i.reviewedAt,
});

export default async function inboxRoutes(app: FastifyInstance) {
  const { db } = app;

  // For the RecipeHub Companion extension's connection test: is this key right, and what may it do?
  app.get(KEY_CHECK, async (req) => {
    const auth = req.auth!;
    if (auth.method !== "apiKey") return { app: "RecipeHub", version: APP_VERSION, signedIn: true };
    const [k] = await db.select({ name: apiKeys.name, access: apiKeys.access }).from(apiKeys).where(eq(apiKeys.id, auth.keyId));
    const access = k.access as KeyAccess;
    // AI correction on import needs AI and AI Enhance (Settings › AI)
    const aiCorrection = !!(await app.ai.active("recipe")) && (await isOn(db, "aiEnhance"));
    return { app: "RecipeHub", version: APP_VERSION, name: k.name, access, canPushToInbox: keyAllows(access, "POST", "/api/inbox"), canImport: keyAllows(access, "POST", "/api/recipes/import"), aiCorrection };
  });

  // Push something in (an "Inbox only" key, a write or admin key, or a signed-in person)
  app.post("/api/inbox", async (req, reply) => {
    const body = pushBody.parse(req.body);
    // The same link (or, for a note, the same text) while it's still waiting: don't add it twice
    // (a note sent from a page keeps the page's link, but it's the text that makes it the same note)
    const same = body.type === "TEXT_NOTE" ? and(eq(inboxItems.type, "TEXT_NOTE"), eq(inboxItems.content, body.content!)) : body.url ? and(eq(inboxItems.url, body.url), sql`${inboxItems.type} <> 'TEXT_NOTE'`) : null;
    if (same) {
      const [waiting] = await db
        .select()
        .from(inboxItems)
        .where(and(same, eq(inboxItems.status, "PENDING")))
        .limit(1);
      if (waiting) return reply.status(200).send({ ...shown(waiting), duplicate: true });
    }
    const auth = req.auth!;
    const sentBy = await whoSent(db, auth);
    const [row] = await db
      .insert(inboxItems)
      .values({ type: body.type, title: titleOf(body), url: body.url ?? null, content: body.content ?? null, sourceApp: body.sourceApp ?? null, metadata: body.metadata ?? null, sentBy })
      .returning();
    app.events.emit({ topic: "inbox", by: auth.method === "token" ? auth.userId : null });
    return reply.status(201).send(shown(row));
  });

  // What's waiting (or ?status=PROCESSED / DISMISSED), newest first
  app.get("/api/inbox", async (req) => {
    requireSignedIn(req);
    const { status } = z.object({ status: z.enum(INBOX_STATUSES).default("PENDING") }).parse(req.query);
    const rows = await db.select().from(inboxItems).where(eq(inboxItems.status, status)).orderBy(desc(inboxItems.createdAt), desc(inboxItems.id)).limit(500);
    return rows.map(shown);
  });

  // For the badge
  app.get("/api/inbox/count", async (req) => {
    requireSignedIn(req);
    const [{ n }] = await db.select({ n: count() }).from(inboxItems).where(eq(inboxItems.status, "PENDING"));
    return { pending: n };
  });

  // Dealt with: PROCESSED (imported) or DISMISSED (or back to PENDING)
  app.patch("/api/inbox/:id", async (req) => {
    requireSignedIn(req);
    const { id } = idParam.parse(req.params);
    // recipeId: imported, and this is the recipe it became
    const { status, recipeId } = z.object({ status: z.enum(INBOX_STATUSES), recipeId: z.number().int().positive().optional() }).parse(req.body);
    if (recipeId && !(await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, recipeId))).length) throw new HttpError(400, "That recipe isn't in RecipeHub");
    const [row] = await db
      .update(inboxItems)
      .set({ status, reviewedAt: status === "PENDING" ? null : new Date(), ...(recipeId ? { recipeId } : {}) })
      .where(eq(inboxItems.id, id))
      .returning();
    if (!row) throw notFound("Inbox item");
    app.events.emit({ topic: "inbox", by: req.auth!.method === "token" ? (req.auth as { userId: number }).userId : null });
    return shown(row);
  });

  app.delete("/api/inbox/:id", async (req, reply) => {
    requireSignedIn(req);
    const { id } = idParam.parse(req.params);
    const [row] = await db.delete(inboxItems).where(eq(inboxItems.id, id)).returning({ id: inboxItems.id });
    if (!row) throw notFound("Inbox item");
    app.events.emit({ topic: "inbox", by: (req.auth as { userId: number }).userId });
    return reply.status(204).send();
  });
}
