import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { appSettings, mealPlan, recipes } from "../db/schema.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam, isoDate } from "../lib/validation.js";
import { userOf } from "./recipes.js";

// The meal plan: dishes on days, in meal slots. Shared by the household.

export interface PlannerSettings {
  slots: { id: string; name: string }[];
  weekStart: 0 | 1; // 0 Sunday, 1 Monday
}
export const DEFAULT_PLANNER: PlannerSettings = {
  slots: [
    { id: "breakfast", name: "Breakfast" },
    { id: "lunch", name: "Lunch" },
    { id: "dinner", name: "Dinner" },
    { id: "snack", name: "Snack" },
  ],
  weekStart: 1,
};

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

export default async function planRoutes(app: FastifyInstance) {
  const { db } = app;

  const settings = async (): Promise<PlannerSettings> => {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "planner"));
    return { ...DEFAULT_PLANNER, ...((row?.value ?? {}) as Partial<PlannerSettings>) };
  };
  const checkSlot = async (slot: string) => {
    if (!(await settings()).slots.some((s) => s.id === slot)) throw new HttpError(400, `There's no "${slot}" meal slot`);
  };
  const nextPosition = async (date: string, slot: string) =>
    Number((await db.select({ n: sql<number>`coalesce(max(${mealPlan.position}), -1) + 1` }).from(mealPlan).where(and(eq(mealPlan.date, date), eq(mealPlan.slot, slot))))[0].n);

  const view = (from: string, to: string) =>
    db
      .select({
        id: mealPlan.id,
        date: mealPlan.date,
        slot: mealPlan.slot,
        position: mealPlan.position,
        recipeId: mealPlan.recipeId,
        title: sql<string>`coalesce(${recipes.title}, ${mealPlan.title})`,
        servings: mealPlan.servings,
        note: mealPlan.note,
        imageUrl: recipes.imageUrl,
        totalMinutes: recipes.totalMinutes,
        recipeServings: recipes.servings,
      })
      .from(mealPlan)
      .leftJoin(recipes, eq(recipes.id, mealPlan.recipeId))
      .where(and(gte(mealPlan.date, from), lte(mealPlan.date, to)))
      .orderBy(asc(mealPlan.date), asc(mealPlan.slot), asc(mealPlan.position), asc(mealPlan.id));
  const one = async (id: number) => {
    const [row] = await db.select({ date: mealPlan.date }).from(mealPlan).where(eq(mealPlan.id, id));
    if (!row) throw notFound("Planned meal");
    return (await view(row.date, row.date)).find((r) => r.id === id)!;
  };

  // Meal slots and the first day of the week (shared by the household)
  app.get("/api/plan/settings", async () => settings());
  app.put("/api/plan/settings", async (req) => {
    const body = z
      .object({
        slots: z
          .array(z.object({ id: z.string().trim().max(40).optional(), name: z.string().trim().min(1, "Name the meal").max(40) }))
          .min(1, "Keep at least one meal")
          .max(10)
          .optional(),
        weekStart: z.union([z.literal(0), z.literal(1)]).optional(),
      })
      .strict()
      .parse(req.body);
    const current = await settings();
    const used = new Set<string>();
    const slots =
      body.slots?.map((s) => {
        // new slots get an id from their name ("Second breakfast" -> second-breakfast)
        let id = s.id || s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "meal";
        while (used.has(id)) id += "-2";
        used.add(id);
        return { id, name: s.name };
      }) ?? current.slots;
    // A slot with meals planned in it can't be removed
    const removed = current.slots.filter((s) => !slots.some((x) => x.id === s.id)).map((s) => s.id);
    if (removed.length) {
      const [inUse] = await db.select({ slot: mealPlan.slot }).from(mealPlan).where(sql`${mealPlan.slot} in ${removed}`).limit(1);
      if (inUse) throw new HttpError(400, `There are meals planned under "${current.slots.find((s) => s.id === inUse.slot)?.name}". Move or remove them first.`);
    }
    const value = { slots, weekStart: body.weekStart ?? current.weekStart };
    await db.insert(appSettings).values({ key: "planner", value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    return value;
  });

  // What's planned between two dates (a week, usually)
  app.get("/api/plan", async (req) => {
    const q = z.object({ from: isoDate, to: isoDate }).parse(req.query);
    if (daysBetween(q.from, q.to) < 0 || daysBetween(q.from, q.to) > 62) throw new HttpError(400, "Ask for up to two months at a time");
    return view(q.from, q.to);
  });

  // Plan a recipe, or a note ("Leftovers"), on a day and meal
  app.post("/api/plan", async (req, reply) => {
    const body = z
      .object({
        date: isoDate,
        slot: z.string().max(40),
        recipeId: z.number().int().positive().optional(),
        title: z.string().trim().min(1).max(200).optional(),
        servings: z.number().int().min(1).max(1000).nullable().optional(),
        note: z.string().trim().max(1000).nullable().optional(),
      })
      .strict()
      .refine((b) => b.recipeId || b.title, "Choose a recipe, or type what's for that meal")
      .parse(req.body);
    await checkSlot(body.slot);
    let title = body.title;
    if (body.recipeId) {
      const [r] = await db.select({ title: recipes.title }).from(recipes).where(eq(recipes.id, body.recipeId));
      if (!r) throw notFound("Recipe");
      title = r.title;
    }
    const [row] = await db
      .insert(mealPlan)
      .values({ date: body.date, slot: body.slot, recipeId: body.recipeId ?? null, title: title!, servings: body.servings ?? null, note: body.note || null, position: await nextPosition(body.date, body.slot), createdBy: userOf(req) })
      .returning({ id: mealPlan.id });
    app.events.emit({ topic: "plan", by: userOf(req) });
    return reply.status(201).send(await one(row.id));
  });

  // Move it (another day or meal: it goes to the end there, or to "position"), or change servings / note
  app.patch("/api/plan/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        date: isoDate.optional(),
        slot: z.string().max(40).optional(),
        position: z.number().int().min(0).optional(),
        servings: z.number().int().min(1).max(1000).nullable().optional(),
        note: z.string().trim().max(1000).nullable().optional(),
        title: z.string().trim().min(1).max(200).optional(),
      })
      .strict()
      .parse(req.body);
    const [cur] = await db.select().from(mealPlan).where(eq(mealPlan.id, id));
    if (!cur) throw notFound("Planned meal");
    if (body.slot) await checkSlot(body.slot);
    const date = body.date ?? cur.date;
    const slot = body.slot ?? cur.slot;
    const moved = date !== cur.date || slot !== cur.slot;
    await db.transaction(async (tx) => {
      if (moved || body.position !== undefined) {
        // the cell it goes to, in order, with this one put at its new place
        const cell = await tx.select({ id: mealPlan.id, position: mealPlan.position }).from(mealPlan).where(and(eq(mealPlan.date, date), eq(mealPlan.slot, slot)));
        const order = cell.filter((r) => r.id !== id).sort((a, b) => a.position - b.position).map((r) => r.id);
        order.splice(Math.min(body.position ?? order.length, order.length), 0, id);
        for (const [i, x] of order.entries()) await tx.update(mealPlan).set({ position: i, ...(x === id ? { date, slot } : {}) }).where(eq(mealPlan.id, x));
        // and close the gap where it was
        if (moved) {
          const left = await tx.select({ id: mealPlan.id }).from(mealPlan).where(and(eq(mealPlan.date, cur.date), eq(mealPlan.slot, cur.slot))).orderBy(asc(mealPlan.position), asc(mealPlan.id));
          for (const [i, r] of left.entries()) await tx.update(mealPlan).set({ position: i }).where(eq(mealPlan.id, r.id));
        }
      }
      const changes = { servings: body.servings, note: body.note === undefined ? undefined : body.note || null, title: cur.recipeId ? undefined : body.title };
      if (Object.values(changes).some((v) => v !== undefined)) await tx.update(mealPlan).set(changes).where(eq(mealPlan.id, id));
    });
    app.events.emit({ topic: "plan", by: userOf(req) });
    return one(id);
  });

  app.delete("/api/plan/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const gone = await db.delete(mealPlan).where(eq(mealPlan.id, id)).returning({ id: mealPlan.id });
    if (!gone.length) throw notFound("Planned meal");
    app.events.emit({ topic: "plan", by: userOf(req) });
    return reply.status(204).send();
  });

  // Copy a week (or any days) onto other days: "same as last week"
  app.post("/api/plan/copy", async (req) => {
    const body = z.object({ from: isoDate, to: isoDate, days: z.number().int().min(1).max(31).default(7) }).strict().parse(req.body);
    const rows = await db.select().from(mealPlan).where(and(gte(mealPlan.date, body.from), lte(mealPlan.date, addDays(body.from, body.days - 1)))).orderBy(asc(mealPlan.date), asc(mealPlan.position));
    const shift = daysBetween(body.from, body.to);
    for (const r of rows) {
      const date = addDays(r.date, shift);
      await db.insert(mealPlan).values({ date, slot: r.slot, recipeId: r.recipeId, title: r.title, servings: r.servings, note: r.note, position: await nextPosition(date, r.slot), createdBy: userOf(req) });
    }
    app.events.emit({ topic: "plan", by: userOf(req) });
    return { copied: rows.length };
  });

  // Clear some days
  app.delete("/api/plan", async (req) => {
    const q = z.object({ from: isoDate, to: isoDate }).parse(req.query);
    const gone = await db.delete(mealPlan).where(and(gte(mealPlan.date, q.from), lte(mealPlan.date, q.to))).returning({ id: mealPlan.id });
    app.events.emit({ topic: "plan", by: userOf(req) });
    return { removed: gone.length };
  });
}
