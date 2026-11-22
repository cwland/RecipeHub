import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { asc, desc, eq, sql } from "drizzle-orm";
import { appSettings, categories, collectionRecipes, collections, recipeTags, recipes, tags } from "../db/schema.js";
import type { Db } from "../db/index.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idList, idParam } from "../lib/validation.js";
import { cleanTag, refreshSearch } from "../lib/recipes.js";

const label = z.string().trim().min(1, "Give it a name").max(100);

// How categories and collections are listed everywhere: A–Z, Z–A, or your own order (manual)
const SORTS = ["az", "za", "manual"] as const;
type Sort = (typeof SORTS)[number];
type Sorting = { categories: Sort; collections: Sort };
export async function sorting(db: Db): Promise<Sorting> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "organizeSort"));
  return { categories: "manual", collections: "manual", ...((row?.value ?? {}) as Partial<Sorting>) };
}
const orderOf = (sort: Sort, table: typeof categories | typeof collections) =>
  sort === "az" ? [asc(sql`lower(${table.name})`)] : sort === "za" ? [desc(sql`lower(${table.name})`)] : [asc(table.sortOrder), asc(table.name)];
const optionalText = z.string().trim().max(2000).nullable().optional().transform((v) => (v === undefined ? undefined : v || null));

// Unique names: a clear message instead of a database error
async function uniqueName<T>(fn: () => Promise<T>, what: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    if (err.code === "23505" || err.cause?.code === "23505") throw new HttpError(409, `There's already a ${what} with that name`);
    throw e;
  }
}

export default async function organizeRoutes(app: FastifyInstance) {
  const { db } = app;
  // "Sweets" and "sweets" are the same name
  const nameTaken = async (table: typeof categories | typeof collections, name: string, exceptId?: number) => {
    const [row] = await db.select({ id: table.id }).from(table).where(sql`lower(${table.name}) = ${name.toLowerCase()}${exceptId ? sql` and ${table.id} <> ${exceptId}` : sql``}`);
    return !!row;
  };

  // ---------- tags (made by adding them to a recipe) ----------
  app.get("/api/tags", async () =>
    db
      .select({ id: tags.id, name: tags.name, count: sql<number>`(select count(*)::int from recipe_tags rt where rt.tag_id = ${tags.id})` })
      .from(tags)
      .orderBy(asc(tags.name))
  );

  // Rename; renaming onto an existing tag merges the two
  app.patch("/api/tags/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const name = cleanTag(z.object({ name: label }).strict().parse(req.body).name);
    return db.transaction(async (tx) => {
      const [tag] = await tx.select().from(tags).where(eq(tags.id, id));
      if (!tag) throw notFound("Tag");
      const affected = (await tx.select({ id: recipeTags.recipeId }).from(recipeTags).where(eq(recipeTags.tagId, id))).map((r) => r.id);
      const [other] = await tx.select().from(tags).where(eq(tags.name, name));
      let result = { id, name };
      if (other && other.id !== id) {
        await tx.execute(sql`insert into recipe_tags (recipe_id, tag_id) select recipe_id, ${other.id} from recipe_tags where tag_id = ${id} on conflict do nothing`);
        await tx.delete(tags).where(eq(tags.id, id));
        result = { id: other.id, name };
      } else {
        await tx.update(tags).set({ name }).where(eq(tags.id, id));
      }
      await refreshSearch(tx, affected);
      return result;
    });
  });

  app.delete("/api/tags/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const affected = (await db.select({ id: recipeTags.recipeId }).from(recipeTags).where(eq(recipeTags.tagId, id))).map((r) => r.id);
    const gone = await db.delete(tags).where(eq(tags.id, id)).returning({ id: tags.id });
    if (!gone.length) throw notFound("Tag");
    await refreshSearch(db, affected);
    return reply.status(204).send();
  });

  // ---------- categories ----------
  app.get("/api/categories", async () =>
    db
      .select({ id: categories.id, name: categories.name, count: sql<number>`(select count(*)::int from recipe_categories rc where rc.category_id = ${categories.id})` })
      .from(categories)
      .orderBy(...orderOf((await sorting(db)).categories, categories))
  );

  app.get("/api/organize/sort", async () => sorting(db));
  app.put("/api/organize/sort", async (req) => {
    const change = z.object({ categories: z.enum(SORTS), collections: z.enum(SORTS) }).partial().strict().parse(req.body);
    const value = { ...(await sorting(db)), ...change };
    await db.insert(appSettings).values({ key: "organizeSort", value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    return value;
  });

  app.post("/api/categories", async (req, reply) => {
    const { name } = z.object({ name: label }).strict().parse(req.body);
    if (await nameTaken(categories, name)) throw new HttpError(409, `There's already a category called ${name}`);
    const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${categories.sortOrder}), -1) + 1` }).from(categories);
    const [row] = await uniqueName(() => db.insert(categories).values({ name, sortOrder: Number(n) }).returning({ id: categories.id, name: categories.name }), "category");
    return reply.status(201).send({ ...row, count: 0 });
  });

  app.patch("/api/categories/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const { name } = z.object({ name: label }).strict().parse(req.body);
    if (await nameTaken(categories, name, id)) throw new HttpError(409, `There's already a category called ${name}`);
    const [row] = await uniqueName(() => db.update(categories).set({ name }).where(eq(categories.id, id)).returning({ id: categories.id, name: categories.name }), "category");
    if (!row) throw notFound("Category");
    return row;
  });

  app.delete("/api/categories/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const gone = await db.delete(categories).where(eq(categories.id, id)).returning({ id: categories.id });
    if (!gone.length) throw notFound("Category");
    return reply.status(204).send();
  });

  app.put("/api/categories/order", async (req) => {
    const { ids } = idList.parse(req.body);
    await db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) await tx.update(categories).set({ sortOrder: i }).where(eq(categories.id, id));
    });
    return { ok: true };
  });

  // ---------- collections ----------
  app.get("/api/collections", async () =>
    db
      .select({
        id: collections.id,
        name: collections.name,
        description: collections.description,
        count: sql<number>`(select count(*)::int from collection_recipes cr where cr.collection_id = ${collections.id})`,
        // the first few recipe photos, for the collection's cover
        images: sql<string[]>`coalesce((select array_agg(x.image_url) from (select r.image_url from collection_recipes cr join recipes r on r.id = cr.recipe_id where cr.collection_id = ${collections.id} and r.image_url is not null order by cr.position limit 4) x), '{}')`,
      })
      .from(collections)
      .orderBy(...orderOf((await sorting(db)).collections, collections))
  );

  app.post("/api/collections", async (req, reply) => {
    const body = z.object({ name: label, description: optionalText }).strict().parse(req.body);
    if (await nameTaken(collections, body.name)) throw new HttpError(409, `There's already a collection called ${body.name}`);
    const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${collections.sortOrder}), -1) + 1` }).from(collections);
    const [row] = await uniqueName(() => db.insert(collections).values({ ...body, sortOrder: Number(n) }).returning({ id: collections.id, name: collections.name, description: collections.description }), "collection");
    return reply.status(201).send({ ...row, count: 0, images: [] });
  });

  app.patch("/api/collections/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ name: label.optional(), description: optionalText }).strict().parse(req.body);
    if (body.name && (await nameTaken(collections, body.name, id))) throw new HttpError(409, `There's already a collection called ${body.name}`);
    const [row] = await uniqueName(() => db.update(collections).set(body).where(eq(collections.id, id)).returning({ id: collections.id, name: collections.name, description: collections.description }), "collection");
    if (!row) throw notFound("Collection");
    return row;
  });

  app.delete("/api/collections/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const gone = await db.delete(collections).where(eq(collections.id, id)).returning({ id: collections.id });
    if (!gone.length) throw notFound("Collection");
    return reply.status(204).send();
  });

  app.put("/api/collections/order", async (req) => {
    const { ids } = idList.parse(req.body);
    await db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) await tx.update(collections).set({ sortOrder: i }).where(eq(collections.id, id));
    });
    return { ok: true };
  });

  // Add a recipe (at the end), take one out, or put them in a new order
  app.post("/api/collections/:id/recipes", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { recipeId } = z.object({ recipeId: z.number().int().positive() }).strict().parse(req.body);
    const [c] = await db.select({ id: collections.id }).from(collections).where(eq(collections.id, id));
    if (!c) throw notFound("Collection");
    const [r] = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, recipeId));
    if (!r) throw notFound("Recipe");
    const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${collectionRecipes.position}), -1) + 1` }).from(collectionRecipes).where(eq(collectionRecipes.collectionId, id));
    await db.insert(collectionRecipes).values({ collectionId: id, recipeId, position: Number(n) }).onConflictDoNothing();
    return reply.status(201).send({ ok: true });
  });

  app.delete("/api/collections/:id/recipes/:recipeId", async (req, reply) => {
    const { id, recipeId } = z.object({ id: z.coerce.number().int().positive(), recipeId: z.coerce.number().int().positive() }).parse(req.params);
    await db.delete(collectionRecipes).where(sql`${collectionRecipes.collectionId} = ${id} and ${collectionRecipes.recipeId} = ${recipeId}`);
    return reply.status(204).send();
  });

  app.put("/api/collections/:id/recipes/order", async (req) => {
    const { id } = idParam.parse(req.params);
    const { ids } = idList.parse(req.body);
    await db.transaction(async (tx) => {
      for (const [i, recipeId] of ids.entries())
        await tx.update(collectionRecipes).set({ position: i }).where(sql`${collectionRecipes.collectionId} = ${id} and ${collectionRecipes.recipeId} = ${recipeId}`);
    });
    return { ok: true };
  });
}
