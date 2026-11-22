import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { isOn } from "./features.js";
import {
  categories,
  jobs,
  collectionRecipes,
  collections,
  recipeCategories,
  recipeTags,
  recipeUser,
  recipes,
  substitutions,
  tags,
  type Ingredient,
  type Step,
} from "../db/schema.js";
import { parseIngredient } from "./ingredients.js";
import { notFound } from "./errors.js";

export type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

// ---------- input ----------

const text = (max: number, what = "This") =>
  z
    .string()
    .trim()
    .max(max, `${what} is too long (${max} characters at most)`)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));
const minutes = z.coerce.number({ error: "Minutes should be a number" }).min(0).max(100000).transform(Math.round).nullable().optional();
// "allrecipes.com/recipe/1" is a link too: https:// is added
export const withScheme = (v: string) => (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith("/") || /\s/.test(v) || !/^[\w-]+(\.[\w-]+)+([/:?#].*)?$/.test(v) ? v : `https://${v}`);
const link = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v ? withScheme(v) : null))
.refine((v) => !v || /^https?:\/\/\S+$/i.test(v) || v.startsWith("/api/"), "That isn't a web address (like https://site.com/page). Names like “Grandma's card” go in Source name.");

// Ingredients: a block of text (one per line), or a list of lines or {raw} / {section} objects
const ingredientList = z.union([
  z.string().max(50000).transform((s) => s.split(/\r?\n/)),
  z.array(z.union([z.string().max(1000), z.object({ raw: z.string().max(1000).optional(), section: z.string().max(200).nullable().optional() })])).max(500),
]);
// Steps: a block of text (blank lines or new lines between steps), or a list of strings or {text} / {section}
const stepList = z.union([
  z.string().max(100000).transform((s) => (/\n\s*\n/.test(s) ? s.split(/\n\s*\n/) : s.split(/\r?\n/))),
  z.array(z.union([z.string().max(10000), z.object({ text: z.string().max(10000).optional(), section: z.string().max(200).nullable().optional() })])).max(300),
]);
// Tags by name; categories and collections by id or name (names are created if new)
const names = z.array(z.string().trim().min(1).max(60)).max(50);
const refs = z.array(z.union([z.number().int().positive(), z.string().trim().min(1).max(100)])).max(50);

// Nutrition per serving (grams; sodium in milligrams)
const amount = z.coerce.number().min(0).max(100000).nullable().default(null);
export const nutritionInput = z
  .object({
    calories: amount,
    fat: amount,
    saturatedFat: amount,
    carbs: amount,
    fiber: amount,
    sugar: amount,
    addedSugar: amount,
    protein: amount,
    sodium: amount,
    source: z.enum(["site", "ai", "you"]).default("you"),
    servings: z.number().int().min(1).max(1000).nullable().optional(),
    servingSize: z.string().trim().max(100).nullable().default(null),
    note: z.string().trim().max(500).nullable().optional(),
    // AI estimates: what each ingredient line came to (whole amount), as Estimate / the AI check send it
    perIngredient: z
      .array(z.object({ line: z.string().trim().min(1).max(200), grams: z.number().min(0).max(1e6).nullable(), calories: z.number().min(0).max(1e6) }).strict())
      .max(100)
      .optional(),
  })
  .strict();

export const recipeFields = {
  title: z.string().trim().min(1, "Give the recipe a name").max(300, "The name is too long (300 characters at most)"),
  description: text(5000, "The description"),
  ingredients: ingredientList.optional(),
  steps: stepList.optional(),
  servings: z.coerce.number({ error: "Servings should be a number" }).min(0.5, "Servings should be at least 1").max(1000).transform((n) => Math.max(1, Math.round(n))).nullable().optional(),
  yieldText: text(100),
  prepMinutes: minutes,
  cookMinutes: minutes,
  totalMinutes: minutes,
  sourceUrl: link,
  sourceName: text(200),
  imageUrl: link,
  notes: text(20000),
  nutrition: nutritionInput.nullable().optional(),
  tags: names.optional(),
  categories: refs.optional(),
  collections: refs.optional(),
};
export const createRecipe = z.object(recipeFields).strict();
export const updateRecipe = z.object({ ...recipeFields, title: recipeFields.title.optional() }).strict();
export type RecipeInput = z.infer<typeof updateRecipe>;

function toIngredients(list: z.infer<typeof ingredientList>): Ingredient[] {
  return list
    .map((x) => (typeof x === "string" ? x.trim() : x))
    .filter((x) => (typeof x === "string" ? x : x.raw?.trim() || x.section?.trim()))
    .map((x) => {
      if (typeof x === "string") return parseIngredient(x);
      if (x.section?.trim()) return { raw: x.section.trim(), section: x.section.trim() };
      return parseIngredient(x.raw!);
    });
}

const stepSection = (s: string) => s.match(/^#{1,6}\s+(.+)$/)?.[1].trim() ?? null;
function toSteps(list: z.infer<typeof stepList>): Step[] {
  return list
    .map((x) => (typeof x === "string" ? { text: x } : x))
    .map((x) => ({ text: (x.text ?? "").replace(/^\s*(?:step\s*)?\d+[.)]\s+/i, "").trim(), section: x.section?.trim() || null }))
    .filter((x) => x.text || x.section)
    .map((x) => {
      const heading = x.section ?? stepSection(x.text);
      return heading ? { text: heading, section: heading } : { text: x.text };
    });
}

// Total time from prep + cook when it isn't given
function times(input: RecipeInput, current?: { prepMinutes: number | null; cookMinutes: number | null; totalMinutes: number | null }) {
  const prep = input.prepMinutes !== undefined ? input.prepMinutes : current?.prepMinutes ?? null;
  const cook = input.cookMinutes !== undefined ? input.cookMinutes : current?.cookMinutes ?? null;
  let total = input.totalMinutes !== undefined ? input.totalMinutes : current?.totalMinutes ?? null;
  if (input.totalMinutes === undefined && (input.prepMinutes !== undefined || input.cookMinutes !== undefined) && (prep || cook)) total = (prep ?? 0) + (cook ?? 0);
  return { prepMinutes: prep, cookMinutes: cook, totalMinutes: total };
}

// ---------- tags, categories, collections ----------

export const cleanTag = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/^#/, "");

async function tagIds(tx: Tx, list: string[]) {
  const wanted = [...new Set(list.map(cleanTag).filter(Boolean))];
  if (!wanted.length) return [];
  await tx.insert(tags).values(wanted.map((name) => ({ name }))).onConflictDoNothing();
  return (await tx.select({ id: tags.id }).from(tags).where(inArray(tags.name, wanted))).map((r) => r.id);
}

// Ids stay ids (unknown ones are skipped); names are matched without case, and created if new
async function refIds(tx: Tx, table: typeof categories | typeof collections, list: (number | string)[]) {
  const ids = new Set<number>();
  const numbers = list.filter((x): x is number => typeof x === "number");
  if (numbers.length) (await tx.select({ id: table.id }).from(table).where(inArray(table.id, numbers))).forEach((r) => ids.add(r.id));
  for (const name of list.filter((x): x is string => typeof x === "string")) {
    const [found] = await tx.select({ id: table.id }).from(table).where(sql`lower(${table.name}) = ${name.toLowerCase()}`);
    if (found) ids.add(found.id);
    else {
      const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(${table.sortOrder}), -1) + 1` }).from(table);
      const [row] = await tx.insert(table).values({ name, sortOrder: Number(n) }).returning({ id: table.id });
      ids.add(row.id);
    }
  }
  return [...ids];
}

// ---------- search ----------

// Rebuild the search document for some recipes (or all): title first, then tags and ingredients,
// then the description, notes and source. Each part goes in twice: as written ('simple', for
// matching the start of words: "chick" finds chicken but "kids" doesn't find kidney) and stemmed
// ('english', so "tomatoes" finds tomato).
export async function refreshSearch(tx: Tx, ids?: number[]) {
  if (ids && !ids.length) return;
  const parts = [
    [sql`coalesce(r.title, '')`, "A"],
    [sql`coalesce((select string_agg(t.name, ' ') from recipe_tags rt join tags t on t.id = rt.tag_id where rt.recipe_id = r.id), '')`, "B"],
    [sql`coalesce((select string_agg(coalesce(i->>'name', i->>'raw'), ' ') from jsonb_array_elements(r.ingredients) i where i->>'section' is null), '')`, "B"],
    [sql`coalesce(r.description, '') || ' ' || coalesce(r.notes, '') || ' ' || coalesce(r.source_name, '')`, "C"],
  ] as const;
  const vector = sql.join(
    parts.flatMap(([text, weight]) => [sql`setweight(to_tsvector('simple', ${text}), ${weight})`, sql`setweight(to_tsvector('english', ${text}), ${weight})`]),
    sql` || `
  );
  await tx.execute(sql`update recipes r set search_vector = ${vector} ${ids ? sql`where r.id in ${ids}` : sql``}`);
}

// "chick parm" -> each word as typed, as the start of a word: chick:* & parm:*
const words = (q: string) =>
  q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 10);
export function searchQuery(q: string): string | null {
  const w = words(q);
  return w.length ? w.map((x) => `${x}:*`).join(" & ") : null;
}
// ...or each whole word, stemmed ("tomatoes" -> tomato)
const wholeWords = (q: string) => words(q).join(" & ");

// ---------- save ----------

export async function saveRecipe(db: Tx, id: number | null, input: RecipeInput, userId: number | null) {
  return db.transaction(async (tx) => {
    const [current] = id ? await tx.select().from(recipes).where(eq(recipes.id, id)) : [];
    if (id && !current) throw notFound("Recipe");
    const values = {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.ingredients !== undefined && { ingredients: toIngredients(input.ingredients) }),
      ...(input.steps !== undefined && { steps: toSteps(input.steps) }),
      ...(input.servings !== undefined && { servings: input.servings }),
      ...(input.yieldText !== undefined && { yieldText: input.yieldText }),
      ...(input.sourceUrl !== undefined && { sourceUrl: input.sourceUrl }),
      ...(input.sourceName !== undefined && { sourceName: input.sourceName }),
      ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.nutrition !== undefined && { nutrition: input.nutrition }),
      ...times(input, current),
    };
    let recipeId: number;
    if (current) {
      await tx.update(recipes).set({ ...values, updatedAt: new Date() }).where(eq(recipes.id, current.id));
      recipeId = current.id;
    } else {
      const [row] = await tx.insert(recipes).values({ title: input.title!, ...values, createdBy: userId }).returning({ id: recipes.id });
      recipeId = row.id;
    }
    if (input.tags) {
      const ids = await tagIds(tx, input.tags);
      await tx.delete(recipeTags).where(eq(recipeTags.recipeId, recipeId));
      if (ids.length) await tx.insert(recipeTags).values(ids.map((tagId) => ({ recipeId, tagId })));
    }
    if (input.categories) {
      const ids = await refIds(tx, categories, input.categories);
      await tx.delete(recipeCategories).where(eq(recipeCategories.recipeId, recipeId));
      if (ids.length) await tx.insert(recipeCategories).values(ids.map((categoryId) => ({ recipeId, categoryId })));
    }
    if (input.collections) {
      const ids = await refIds(tx, collections, input.collections);
      // Collections it's already in keep their place; new ones get it at the end
      await tx.delete(collectionRecipes).where(and(eq(collectionRecipes.recipeId, recipeId), ids.length ? sql`${collectionRecipes.collectionId} not in ${ids}` : undefined));
      for (const collectionId of ids) {
        const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(${collectionRecipes.position}), -1) + 1` }).from(collectionRecipes).where(eq(collectionRecipes.collectionId, collectionId));
        await tx.insert(collectionRecipes).values({ collectionId, recipeId, position: Number(n) }).onConflictDoNothing();
      }
    }
    await refreshSearch(tx, [recipeId]);
    return recipeId;
  });
}

// ---------- read ----------

export async function loadRecipe(db: Db, id: number, userId: number | null) {
  const [r] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!r) throw notFound("Recipe");
  const { searchVector: _sv, ...recipe } = r;
  const tagRows = await db.select({ name: tags.name }).from(recipeTags).innerJoin(tags, eq(tags.id, recipeTags.tagId)).where(eq(recipeTags.recipeId, id)).orderBy(asc(tags.name));
  const cats = await db.select({ id: categories.id, name: categories.name }).from(recipeCategories).innerJoin(categories, eq(categories.id, recipeCategories.categoryId)).where(eq(recipeCategories.recipeId, id)).orderBy(asc(categories.sortOrder), asc(categories.name));
  const cols = await db.select({ id: collections.id, name: collections.name }).from(collectionRecipes).innerJoin(collections, eq(collections.id, collectionRecipes.collectionId)).where(eq(collectionRecipes.recipeId, id)).orderBy(asc(collections.sortOrder), asc(collections.name));
  const [me] = userId ? await db.select().from(recipeUser).where(and(eq(recipeUser.recipeId, id), eq(recipeUser.userId, userId))) : [];
  const [working] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, "nutrition"), inArray(jobs.status, ["queued", "running"]), sql`${jobs.payload}->>'recipeId' = ${String(id)}`))
    .limit(1);
  const subs = await db.select({ id: substitutions.id, kind: substitutions.kind, original: substitutions.original, line: substitutions.line, amount: substitutions.amount, unit: substitutions.unit, item: substitutions.item, replacement: substitutions.replacement, note: substitutions.note, appliedVersion: substitutions.appliedVersion, createdAt: substitutions.createdAt }).from(substitutions).where(eq(substitutions.recipeId, id)).orderBy(desc(substitutions.createdAt), desc(substitutions.id));
  return {
    ...recipe,
    tags: tagRows.map((t) => t.name),
    categories: cats,
    collections: cols,
    me: { favorite: me?.favorite ?? false, pinned: me?.pinned ?? false, rating: me?.rating ?? null, notes: me?.notes ?? null },
    substitutions: subs,
    nutritionUpdating: !!working, // Auto nutrition is working it out right now
    versioning: await isOn(db as Db, "recipeVersions"), // (shows the Version history tab)
  };
}

export const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  tag: z.union([z.string(), z.array(z.string())]).optional(), // every one given must match
  category: z.union([z.literal("none"), z.coerce.number().int()]).optional(), // "none": recipes in no category
  collection: z.coerce.number().int().optional(),
  favorite: z.enum(["true", "false"]).optional(),
  pinned: z.enum(["true", "false"]).optional(),
  sort: z.enum(["recent", "title", "rating", "newest", "relevance", "collection"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  offset: z.coerce.number().int().min(0).default(0),
});

// The recipe box: pinned first, then by the chosen order. Search ranks by relevance unless another order is asked for.
export async function listRecipes(db: Db, userId: number | null, q: z.infer<typeof listQuery>) {
  const me = sql`(select ru.* from recipe_user ru where ru.recipe_id = r.id and ru.user_id = ${userId ?? 0})`;
  const where: SQL[] = [];
  const ts = q.q ? searchQuery(q.q) : null;
  if (ts) {
    // the search document, or your own notes on it
    where.push(sql`(r.search_vector @@ to_tsquery('simple', ${ts}) or r.search_vector @@ to_tsquery('english', ${wholeWords(q.q!)}) or exists (select 1 from recipe_user ru where ru.recipe_id = r.id and ru.user_id = ${userId ?? 0} and ru.notes ilike ${"%" + q.q + "%"}))`);
  }
  const tagList = [q.tag ?? []].flat();
  // tag=none: recipes with no tags
  if (tagList.includes("none")) where.push(sql`not exists (select 1 from recipe_tags rt where rt.recipe_id = r.id)`);
  for (const t of tagList.filter((x) => x !== "none").map(cleanTag).filter(Boolean)) {
    where.push(sql`exists (select 1 from recipe_tags rt join tags t on t.id = rt.tag_id where rt.recipe_id = r.id and t.name = ${t})`);
  }
  if (q.category === "none") where.push(sql`not exists (select 1 from recipe_categories rc where rc.recipe_id = r.id)`);
  else if (q.category) where.push(sql`exists (select 1 from recipe_categories rc where rc.recipe_id = r.id and rc.category_id = ${q.category})`);
  if (q.collection) where.push(sql`exists (select 1 from collection_recipes cr where cr.recipe_id = r.id and cr.collection_id = ${q.collection})`);
  if (q.favorite) where.push(sql`coalesce((select ru.favorite from recipe_user ru where ru.recipe_id = r.id and ru.user_id = ${userId ?? 0}), false) = ${q.favorite === "true"}`);
  if (q.pinned) where.push(sql`coalesce((select ru.pinned from recipe_user ru where ru.recipe_id = r.id and ru.user_id = ${userId ?? 0}), false) = ${q.pinned === "true"}`);
  const whereSql = where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``;

  const sort = q.sort ?? (ts ? "relevance" : q.collection ? "collection" : "recent");
  const order = {
    recent: sql`r.updated_at desc`,
    newest: sql`r.created_at desc`,
    title: sql`lower(r.title) asc`,
    rating: sql`u.rating desc nulls last, lower(r.title) asc`,
    relevance: ts ? sql`ts_rank(r.search_vector, to_tsquery('simple', ${ts})) desc, r.updated_at desc` : sql`r.updated_at desc`,
    collection: q.collection ? sql`(select cr.position from collection_recipes cr where cr.recipe_id = r.id and cr.collection_id = ${q.collection}) asc` : sql`r.updated_at desc`,
  }[sort];

  const rows = await db.execute(sql`
    select r.id, r.title, r.description, r.image_url as "imageUrl", r.servings, r.yield_text as "yieldText",
      r.total_minutes as "totalMinutes", r.source_name as "sourceName", r.updated_at as "updatedAt", r.created_at as "createdAt",
      coalesce(u.favorite, false) as favorite, coalesce(u.pinned, false) as pinned, u.rating,
      coalesce((select array_agg(t.name order by t.name) from recipe_tags rt join tags t on t.id = rt.tag_id where rt.recipe_id = r.id), '{}') as tags,
      count(*) over() as total
    from recipes r
    left join lateral ${me} u on true
    ${whereSql}
    order by coalesce(u.pinned, false) desc, ${order}, r.id desc
    limit ${q.limit} offset ${q.offset}`);
  const list = rows.rows as (Record<string, unknown> & { total: string })[];
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return { total: list.length ? Number(list[0].total) : 0, recipes: list.map(({ total: _t, ...r }) => ({ ...r, updatedAt: iso(r.updatedAt), createdAt: iso(r.createdAt) })) };
}
