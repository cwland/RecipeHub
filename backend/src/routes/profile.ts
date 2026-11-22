import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { users } from "../db/schema.js";
import { HttpError } from "../lib/errors.js";
import { publicUser } from "./auth.js";

function requireLogin(req: FastifyRequest): number {
  if (req.auth?.method !== "token") throw new HttpError(403, "Log in to do this");
  return req.auth.userId;
}

export default async function profileRoutes(app: FastifyInstance) {
  const { db } = app;

  // Update username, display name and email (empty string clears the display name; the email is
  // required: password reset links and notifications go there)
  // The setup wizard is done (shown once, on the first sign-in)
  app.post("/api/profile/setup-done", async (req) => {
    const userId = requireLogin(req);
    const [user] = await db.update(users).set({ setupDoneAt: new Date() }).where(eq(users.id, userId)).returning();
    return { user: publicUser(user) };
  });

  app.patch("/api/profile", async (req) => {
    const userId = requireLogin(req);
    const body = z
      .object({
        username: z.string().trim().min(1).max(100).optional(),
        displayName: z.string().trim().max(100).nullable().optional(),
        email: z
          .string({ error: "Your email address is required (for password resets and notifications)" })
          .trim()
          .min(1, "Your email address is required (for password resets and notifications)")
          .email("That doesn't look like an email address")
          .max(200)
          .optional(),
        // Settings > Profile > Theme (the list is in frontend/src/themes.ts)
        theme: z.enum(["fresh", "harbor", "terracotta-sage", "slate-rose", "midnight-coral"]).optional(),
        colorMode: z.enum(["light", "dark", "system"]).optional(),
        units: z.enum(["original", "metric", "us"], { error: "Choose As is, Metric or US" }).optional(),
        keepAwake: z.boolean().optional(),
        ingredientOrder: z.enum(["entered", "alpha"], { error: "Choose As entered or A to Z" }).optional(),
      })
      .parse(req.body);

    if (body.username) {
      const [taken] = await db.select({ id: users.id }).from(users).where(and(sql`lower(${users.username}) = ${body.username.toLowerCase()}`, ne(users.id, userId)));
      if (taken) throw new HttpError(409, "That username is taken");
    }
    const [user] = await db
      .update(users)
      .set({
        username: body.username,
        displayName: body.displayName === undefined ? undefined : body.displayName || null,
        email: body.email,
        theme: body.theme,
        colorMode: body.colorMode,
        units: body.units,
        keepAwake: body.keepAwake,
        ingredientOrder: body.ingredientOrder,
      })
      .where(eq(users.id, userId))
      .returning();
    return publicUser(user);
  });
}
