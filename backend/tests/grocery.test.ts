import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestApp, type TestApp } from "./helpers.js";
import { guessAisle, itemKey, sameItem, splitLine, tidy, weekListName } from "../src/lib/grocery.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
let listId: number;
beforeEach(async () => {
  await t.reset();
  await t.login();
  listId = (await t.api("GET", "/api/grocery/lists")).body[0].id;
});

const items = async (id = listId) => (await t.api("GET", `/api/grocery/lists/${id}/items`)).body;
const add = (body: object, id = listId) => t.api("POST", `/api/grocery/lists/${id}/items`, body);

describe("aisles and matching", () => {
  it("sorts items into store aisles by their words", () => {
    expect(["2 lb boneless chicken thighs", "yellow onions", "frozen peas", "heavy cream", "kosher salt", "paper towels", "sourdough loaf", "olive oil", "sparkling water", "mystery thing"].map(guessAisle)).toEqual([
      "meat", "produce", "frozen", "dairy", "spices", "household", "bakery", "pantry", "beverages", "other",
    ]);
  });
  it("knows the same thing written differently", () => {
    expect(itemKey("Large Yellow Onions, diced")).toBe("onion");
    expect(itemKey("fresh tomatoes")).toBe("tomato");
    expect(sameItem("extra-virgin olive oil", "olive oil")).toBe(true);
    expect(sameItem("chicken stock", "chicken breast")).toBe(false);
    expect(sameItem("eggs", "egg")).toBe(true);
  });
});

describe("weekly lists", () => {
  it("names the list after this week's Monday", () => {
    expect(weekListName(new Date(2026, 10, 16, 9))).toBe("Week of November 16"); // Monday
    expect(weekListName(new Date(2026, 10, 22, 23))).toBe("Week of November 16"); // Sunday
    expect(weekListName(new Date(2026, 10, 23, 0, 30))).toBe("Week of November 23");
    expect(weekListName(new Date(2027, 0, 1))).toBe("Week of December 28"); // crosses the year
  });
});

describe("typing and amounts", () => {
  it("splits a typed line into things, keeping prep notes with their item", () => {
    expect(splitLine("eggs, 2 lb chicken thighs, milk")).toEqual(["eggs", "2 lb chicken thighs", "milk"]);
    expect(splitLine("1 onion, finely diced, 2 cups rice")).toEqual(["1 onion, finely diced", "2 cups rice"]);
    expect(splitLine("butter, softened")).toEqual(["butter, softened"]);
    expect(splitLine("milk, bread, and bananas")).toEqual(["milk", "bread", "bananas"]);
  });
  it("moves up to a bigger unit once amounts add up", () => {
    expect(tidy(35, "tbsp")).toEqual({ quantity: 2.19, unit: "cup" });
    expect(tidy(24, "oz")).toEqual({ quantity: 1.5, unit: "lb" });
    expect(tidy(3, "tbsp")).toEqual({ quantity: 3, unit: "tbsp" });
    expect(tidy(1500, "g")).toEqual({ quantity: 1.5, unit: "kg" });
  });
});

describe("grocery list", () => {
  it("counts what's left on each list", async () => {
    await add({ text: "eggs, milk, 2 lb chicken" });
    const costco = (await t.api("POST", "/api/grocery/lists", { name: "Costco" })).body;
    await add({ text: "paper towels" }, costco.id);
    expect((await t.api("GET", "/api/grocery/lists")).body.map((l: any) => [l.name, l.open])).toEqual([["Groceries", 3], ["Costco", 1]]);
  });


  it("adds typed items, sorted by aisle, and adds the same thing up", async () => {
    await add({ text: "2 cups flour\n3 eggs\nmilk, bread, and bananas" });
    const first = await items();
    expect(first.map((i: any) => [i.name, i.quantity, i.unit, i.aisle])).toEqual([
      ["bananas", null, null, "produce"],
      ["eggs", 3, null, "dairy"],
      ["milk", null, null, "dairy"],
      ["bread", null, null, "bakery"],
      ["flour", 2, "cup", "pantry"],
    ]);
    const r = await add({ items: [{ name: "flour", quantity: 4, unit: "tbsp" }, { name: "egg", quantity: 2 }] });
    expect(r.body).toMatchObject({ added: 0, merged: 2 });
    const after = await items();
    expect(after.find((i: any) => i.name === "flour")).toMatchObject({ quantity: 2.25, unit: "cup" });
    expect(after.find((i: any) => i.name === "eggs").quantity).toBe(5);
  });

  it("checks off, moves, and clears into the pantry", async () => {
    await add({ text: "2 lb chicken thighs\n1 cup rice" });
    const list = await items();
    const rice = list.find((i: any) => i.name === "rice");
    const chicken = list.find((i: any) => i.name === "chicken thighs");
    expect((await t.api("PATCH", `/api/grocery/items/${chicken.id}`, { checked: true })).body.checked).toBe(true);
    expect((await items()).map((i: any) => i.name)).toEqual(["rice", "chicken thighs"]); // checked go last
    // a checked item isn't topped up: a new line is made
    await add({ text: "1 lb chicken thighs" });
    expect((await items()).filter((i: any) => i.name === "chicken thighs")).toHaveLength(2);
    // choose its aisle yourself
    expect((await t.api("PATCH", `/api/grocery/items/${rice.id}`, { aisle: "other" })).body).toMatchObject({ aisle: "other", aisleBy: "you" });
    expect((await t.api("POST", `/api/grocery/lists/${listId}/clear-checked`, { toPantry: true })).body).toEqual({ removed: 1 });
    expect((await t.api("GET", "/api/pantry")).body.map((p: any) => [p.name, p.quantity, p.unit])).toEqual([["chicken thighs", 2, "lb"]]);
  });

  it("several lists, each with its own items", async () => {
    const costco = (await t.api("POST", "/api/grocery/lists", { name: "Costco" })).body;
    await add({ name: "paper towels" }, costco.id);
    expect((await items(costco.id)).map((i: any) => i.name)).toEqual(["paper towels"]);
    expect(await items()).toEqual([]);
  });
});

describe("bulk delete and archived lists", () => {
  const archive = (id: number) => t.db.execute(sql`update grocery_lists set archived_at = now() where id = ${id}`);

  it("deletes several items at once", async () => {
    await add({ text: "eggs, milk, bread" });
    const ids = (await items()).filter((i: any) => i.name !== "bread").map((i: any) => i.id);
    expect((await t.api("POST", "/api/grocery/items/delete", { ids })).body).toEqual({ deleted: 2 });
    expect((await items()).map((i: any) => i.name)).toEqual(["bread"]);
  });

  it("bulk delete is all or nothing", async () => {
    await add({ text: "eggs, milk" });
    const costco = (await t.api("POST", "/api/grocery/lists", { name: "Costco" })).body;
    await add({ text: "paper towels" }, costco.id);
    const mine = (await items()).map((i: any) => i.id);
    expect((await t.api("POST", "/api/grocery/items/delete", { ids: [...mine, 999999] })).status).toBe(404);
    expect(await items()).toHaveLength(2);
    const theirs = (await items(costco.id)).map((i: any) => i.id);
    expect((await t.api("POST", "/api/grocery/items/delete", { ids: [mine[0], ...theirs] })).body).toEqual({ deleted: 2 });
  });

  it("archived lists can be read but not changed", async () => {
    await add({ text: "eggs" });
    const old = (await t.api("POST", "/api/grocery/lists", { name: "Last week" })).body;
    await add({ text: "milk" }, old.id);
    const milk = (await items(old.id))[0];
    const eggs = (await items())[0];
    await archive(old.id);
    expect((await t.api("GET", `/api/grocery/lists/${old.id}/items`)).status).toBe(200);
    expect((await t.api("GET", "/api/grocery/lists")).body.map((l: any) => l.name)).toEqual(["Groceries"]);
    expect((await add({ text: "bread" }, old.id)).status).toBe(409);
    expect((await t.api("PATCH", `/api/grocery/items/${milk.id}`, { checked: true })).status).toBe(409);
    expect((await t.api("DELETE", `/api/grocery/items/${milk.id}`)).status).toBe(409);
    expect((await t.api("POST", "/api/grocery/items/delete", { ids: [eggs.id, milk.id] })).status).toBe(409);
    expect((await t.api("POST", `/api/grocery/lists/${old.id}/clear-checked`, {})).status).toBe(409);
    expect((await t.api("PATCH", `/api/grocery/items/${eggs.id}`, { listId: old.id })).status).toBe(409);
    expect((await items()).map((i: any) => i.name)).toEqual(["eggs"]);
  });

  it("active lists have different names; archived ones may repeat", async () => {
    const r = await t.api("POST", "/api/grocery/lists", { name: " groceries " });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('There\'s already a list called "Groceries"');
    const costco = (await t.api("POST", "/api/grocery/lists", { name: "Costco" })).body;
    expect((await t.api("PATCH", `/api/grocery/lists/${costco.id}`, { name: "GROCERIES" })).status).toBe(409);
    expect((await t.api("PATCH", `/api/grocery/lists/${costco.id}`, { name: "costco" })).status).toBe(200); // its own name, new capitals
    await archive(listId);
    expect((await t.api("POST", "/api/grocery/lists", { name: "Groceries" })).status).toBe(201);
  });
});

describe("archiving and weekly lists", () => {
  it("archives a list as is and lists it under archived", async () => {
    await add({ text: "eggs, milk" });
    const eggs = (await items()).find((i: any) => i.name === "eggs");
    await t.api("PATCH", `/api/grocery/items/${eggs.id}`, { checked: true });
    const r = await t.api("POST", `/api/grocery/lists/${listId}/archive`);
    expect(r.status).toBe(200);
    expect(r.body.archivedAt).toBeTruthy();
    expect((await t.api("GET", "/api/grocery/lists")).body).toEqual([]);
    const archived = (await t.api("GET", "/api/grocery/lists?archived=1")).body;
    expect(archived.map((l: any) => [l.name, l.open, l.done])).toEqual([["Groceries", 1, 1]]);
    expect((await t.api("POST", `/api/grocery/lists/${listId}/archive`)).status).toBe(409);
  });

  it("lists archived lists newest first", async () => {
    const b = (await t.api("POST", "/api/grocery/lists", { name: "B" })).body;
    await t.api("POST", `/api/grocery/lists/${listId}/archive`);
    await t.api("POST", `/api/grocery/lists/${b.id}/archive`);
    expect((await t.api("GET", "/api/grocery/lists?archived=1")).body.map((l: any) => l.name)).toEqual(["B", "Groceries"]);
  });

  it("brings chosen items forward onto a current or a new list", async () => {
    await add({ text: "2 lb chicken, rice" });
    const list = await items();
    const c = list.find((i: any) => i.name === "chicken");
    await t.api("PATCH", `/api/grocery/items/${c.id}`, { checked: true });
    await t.api("POST", `/api/grocery/lists/${listId}/archive`);
    const now = (await t.api("POST", "/api/grocery/lists", { name: "This week" })).body;
    const r = await t.api("POST", `/api/grocery/lists/${listId}/bring-forward`, { itemIds: [c.id], listId: now.id });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ listId: now.id, added: 1, merged: 0 });
    expect((await items(now.id)).map((i: any) => [i.name, i.quantity, i.unit, i.checked])).toEqual([["chicken", 2, "lb", false]]);
    // the same again adds up instead of a second line
    expect((await t.api("POST", `/api/grocery/lists/${listId}/bring-forward`, { itemIds: [c.id], listId: now.id })).body).toMatchObject({ merged: 1 });
    expect((await items(now.id))[0].quantity).toBe(4);
    // onto a new list
    const n = await t.api("POST", `/api/grocery/lists/${listId}/bring-forward`, { itemIds: list.map((i: any) => i.id), name: "Costco" });
    expect(n.body.added).toBe(2);
    expect((await t.api("GET", "/api/grocery/lists")).body.map((l: any) => l.name)).toEqual(["This week", "Costco"]);
    // the archived list is unchanged
    expect(await items()).toHaveLength(2);
    // only that list's items; a taken name is refused
    expect((await t.api("POST", `/api/grocery/lists/${now.id}/bring-forward`, { itemIds: [c.id], listId: now.id })).status).toBe(400);
    expect((await t.api("POST", `/api/grocery/lists/${listId}/bring-forward`, { itemIds: [c.id], name: "costco" })).status).toBe(409);
  });

  it("the last list can be deleted", async () => {
    expect((await t.api("DELETE", `/api/grocery/lists/${listId}`)).status).toBe(204);
    expect((await t.api("GET", "/api/grocery/lists")).body).toEqual([]);
  });

  it("Home Assistant adds to this week's list", async () => {
    const key = (await t.api("POST", "/api/keys", { name: "ha", access: "grocery_write" })).body.key;
    const week = weekListName();
    expect((await t.api("GET", "/api/grocery/this-week")).body).toEqual({ name: week, listId: null });
    const me = t.getToken();
    t.setToken("");
    const first = await t.api("POST", "/api/grocery/items", { text: "milk" }, { "x-api-key": key });
    expect(first.body).toMatchObject({ added: 1 });
    expect(first.body.listId).not.toBe(listId);
    expect((await t.api("POST", "/api/grocery/items", { text: "eggs" }, { "x-api-key": key })).body.listId).toBe(first.body.listId);
    expect((await t.api("GET", `/api/grocery/lists/${listId}/items`, undefined, { "x-api-key": key })).status).toBe(403); // write only
    t.setToken(me);
    expect((await t.api("GET", "/api/grocery/this-week")).body).toEqual({ name: week, listId: first.body.listId });
    const names = (await t.api("GET", "/api/grocery/lists")).body.map((l: any) => l.name);
    expect(names).toEqual(["Groceries", week]);
    // archived: the next add starts a fresh list with the same name
    await t.api("POST", `/api/grocery/lists/${first.body.listId}/archive`);
    t.setToken("");
    const again = await t.api("POST", "/api/grocery/items", { text: "bread" }, { "x-api-key": key });
    expect(again.body.listId).not.toBe(first.body.listId);
  });

  it("adds arriving together make one week list, not two", async () => {
    const r = await Promise.all(["milk", "eggs", "bread", "butter"].map((text) => t.api("POST", "/api/grocery/items", { text })));
    expect(r.map((x) => x.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(r.map((x) => x.body.listId)).size).toBe(1);
    expect((await t.api("GET", "/api/grocery/lists")).body.filter((l: any) => l.name === weekListName())).toHaveLength(1);
  });

  it("the same name twice at once: one list, one friendly refusal", async () => {
    const r = await Promise.all([1, 2, 3].map(() => t.api("POST", "/api/grocery/lists", { name: "Costco" })));
    expect(r.map((x) => x.status).sort()).toEqual([201, 409, 409]);
    expect(r.find((x) => x.status === 409)!.body.error).toBe('There\'s already a list called "Costco"');
  });

  it("archiving the only list, then Home Assistant adds: this week's list is made", async () => {
    await t.api("POST", `/api/grocery/lists/${listId}/archive`);
    expect((await t.api("GET", "/api/grocery/lists")).body).toEqual([]);
    await t.api("POST", "/api/grocery/items", { text: "milk" });
    expect((await t.api("GET", "/api/grocery/lists")).body.map((l: any) => l.name)).toEqual([weekListName()]);
  });

  it("uses a list you renamed to this week's name", async () => {
    const costco = (await t.api("POST", "/api/grocery/lists", { name: "Costco" })).body;
    await t.api("PATCH", `/api/grocery/lists/${costco.id}`, { name: weekListName() });
    expect((await t.api("POST", "/api/grocery/items", { text: "milk" })).body.listId).toBe(costco.id);
  });
});

describe("recipes onto the list", () => {
  it("adds up what the planned recipes need, and shows what the pantry has", async () => {
    const chili = (await t.api("POST", "/api/recipes", { title: "Chili", servings: 4, ingredients: "1 lb ground beef\n1 onion, diced\n2 tbsp chili powder\nsalt" })).body;
    const tacos = (await t.api("POST", "/api/recipes", { title: "Tacos", servings: 2, ingredients: "1/2 lb ground beef\n1 onion\n8 tortillas" })).body;
    await t.api("POST", "/api/pantry", { text: "chili powder" });
    await t.api("POST", "/api/pantry", { name: "salt", staple: true });
    await t.api("POST", "/api/plan", { date: "2026-11-02", slot: "dinner", recipeId: chili.id, servings: 8 });
    await t.api("POST", "/api/plan", { date: "2026-11-03", slot: "dinner", recipeId: tacos.id });
    const p = (await t.api("POST", "/api/grocery/preview", { from: "2026-11-02", to: "2026-11-08" })).body;
    expect(p.recipes).toBe(2);
    const by = (n: string) => p.lines.find((l: any) => l.name === n);
    expect(by("ground beef")).toMatchObject({ quantity: 2.5, unit: "lb", aisle: "meat", pantry: null });
    expect(by("ground beef").sources.map((s: any) => s.title)).toEqual(["Chili", "Tacos"]);
    expect(by("onion")).toMatchObject({ quantity: 3 });
    expect(by("chili powder")).toMatchObject({ quantity: 4, pantry: { name: "chili powder", staple: false } });
    expect(by("salt").pantry).toMatchObject({ staple: true });
    // the app sends what you kept ticked
    const keep = p.lines.filter((l: any) => !l.pantry).map(({ name, quantity, unit, sources }: any) => ({ name, quantity, unit, sources }));
    await add({ items: keep });
    expect((await items()).map((i: any) => i.name).sort()).toEqual(["ground beef", "onion", "tortillas"]);
    expect((await items()).find((i: any) => i.name === "ground beef").sources).toHaveLength(2);
  });

  it("one recipe at a chosen size", async () => {
    const r = (await t.api("POST", "/api/recipes", { title: "Pancakes", servings: 4, ingredients: "2 cups flour\n2 eggs" })).body;
    const p = (await t.api("POST", "/api/grocery/preview", { recipes: [{ recipeId: r.id, servings: 2 }] })).body;
    expect(p.lines.map((l: any) => [l.name, l.quantity])).toEqual([["flour", 1], ["eggs", 1]]);
  });

  it("a recipe with no serving count, scaled (2× as many cookies): twice the amounts", async () => {
    const r = (await t.api("POST", "/api/recipes", { title: "Cookies", yieldText: "24 cookies", ingredients: "2 cups flour\n1 egg" })).body;
    const p = (await t.api("POST", "/api/grocery/preview", { recipes: [{ recipeId: r.id, scale: 2 }] })).body;
    expect(p.lines.map((l: any) => [l.name, l.quantity])).toEqual([["flour", 4], ["egg", 2]]);
  });
});

describe("pantry", () => {
  it("adds, tops up, marks staples, and finds what you can cook", async () => {
    await t.api("POST", "/api/pantry", { text: "2 cups rice\neggs" });
    await t.api("POST", "/api/pantry", { text: "1 cup rice" });
    const pantry = (await t.api("GET", "/api/pantry")).body;
    expect(pantry.find((p: any) => p.name === "rice")).toMatchObject({ quantity: 3, unit: "cup" });
    await t.api("PATCH", `/api/pantry/${pantry[0].id}`, { expiresOn: "2026-11-10", staple: true });
    await t.api("POST", "/api/recipes", { title: "Fried rice", ingredients: "2 cups cooked rice\n2 eggs\nsoy sauce" });
    await t.api("POST", "/api/recipes", { title: "Steak", ingredients: "1 steak\nbutter\nthyme" });
    const can = (await t.api("GET", "/api/recipes/cookable")).body;
    expect(can.map((r: any) => [r.title, r.have, r.of, r.missing])).toEqual([["Fried rice", 2, 3, ["soy sauce"]]]);
    expect((await t.api("POST", "/api/pantry/remove", { ids: pantry.map((p: any) => p.id) })).body.removed).toBe(2);
  });
});

describe("live updates", () => {
  it("tells every open app what changed, and who changed it", async () => {
    const heard: any[] = [];
    const off = t.app.events.on((e) => heard.push(e));
    await add({ text: "milk" });
    await t.api("POST", "/api/pantry", { text: "eggs" });
    await t.api("POST", "/api/plan", { date: "2026-11-02", slot: "dinner", title: "Pizza night" });
    off();
    expect(heard).toEqual([{ topic: "grocery", id: listId, by: 1 }, { topic: "pantry", by: 1, id: undefined }, { topic: "plan", by: 1 }]);
  });

  it("streams them to signed-in apps", async () => {
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (t.app.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { authorization: `Bearer ${t.getToken()}` } });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    await reader.read(); // retry:
    t.app.events.emit({ topic: "grocery", id: 5, by: 2 });
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe('data: {"topic":"grocery","id":5,"by":2}\n\n');
    await reader.cancel();
    expect((await fetch(`http://127.0.0.1:${port}/api/events`)).status).toBe(401);
  });
});

describe("adding up across recipes", () => {
  it("pounds and ounces of the same thing become one line", async () => {
    const a = (await t.api("POST", "/api/recipes", { title: "Meatloaf", ingredients: "1 lb ground beef" })).body;
    const b = (await t.api("POST", "/api/recipes", { title: "Tacos", ingredients: "8 oz ground beef" })).body;
    const lines = (await t.api("POST", "/api/grocery/preview", { recipes: [{ recipeId: a.id }, { recipeId: b.id }] })).body.lines;
    expect(lines.map((l: any) => [l.name, l.quantity, l.unit])).toEqual([["ground beef", 1.5, "lb"]]);
  });
  it("a range in a recipe buys the larger amount", async () => {
    const r = (await t.api("POST", "/api/recipes", { title: "Soup", ingredients: "2-3 carrots" })).body;
    const lines = (await t.api("POST", "/api/grocery/preview", { recipes: [{ recipeId: r.id }] })).body.lines;
    expect(lines[0]).toMatchObject({ name: "carrots", quantity: 3 });
  });
  it("salt and pepper to taste isn't one weird item", async () => {
    const r = (await t.api("POST", "/api/recipes", { title: "Eggs", ingredients: "4 eggs\nSalt and pepper to taste" })).body;
    const lines = (await t.api("POST", "/api/grocery/preview", { recipes: [{ recipeId: r.id }] })).body.lines;
    expect(lines.map((l: any) => l.name).sort()).toEqual(["eggs", "pepper", "salt"]);
  });
});
