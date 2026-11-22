import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, asc, count, eq, isNull, max, ne, sql } from "drizzle-orm";
import { passwordResets, sessions, users } from "../db/schema.js";
import { generateResetToken, hashPassword } from "../lib/auth.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam } from "../lib/validation.js";
import { logEvent } from "../lib/appLog.js";

// The household: everyone who signs in to this server. The owner adds and removes members; members
// share the recipes, meal plan, grocery lists and pantry, and keep their own favorites, ratings,
// notes and sign-in settings.

const INVITE_DAYS = 7;

function requireUser(req: FastifyRequest) {
  if (req.auth?.method !== "token") throw new HttpError(403, "Sign in to do this");
  return req.auth;
}

const username = z.string().trim().min(1, "Choose a username").max(100).regex(/^[^\s@]+$/, "A username can't have spaces or @");
const email = z.string().trim().email("That doesn't look like an email address").max(200);

export default async function householdRoutes(app: FastifyInstance) {
  const { db } = app;

  const list = async () => {
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
        lastSeenAt: max(sessions.lastSeenAt),
        // invited but hasn't set a password yet
        invited: sql<boolean>`exists (select 1 from password_resets pr where pr.user_id = ${users.id} and pr.used_at is null and pr.expires_at > now()) and ${users.passwordHash} like 'invite:%'`,
      })
      .from(users)
      .leftJoin(sessions, eq(sessions.userId, users.id))
      .groupBy(users.id)
      .orderBy(asc(users.id));
    return rows;
  };

  // Who's in the household (everyone signed in can see this, e.g. to know who added what)
  app.get("/api/household/members", async (req) => {
    requireUser(req);
    return list();
  });

  const owners = async () => (await db.select({ n: count() }).from(users).where(eq(users.role, "owner")))[0].n;

  // Email an invite link: it sets their password (works like a password reset, for 7 days)
  const sendInvite = async (user: typeof users.$inferSelect, from: string) => {
    const active = await app.mail.active();
    if (!active?.config.appUrl) throw new HttpError(400, "Email isn't set up (with the app's address) in Settings › Email, so an invite can't be sent. Give them a password instead.");
    if (!user.email) throw new HttpError(400, "Add their email address first");
    await db.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));
    const { token, hash } = generateResetToken();
    await db.insert(passwordResets).values({ userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000) });
    const link = `${active.config.appUrl}/#/reset?token=${token}`;
    const esc = (s: string) => s.replace(/[<>&"]/g, "");
    await app.mail.send(
      {
        to: user.email,
        subject: `${from} invited you to RecipeHub`,
        text: `${from} added you to their RecipeHub household: shared recipes, meal plans and grocery lists.\n\nYour username is "${user.username}". Choose your password here (this link works for ${INVITE_DAYS} days):\n${link}`,
        html: `<p>${esc(from)} added you to their RecipeHub household: shared recipes, meal plans and grocery lists.</p><p>Your username is <strong>${esc(user.username)}</strong>.</p><p><a href="${link}">Choose your password</a> (this link works for ${INVITE_DAYS} days).</p>`,
      },
      undefined,
      "invite"
    );
  };

  const inviterName = async (userId: number) => {
    const [me] = await db.select({ username: users.username, displayName: users.displayName }).from(users).where(eq(users.id, userId));
    return me?.displayName || me?.username || "Someone";
  };

  // Add someone: with a password you give them, or (with email set up) an invite to choose their own
  app.post("/api/household/members", async (req, reply) => {
    const auth = requireUser(req);
    const body = z
      .object({
        username,
        displayName: z.string().trim().max(100).nullable().optional().transform((v) => v || null),
        email: email.optional().nullable(),
        password: z.string().min(8, "Use at least 8 characters").max(200).optional(),
        invite: z.boolean().optional(),
        role: z.enum(["owner", "member"]).default("member"),
      })
      .strict()
      .refine((b) => b.password || b.invite, "Give them a password, or send an invite")
      .refine((b) => !b.invite || b.email, { message: "An invite needs their email address", path: ["email"] })
      .parse(req.body);
    const [taken] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${body.username.toLowerCase()}`);
    if (taken) throw new HttpError(409, "That username is taken");
    // Invited: no password works until they choose one
    const passwordHash = body.password ? await hashPassword(body.password) : `invite:${randomBytes(24).toString("hex")}`;
    const [user] = await db.insert(users).values({ username: body.username, displayName: body.displayName, email: body.email ?? null, passwordHash, role: body.role }).returning();
    if (body.invite) {
      try {
        await sendInvite(user, await inviterName(auth.userId));
      } catch (e) {
        await db.delete(users).where(eq(users.id, user.id)); // nothing half-made
        throw e;
      }
    }
    await logEvent(db, { category: "api", level: "info", source: "Household", event: `${user.username} was added${body.invite ? " (invite emailed)" : ""}` });
    return reply.status(201).send((await list()).find((m) => m.id === user.id));
  });

  // Change someone's name, email or role, or set a new password for them (signs them out)
  app.patch("/api/household/members/:id", async (req) => {
    const auth = requireUser(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        displayName: z.string().trim().max(100).nullable().optional().transform((v) => (v === undefined ? undefined : v || null)),
        email: email.nullable().optional(),
        role: z.enum(["owner", "member"]).optional(),
        password: z.string().min(8, "Use at least 8 characters").max(200).optional(),
      })
      .strict()
      .parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user) throw notFound("Member");
    if (body.role === "member" && user.role === "owner" && (await owners()) <= 1) throw new HttpError(400, "The household needs an owner. Make someone else an owner first.");
    await db
      .update(users)
      .set({
        displayName: body.displayName,
        email: body.email,
        role: body.role,
        ...(body.password ? { passwordHash: await hashPassword(body.password), tokenVersion: sql`${users.tokenVersion} + 1` } : {}),
      })
      .where(eq(users.id, id));
    if (body.password && id !== auth.userId) await logEvent(db, { category: "api", level: "info", source: "Household", event: `${user.username}'s password was changed by the owner` });
    return (await list()).find((m) => m.id === id);
  });

  // Send (or send again) an invite to choose a password
  app.post("/api/household/members/:id/invite", async (req) => {
    const auth = requireUser(req);
    const { id } = idParam.parse(req.params);
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user) throw notFound("Member");
    await sendInvite(user, await inviterName(auth.userId));
    return { ok: true, to: user.email };
  });

  // Remove someone. Their favorites, ratings and notes go; recipes they added stay.
  app.delete("/api/household/members/:id", async (req, reply) => {
    const auth = requireUser(req);
    const { id } = idParam.parse(req.params);
    if (id === auth.userId) throw new HttpError(400, "You can't remove yourself");
    const [user] = await db.select().from(users).where(and(eq(users.id, id), ne(users.id, auth.userId)));
    if (!user) throw notFound("Member");
    if (user.role === "owner" && (await owners()) <= 1) throw new HttpError(400, "The household needs an owner");
    await db.delete(users).where(eq(users.id, id));
    await logEvent(db, { category: "api", level: "info", source: "Household", event: `${user.username} was removed` });
    return reply.status(204).send();
  });
}
