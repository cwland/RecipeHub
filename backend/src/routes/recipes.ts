import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { recipeUser, recipes, substitutions } from "../db/schema.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam } from "../lib/validation.js";
import { createRecipe, listQuery, listRecipes, loadRecipe, saveRecipe, updateRecipe } from "../lib/recipes.js";
import { ingredientsChanged, ingredientsUpdated, recipeAdded } from "../lib/nutrition.js";
import { activateVersion, changedParts, deleteVersion, describeParts, ensureVersions, firstVersion, getVersion, listVersions, newVersion, syncActive, versionData } from "../lib/versions.js";

// Who's asking: a signed-in person, or null for an API key (keys belong to the household, not a person)
export const userOf = (req: FastifyRequest) => (req.auth?.method === "token" ? req.auth.userId : null);
function requireUser(req: FastifyRequest) {
  const id = userOf(req);
  if (!id) throw new HttpError(403, "Sign in to do this (favorites, ratings and notes are per person)");
  return id;
}

const editVersion = z.object({ version: z.enum(["new", "current"]).optional() }).passthrough();

export default async function recipeRoutes(app: FastifyInstance) {
  const { db } = app;

  // The recipe box: search, filter by tag / category / collection / favorites, sort
  app.get("/api/recipes", async (req) => listRecipes(db, userOf(req), listQuery.parse(req.query)));

  app.get("/api/recipes/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    return loadRecipe(db, id, userOf(req));
  });

  // Add a recipe. Ingredients and steps can be one block of text (a line each) or lists.
  app.post("/api/recipes", async (req, reply) => {
    const body = createRecipe.parse(req.body);
    const id = await saveRecipe(db, null, body, userOf(req));
    await firstVersion(db, id, "created", userOf(req));
    await recipeAdded(app, id, { offered: userOf(req) !== null }); // (an API key never sees the AI check offer)
    return reply.status(201).send(await loadRecipe(db, id, userOf(req)));
  });

  // Change any of its fields (tags, categories and collections, when given, replace the old ones)
  app.patch("/api/recipes/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    // version: "new" saves the change as a new version; "current" (or left out) changes the active one
    const { version = "current", ...fields } = editVersion.parse(req.body ?? {});
    const body = updateRecipe.parse(fields);
    const [before] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (before) await ensureVersions(db, id);
    await saveRecipe(db, id, body, userOf(req));
    const [after] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (before && after) {
      const parts = changedParts(versionData(before), versionData(after));
      // (nutrition alone never makes a version; tags, categories and the photo aren't in versions)
      if (version === "new" && parts.some((p) => p !== "nutrition")) await newVersion(db, id, "edit", `Changed ${describeParts(parts)}`, userOf(req));
      else await syncActive(db, id);
      if (ingredientsChanged(before.ingredients, after.ingredients)) await ingredientsUpdated(app, id);
    }
    // A new photo (or none): the old one goes, if it was uploaded here and nothing else uses it
    if (body.imageUrl !== undefined && before?.imageUrl && body.imageUrl !== before.imageUrl) {
      const [other] = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.imageUrl, before.imageUrl));
      if (!other) await app.photos.remove(before.imageUrl);
    }
    return loadRecipe(db, id, userOf(req));
  });

  // ---------- versions ----------
  const versionParams = z.object({ id: z.coerce.number().int().positive(), number: z.coerce.number().int().positive() });
  // Every version, newest first (number, source, summary, active, createdAt, by)
  app.get("/api/recipes/:id/versions", async (req) => {
    const { id } = idParam.parse(req.params);
    return listVersions(db, id);
  });
  // One version with its content (data)
  app.get("/api/recipes/:id/versions/:number", async (req) => {
    const { id, number } = versionParams.parse(req.params);
    return getVersion(db, id, number);
  });
  // The recipe becomes this version (tags, categories, photo and favorites stay)
  app.post("/api/recipes/:id/versions/:number/activate", async (req) => {
    const { id, number } = versionParams.parse(req.params);
    await activateVersion(db, id, number);
    app.events.emit({ topic: "recipes", id, by: userOf(req) });
    return loadRecipe(db, id, userOf(req));
  });
  // Any version but the active one
  app.delete("/api/recipes/:id/versions/:number", async (req, reply) => {
    const { id, number } = versionParams.parse(req.params);
    await deleteVersion(db, id, number);
    return reply.status(204).send();
  });

  app.delete("/api/recipes/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const gone = await db.delete(recipes).where(eq(recipes.id, id)).returning({ id: recipes.id, imageUrl: recipes.imageUrl });
    if (!gone.length) throw notFound("Recipe");
    await app.photos.remove(gone[0].imageUrl); // (only photos uploaded here)
    return reply.status(204).send();
  });

  // A copy to change without touching the original ("Mom's chili (copy)")
  app.post("/api/recipes/:id/duplicate", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const r = await loadRecipe(db, id, null);
    const copy = await saveRecipe(
      db,
      null,
      {
        title: `${r.title} (copy)`,
        description: r.description,
        ingredients: r.ingredients.map((i) => i.raw),
        steps: r.steps.map((s) => (s.section ? { section: s.section } : { text: s.text })),
        servings: r.servings,
        yieldText: r.yieldText,
        prepMinutes: r.prepMinutes,
        cookMinutes: r.cookMinutes,
        totalMinutes: r.totalMinutes,
        sourceUrl: r.sourceUrl,
        sourceName: r.sourceName,
        imageUrl: r.imageUrl,
        notes: r.notes,
        tags: r.tags,
        categories: r.categories.map((c) => c.id),
      },
      userOf(req)
    );
    return reply.status(201).send(await loadRecipe(db, copy, userOf(req)));
  });

  // ---------- your own: favorite, pinned, rating, private notes ----------
  app.put("/api/recipes/:id/me", async (req) => {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        favorite: z.boolean().optional(),
        pinned: z.boolean().optional(),
        rating: z.number().int().min(1).max(5).nullable().optional(),
        notes: z.string().trim().max(20000).nullable().optional().transform((v) => (v === undefined ? undefined : v || null)),
      })
      .strict()
      .parse(req.body);
    const [exists] = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, id));
    if (!exists) throw notFound("Recipe");
    const set = { ...body, updatedAt: new Date() };
    await db.insert(recipeUser).values({ recipeId: id, userId, ...body }).onConflictDoUpdate({ target: [recipeUser.recipeId, recipeUser.userId], set });
    const [me] = await db.select().from(recipeUser).where(and(eq(recipeUser.recipeId, id), eq(recipeUser.userId, userId)));
    return { favorite: me.favorite, pinned: me.pinned, rating: me.rating, notes: me.notes };
  });

  // ---------- substitutions ----------
  // A swap (instead of an ingredient line picked from the recipe, or of something typed) or an
  // item added, with what was used: an amount and a unit (both optional) and the item. The older
  // { original, replacement } still works.
  const subView = { id: substitutions.id, kind: substitutions.kind, original: substitutions.original, line: substitutions.line, amount: substitutions.amount, unit: substitutions.unit, item: substitutions.item, replacement: substitutions.replacement, note: substitutions.note, appliedVersion: substitutions.appliedVersion, createdAt: substitutions.createdAt };
  const text = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);
  app.post("/api/recipes/:id/substitutions", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ kind: z.enum(["swap", "add"]).default("swap"), original: text(200), line: text(1000), amount: text(20), unit: text(30), item: text(200), replacement: text(300), note: text(1000) })
      .strict()
      .parse(req.body);
    const [r] = await db.select({ id: recipes.id, ingredients: recipes.ingredients }).from(recipes).where(eq(recipes.id, id));
    if (!r) throw notFound("Recipe");
    const item = body.item ?? body.replacement;
    if (!item) throw new HttpError(400, body.kind === "add" ? "What did you add?" : "What did you use instead?");
    const replacement = body.item ? [body.amount, body.unit, body.item].filter(Boolean).join(" ") : item;
    if (body.kind === "swap" && !body.line && !body.original) throw new HttpError(400, "What did you replace?");
    if (body.line && !r.ingredients.some((i) => !i.section && i.raw === body.line)) throw new HttpError(400, "That ingredient isn't in this recipe");
    const [row] = await db
      .insert(substitutions)
      .values({ recipeId: id, userId: userOf(req), kind: body.kind, original: body.kind === "add" ? null : (body.line ?? body.original), line: body.kind === "add" ? null : body.line, amount: body.amount, unit: body.unit, item, replacement: replacement.slice(0, 300), note: body.note })
      .returning(subView);
    return reply.status(201).send(row);
  });

  // Make a new version with these changes: the ticked swaps replace their lines, the added items
  // go at the end, and the recipe saves as a new version saying what changed. Free-text swaps (no
  // line) and ones already applied are left out; a line no longer in the recipe is skipped.
  app.post("/api/recipes/:id/substitutions/apply", async (req) => {
    const { id } = idParam.parse(req.params);
    const { ids } = z.object({ ids: z.array(z.number().int().positive()).max(200) }).parse(req.body);
    const [before] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (!before) throw notFound("Recipe");
    const picked = ids.length ? (await db.select().from(substitutions).where(and(eq(substitutions.recipeId, id), inArray(substitutions.id, ids)))).filter((x) => x.appliedVersion === null && (x.kind === "add" || x.line)) : [];
    if (!picked.length) throw new HttpError(400, "Nothing to apply: pick swaps of an ingredient in this recipe, or added items, that aren't in it yet");
    const list = before.ingredients.map((i) => (i.section ? { section: i.section } : { raw: i.raw }));
    const done: typeof picked = [];
    const missing: string[] = [];
    const used = new Set<number>();
    const ordered = [...picked].sort((a, b) => a.id - b.id); // in the order they were made
    for (const x of ordered.filter((x) => x.kind === "swap")) {
      const at = list.findIndex((i, n) => !used.has(n) && "raw" in i && i.raw === x.line);
      if (at < 0) {
        missing.push(x.line!);
        continue;
      }
      list[at] = { raw: x.replacement };
      used.add(at);
      done.push(x);
    }
    for (const x of ordered.filter((x) => x.kind === "add")) {
      list.push({ raw: x.replacement });
      done.push(x);
    }
    if (!done.length) throw new HttpError(400, `Those ingredients aren't in the recipe any more (${missing.join(", ")}), so nothing changed`);
    const summary = `Substitutions: ${done.map((x) => (x.kind === "add" ? `added ${x.replacement}` : `${x.line} → ${x.replacement}`)).join("; ")}`.slice(0, 500);
    await ensureVersions(db, id);
    await saveRecipe(db, id, updateRecipe.parse({ ingredients: list }), userOf(req));
    await newVersion(db, id, "edit", summary, userOf(req));
    const version = (await listVersions(db, id)).find((v) => v.active)?.number ?? null;
    await db.update(substitutions).set({ appliedVersion: version ?? 0, appliedAt: new Date() }).where(inArray(substitutions.id, done.map((x) => x.id)));
    const [after] = await db.select({ ingredients: recipes.ingredients }).from(recipes).where(eq(recipes.id, id));
    if (after && ingredientsChanged(before.ingredients, after.ingredients)) await ingredientsUpdated(app, id);
    app.events.emit({ topic: "recipes", id, by: userOf(req) });
    return { version, applied: done.length, missing, recipe: await loadRecipe(db, id, userOf(req)) };
  });

  app.delete("/api/substitutions/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const gone = await db.delete(substitutions).where(eq(substitutions.id, id)).returning({ id: substitutions.id });
    if (!gone.length) throw notFound("Substitution");
    return reply.status(204).send();
  });
}
