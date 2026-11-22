import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const chili = {
  title: "Weeknight Chili",
  description: "Smoky, quick, freezes well.",
  ingredients: "For the chili:\n1 lb ground beef\n1 (15 oz) can kidney beans, drained\n2 tbsp chili powder\nSalt to taste",
  steps: "1. Brown the beef.\n\n2. Add everything else and simmer for 30 minutes.",
  servings: 4,
  prepMinutes: 10,
  cookMinutes: 35,
  tags: ["Weeknight", "#freezer friendly", "weeknight"],
  categories: ["Dinner"],
};
const add = async (body: object) => {
  const r = await t.api("POST", "/api/recipes", body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};
const list = async (q = "") => (await t.api("GET", `/api/recipes${q}`)).body;
const titles = async (q = "") => (await list(q)).recipes.map((r: any) => r.title);

describe("recipes", () => {
  it("adds a recipe from text: ingredients and steps parsed, tags cleaned, total time worked out", async () => {
    const r = await add(chili);
    expect(r.ingredients[0]).toEqual({ raw: "For the chili:", section: "For the chili" });
    expect(r.ingredients[2]).toMatchObject({ quantity: 1, unit: "can", name: "kidney beans", note: "15 oz; drained" });
    expect(r.steps).toEqual([{ text: "Brown the beef." }, { text: "Add everything else and simmer for 30 minutes." }]);
    expect(r.totalMinutes).toBe(45);
    expect(r.tags).toEqual(["freezer friendly", "weeknight"]);
    expect(r.categories.map((c: any) => c.name)).toEqual(["Dinner"]);
    expect(r.me).toEqual({ favorite: false, pinned: false, rating: null, notes: null });
    expect(r.createdBy).toBe(1);
    expect(r.searchVector).toBeUndefined();
  });

  it("needs a name; checks links", async () => {
    expect((await t.api("POST", "/api/recipes", { title: " " })).body.details[0].message).toBe("Give the recipe a name");
    expect((await t.api("POST", "/api/recipes", { title: "x", sourceUrl: "javascript:alert(1)" })).status).toBe(400);
    expect((await t.api("POST", "/api/recipes", { title: "x", nope: 1 })).status).toBe(400);
  });

  it("changes only what's sent; lists of tags and categories replace the old ones", async () => {
    const r = await add(chili);
    const u = (await t.api("PATCH", `/api/recipes/${r.id}`, { title: "Best Chili", tags: ["spicy"], categories: [] })).body;
    expect(u).toMatchObject({ title: "Best Chili", description: chili.description, tags: ["spicy"], categories: [] });
    expect(u.ingredients).toHaveLength(5);
    expect((await t.api("PATCH", "/api/recipes/999", { title: "x" })).status).toBe(404);
  });

  it("duplicates and deletes", async () => {
    const r = await add(chili);
    const copy = (await t.api("POST", `/api/recipes/${r.id}/duplicate`)).body;
    expect(copy).toMatchObject({ title: "Weeknight Chili (copy)", tags: r.tags, servings: 4 });
    expect(copy.ingredients).toEqual(r.ingredients);
    expect((await t.api("DELETE", `/api/recipes/${r.id}`)).status).toBe(204);
    expect((await t.api("GET", `/api/recipes/${r.id}`)).status).toBe(404);
    expect(await titles()).toEqual(["Weeknight Chili (copy)"]);
  });
});

describe("finding recipes", () => {
  beforeEach(async () => {
    await add(chili);
    await add({ title: "Lemon Bars", ingredients: ["1 cup flour", "2 lemons, zested"], tags: ["dessert"], categories: ["Dessert"] });
    await add({ title: "Chicken Parmesan", ingredients: "2 chicken breasts\n1 cup marinara\nparmesan", notes: "Kids love it" });
  });

  it("searches titles, ingredients, tags and notes, matching the start of words", async () => {
    expect(await titles("?q=chick parm")).toEqual(["Chicken Parmesan"]);
    expect(await titles("?q=lemon")).toEqual(["Lemon Bars"]);
    expect(await titles("?q=kidney")).toEqual(["Weeknight Chili"]);
    expect(await titles("?q=freezer")).toEqual(["Weeknight Chili"]);
    expect(await titles("?q=kids")).toEqual(["Chicken Parmesan"]); // not "kidney beans"
    expect(await titles("?q=marinaras")).toEqual(["Chicken Parmesan"]); // whole words match their stem too
    expect(await titles("?q=flour")).toEqual(["Lemon Bars"]);
    expect((await list("?q=zzzz")).total).toBe(0);
    expect((await list("?q=%26%7C!(")).total).toBe(3); // only symbols: no search
  });

  it("filters by tag, category, collection and favorite", async () => {
    expect(await titles("?tag=Dessert")).toEqual(["Lemon Bars"]);
    const cats = (await t.api("GET", "/api/categories")).body;
    const dinner = cats.find((c: any) => c.name === "Dinner");
    expect(dinner.count).toBe(1);
    expect(await titles(`?category=${dinner.id}`)).toEqual(["Weeknight Chili"]);
  });

  it("sorts, pinned first, and pages", async () => {
    expect(await titles("?sort=title")).toEqual(["Chicken Parmesan", "Lemon Bars", "Weeknight Chili"]);
    expect((await list()).recipes[0].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    const bars = (await list("?q=lemon")).recipes[0];
    await t.api("PUT", `/api/recipes/${bars.id}/me`, { pinned: true });
    expect((await titles("?sort=title"))[0]).toBe("Lemon Bars");
    const page = await list("?sort=title&limit=1&offset=1");
    expect([page.total, page.recipes.length]).toEqual([3, 1]);
  });
});

describe("yours: favorites, pins, rating, notes", () => {
  it("saves per person, and searches your notes", async () => {
    const r = await add(chili);
    const me = (await t.api("PUT", `/api/recipes/${r.id}/me`, { favorite: true, rating: 5, notes: "Double the cumin" })).body;
    expect(me).toEqual({ favorite: true, pinned: false, rating: 5, notes: "Double the cumin" });
    expect((await t.api("PUT", `/api/recipes/${r.id}/me`, { rating: null })).body).toMatchObject({ favorite: true, rating: null, notes: "Double the cumin" });
    expect((await t.api("PUT", `/api/recipes/${r.id}/me`, { rating: 6 })).status).toBe(400);
    expect((await t.api("GET", `/api/recipes/${r.id}`)).body.me.favorite).toBe(true);
    expect(await titles("?favorite=true")).toEqual(["Weeknight Chili"]);
    expect(await titles("?q=cumin")).toEqual(["Weeknight Chili"]);
  });

  it("not with an API key (keys aren't a person)", async () => {
    const r = await add(chili);
    const key = (await t.api("POST", "/api/keys", { name: "x", access: "write" })).body.key;
    t.setToken("");
    expect((await t.api("PUT", `/api/recipes/${r.id}/me`, { favorite: true }, { "x-api-key": key })).status).toBe(403);
  });
});

describe("substitutions", () => {
  it("keeps a history, newest first", async () => {
    const r = await add(chili);
    await t.api("POST", `/api/recipes/${r.id}/substitutions`, { original: "ground beef", replacement: "ground turkey" });
    const s = (await t.api("POST", `/api/recipes/${r.id}/substitutions`, { original: "kidney beans", replacement: "black beans", note: "fine" })).body;
    expect((await t.api("GET", `/api/recipes/${r.id}`)).body.substitutions.map((x: any) => x.replacement)).toEqual(["black beans", "ground turkey"]);
    expect((await t.api("DELETE", `/api/substitutions/${s.id}`)).status).toBe(204);
    expect((await t.api("POST", `/api/recipes/${r.id}/substitutions`, { original: "", replacement: "x" })).status).toBe(400);
  });
});

describe("tags, categories, collections", () => {
  it("renaming a tag onto another merges them, and search follows", async () => {
    const a = await add({ title: "A", tags: ["veggie"] });
    await add({ title: "B", tags: ["vegetarian"] });
    const veggie = (await t.api("GET", "/api/tags")).body.find((x: any) => x.name === "veggie");
    expect((await t.api("PATCH", `/api/tags/${veggie.id}`, { name: "Vegetarian" })).body.name).toBe("vegetarian");
    expect((await t.api("GET", "/api/tags")).body).toEqual([{ id: expect.any(Number), name: "vegetarian", count: 2 }]);
    expect(await titles("?q=vegetarian&sort=title")).toEqual(["A", "B"]);
    expect(await titles("?q=veggie")).toEqual([]);
    expect((await t.api("GET", `/api/recipes/${a.id}`)).body.tags).toEqual(["vegetarian"]);
  });

  it("categories: add, rename, order, delete; names are unique", async () => {
    const c = (await t.api("POST", "/api/categories", { name: "Soup" })).body;
    expect((await t.api("POST", "/api/categories", { name: "Soup" })).status).toBe(409);
    await t.api("PATCH", `/api/categories/${c.id}`, { name: "Soups" });
    const ids = (await t.api("GET", "/api/categories")).body.map((x: any) => x.id).reverse();
    await t.api("PUT", "/api/categories/order", { ids });
    expect((await t.api("GET", "/api/categories")).body[0].name).toBe("Soups");
    expect((await t.api("DELETE", `/api/categories/${c.id}`)).status).toBe(204);
  });

  it("collections keep their own order", async () => {
    const quick = (await t.api("POST", "/api/collections", { name: "Quick Meals", description: "Under 30 minutes" })).body;
    const a = await add({ title: "A", collections: ["Quick Meals"], imageUrl: "https://example.com/a.jpg" });
    const b = await add({ title: "B" });
    await t.api("POST", `/api/collections/${quick.id}/recipes`, { recipeId: b.id });
    // a recipe's own list of collections, by name, makes new ones
    await add({ title: "C", collections: [quick.id, "Ninja CREAMi"] });
    expect(await titles(`?collection=${quick.id}`)).toEqual(["A", "B", "C"]);
    const ids = (await list(`?collection=${quick.id}`)).recipes.map((r: any) => r.id).reverse();
    await t.api("PUT", `/api/collections/${quick.id}/recipes/order`, { ids });
    expect(await titles(`?collection=${quick.id}`)).toEqual(["C", "B", "A"]);
    await t.api("DELETE", `/api/collections/${quick.id}/recipes/${b.id}`);
    const cols = (await t.api("GET", "/api/collections")).body;
    expect(cols.map((c: any) => [c.name, c.count])).toEqual([["Quick Meals", 2], ["Ninja CREAMi", 1]]);
    expect(cols[0].images).toEqual(["https://example.com/a.jpg"]);
    // editing a recipe's collections keeps its place in the ones it stays in
    await t.api("PATCH", `/api/recipes/${a.id}`, { collections: [quick.id] });
    expect(await titles(`?collection=${quick.id}`)).toEqual(["C", "A"]);
  });
});

describe("API keys and recipes", () => {
  it("read keys read; recipe push only sends recipes in", async () => {
    const r = await add(chili);
    const read = (await t.api("POST", "/api/keys", { name: "r", access: "read" })).body.key;
    const push = (await t.api("POST", "/api/keys", { name: "p", access: "recipe_push" })).body.key;
    t.setToken("");
    const as = (key: string) => (m: string, url: string, body?: object) => t.api(m, url, body, { "x-api-key": key });
    expect((await as(read)("GET", "/api/recipes")).body.total).toBe(1);
    expect((await as(read)("GET", `/api/recipes/${r.id}`)).body.me.favorite).toBe(false);
    expect((await as(read)("POST", "/api/recipes", { title: "x" })).status).toBe(403);
    const pushed = await as(push)("POST", "/api/recipes", { title: "From Shortcuts", ingredients: ["1 egg"] });
    expect([pushed.status, pushed.body.createdBy]).toEqual([201, null]);
    expect((await as(push)("GET", "/api/recipes")).status).toBe(403);
    expect((await as(push)("DELETE", `/api/recipes/${r.id}`)).status).toBe(403);
  });
});

describe("backups", () => {
  it("round-trips recipes with everything around them, and search works after", async () => {
    const r = await add({ ...chili, collections: ["Freezer"] });
    await t.api("PUT", `/api/recipes/${r.id}/me`, { favorite: true, notes: "mine" });
    await t.api("POST", `/api/recipes/${r.id}/substitutions`, { original: "beef", replacement: "turkey" });
    const login = await t.api("POST", "/api/auth/login", { username: "alex", password: "password123" });
    const file = JSON.parse((await t.app.inject({ method: "GET", url: "/api/export", headers: { authorization: `Bearer ${login.body.token}` } })).body);
    expect(file.data.recipes[0].searchVector).toBeUndefined();
    const before = (await t.api("GET", `/api/recipes/${r.id}`)).body;

    await t.api("DELETE", `/api/recipes/${r.id}`);
    const res = await t.api("POST", "/api/import?confirm=replace", file);
    expect(res.body.counts).toMatchObject({ recipes: 1, recipeTags: 2, collectionRecipes: 1, recipeUser: 1, substitutions: 1, categories: 7 });
    expect((await t.api("GET", `/api/recipes/${r.id}`)).body).toEqual(before);
    expect(await titles("?q=kidney")).toEqual(["Weeknight Chili"]);
    expect((await add({ title: "New" })).id).toBeGreaterThan(r.id);

    // On a server where that person doesn't exist: their own notes are skipped, the rest comes back
    file.data.recipeUser[0].userId = 99;
    file.data.recipes[0].createdBy = 99;
    const other = await t.api("POST", "/api/import?confirm=replace", file);
    expect(other.body.counts).toMatchObject({ recipes: 1, recipeUser: 0 });
    for (const f of fs.readdirSync(t.backupDir)) fs.unlinkSync(`${t.backupDir}/${f}`);
  });
});

describe("what people type", () => {
  it("adds https:// to a bare link and rounds servings", async () => {
    const r = await t.api("POST", "/api/recipes", { title: "Pie", sourceUrl: "allrecipes.com/recipe/12/pie", imageUrl: "images.site.com/pie.jpg", servings: 4.5, prepMinutes: 12.4 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ sourceUrl: "https://allrecipes.com/recipe/12/pie", imageUrl: "https://images.site.com/pie.jpg", servings: 5, prepMinutes: 12 });
    const bad = await t.api("POST", "/api/recipes", { title: "Pie", sourceUrl: "Grandma's card" });
    expect(bad.status).toBe(400);
    expect(bad.body.details[0]).toMatchObject({ path: "sourceUrl", message: expect.stringContaining("Source name") });
  });
  it("a category or collection name can't be used twice, whatever the capitals", async () => {
    expect((await t.api("POST", "/api/categories", { name: "Sweets" })).status).toBe(201);
    const again = await t.api("POST", "/api/categories", { name: "sweets" });
    expect([again.status, again.body.error]).toEqual([409, "There's already a category called sweets"]);
    const lunch = (await t.api("GET", "/api/categories")).body.find((c: any) => c.name === "Lunch");
    expect((await t.api("PATCH", `/api/categories/${lunch.id}`, { name: "SWEETS" })).status).toBe(409);
    expect((await t.api("PATCH", `/api/categories/${lunch.id}`, { name: "lunch" })).status).toBe(200); // its own name, other capitals
    await t.api("POST", "/api/collections", { name: "Holiday" });
    expect((await t.api("POST", "/api/collections", { name: "holiday" })).status).toBe(409);
  });
});

describe("editing keeps what you didn't touch", () => {
  it("changing only the name keeps categories, collections and tags", async () => {
    const col = (await t.api("POST", "/api/collections", { name: "Favorites" })).body;
    const r = (await t.api("POST", "/api/recipes", { title: "Chili", categories: ["Dinner"], collections: [col.id], tags: ["beef"] })).body;
    await t.api("PATCH", `/api/recipes/${r.id}`, { title: "Best Chili" });
    const after = (await t.api("GET", `/api/recipes/${r.id}`)).body;
    expect([after.title, after.categories.map((c: any) => c.name), after.collections.map((c: any) => c.name), after.tags]).toEqual(["Best Chili", ["Dinner"], ["Favorites"], ["beef"]]);
  });
  it("search finds a recipe by an ingredient right after it's edited", async () => {
    const r = (await t.api("POST", "/api/recipes", { title: "Stew", ingredients: "1 lb beef" })).body;
    await t.api("PATCH", `/api/recipes/${r.id}`, { ingredients: "1 lb lamb" });
    expect((await t.api("GET", "/api/recipes?q=lamb")).body.recipes.map((x: any) => x.title)).toEqual(["Stew"]);
    expect((await t.api("GET", "/api/recipes?q=beef")).body.recipes).toHaveLength(0);
  });
});

describe("browsing by category and tag", () => {
  const titles = async (qs: string) => (await t.api("GET", `/api/recipes?${qs}`)).body.recipes.map((r: any) => r.title).sort();
  it("recipes with no category, and with no tags", async () => {
    await t.api("POST", "/api/recipes", { title: "Chili", categories: ["Dinner"], tags: ["beef"] });
    await t.api("POST", "/api/recipes", { title: "Toast" });
    await t.api("POST", "/api/recipes", { title: "Salad", tags: ["quick"] });
    expect(await titles("category=none")).toEqual(["Salad", "Toast"]);
    expect(await titles("tag=none")).toEqual(["Toast"]);
  });
  it("several tags: recipes with all of them", async () => {
    await t.api("POST", "/api/recipes", { title: "Chili", tags: ["beef", "spicy"] });
    await t.api("POST", "/api/recipes", { title: "Burger", tags: ["beef"] });
    expect(await titles("tag=beef&tag=spicy")).toEqual(["Chili"]);
  });
});
