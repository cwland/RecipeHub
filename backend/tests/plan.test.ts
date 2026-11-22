import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
let chili: any;
let oats: any;
beforeEach(async () => {
  await t.reset();
  await t.login();
  chili = (await t.api("POST", "/api/recipes", { title: "Chili", servings: 6, totalMinutes: 55 })).body;
  oats = (await t.api("POST", "/api/recipes", { title: "Overnight Oats" })).body;
});

const week = async (from = "2026-11-02", to = "2026-11-08") => (await t.api("GET", `/api/plan?from=${from}&to=${to}`)).body;
const plan = (body: object) => t.api("POST", "/api/plan", body);

describe("meal plan", () => {
  it("plans recipes and notes on days and meals", async () => {
    const a = await plan({ date: "2026-11-02", slot: "dinner", recipeId: chili.id, servings: 4 });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ date: "2026-11-02", slot: "dinner", title: "Chili", servings: 4, totalMinutes: 55, recipeServings: 6, position: 0 });
    await plan({ date: "2026-11-02", slot: "dinner", title: "Garlic bread" });
    await plan({ date: "2026-11-03", slot: "breakfast", recipeId: oats.id });
    await plan({ date: "2026-11-10", slot: "lunch", title: "Next week" });
    expect((await week()).map((e: any) => [e.date, e.slot, e.title, e.position])).toEqual([
      ["2026-11-02", "dinner", "Chili", 0],
      ["2026-11-02", "dinner", "Garlic bread", 1],
      ["2026-11-03", "breakfast", "Overnight Oats", 0],
    ]);
    expect((await plan({ date: "2026-11-02", slot: "elevenses", title: "x" })).body.error).toMatch(/no "elevenses" meal slot/);
    expect((await plan({ date: "2026-11-02", slot: "dinner" })).status).toBe(400);
    expect((await plan({ date: "2026-11-02", slot: "dinner", recipeId: 999 })).status).toBe(404);
  });

  it("moves between days and meals, and reorders", async () => {
    const a = (await plan({ date: "2026-11-02", slot: "dinner", recipeId: chili.id })).body;
    const b = (await plan({ date: "2026-11-02", slot: "dinner", title: "Salad" })).body;
    const c = (await plan({ date: "2026-11-04", slot: "dinner", title: "Tacos" })).body;
    // to the top of Wednesday's dinner
    expect((await t.api("PATCH", `/api/plan/${a.id}`, { date: "2026-11-04", position: 0 })).body).toMatchObject({ date: "2026-11-04", position: 0 });
    expect((await week()).map((e: any) => [e.date, e.title, e.position])).toEqual([
      ["2026-11-02", "Salad", 0],
      ["2026-11-04", "Chili", 0],
      ["2026-11-04", "Tacos", 1],
    ]);
    // reorder in place
    await t.api("PATCH", `/api/plan/${c.id}`, { position: 0 });
    expect((await week("2026-11-04", "2026-11-04")).map((e: any) => e.title)).toEqual(["Tacos", "Chili"]);
    // servings, note; a recipe's title stays the recipe's
    expect((await t.api("PATCH", `/api/plan/${a.id}`, { servings: 2, note: "double spice", title: "nope" })).body).toMatchObject({ servings: 2, note: "double spice", title: "Chili" });
    expect((await t.api("PATCH", `/api/plan/${b.id}`, { title: "Caesar salad" })).body.title).toBe("Caesar salad");
    expect((await t.api("DELETE", `/api/plan/${b.id}`)).status).toBe(204);
  });

  it("a deleted recipe leaves its name in the plan", async () => {
    await plan({ date: "2026-11-02", slot: "dinner", recipeId: chili.id });
    await t.api("DELETE", `/api/recipes/${chili.id}`);
    expect((await week())[0]).toMatchObject({ title: "Chili", recipeId: null });
  });

  it("copies a week, and clears one", async () => {
    await plan({ date: "2026-11-02", slot: "dinner", recipeId: chili.id });
    await plan({ date: "2026-11-05", slot: "lunch", title: "Leftovers" });
    expect((await t.api("POST", "/api/plan/copy", { from: "2026-11-02", to: "2026-11-09" })).body).toEqual({ copied: 2 });
    expect((await week("2026-11-09", "2026-11-15")).map((e: any) => [e.date, e.title])).toEqual([
      ["2026-11-09", "Chili"],
      ["2026-11-12", "Leftovers"],
    ]);
    expect((await t.api("DELETE", "/api/plan?from=2026-11-02&to=2026-11-08")).body).toEqual({ removed: 2 });
    expect(await week()).toEqual([]);
  });

  it("meal slots and week start are the household's; a slot in use can't go", async () => {
    expect((await t.api("GET", "/api/plan/settings")).body).toMatchObject({ weekStart: 1, slots: [{ id: "breakfast" }, { id: "lunch" }, { id: "dinner" }, { id: "snack" }] });
    const s = (await t.api("PUT", "/api/plan/settings", { slots: [{ id: "breakfast", name: "Breakfast" }, { name: "Second Breakfast" }, { id: "dinner", name: "Supper" }], weekStart: 0 })).body;
    expect(s).toEqual({ weekStart: 0, slots: [{ id: "breakfast", name: "Breakfast" }, { id: "second-breakfast", name: "Second Breakfast" }, { id: "dinner", name: "Supper" }] });
    await plan({ date: "2026-11-02", slot: "dinner", title: "x" });
    expect((await t.api("PUT", "/api/plan/settings", { slots: [{ id: "breakfast", name: "Breakfast" }] })).body.error).toMatch(/meals planned under "Supper"/);
  });

  it("is in backups, and keys follow their access", async () => {
    await plan({ date: "2026-11-02", slot: "dinner", recipeId: chili.id });
    const login = await t.api("POST", "/api/auth/login", { username: "alex", password: "password123" });
    const file = JSON.parse((await t.app.inject({ method: "GET", url: "/api/export", headers: { authorization: `Bearer ${login.body.token}` } })).body);
    expect(file.data.mealPlan).toHaveLength(1);
    const read = (await t.api("POST", "/api/keys", { name: "ha", access: "read" })).body.key;
    t.setToken("");
    expect((await t.api("GET", "/api/plan?from=2026-11-02&to=2026-11-08", undefined, { "x-api-key": read })).body).toHaveLength(1);
    expect((await t.api("POST", "/api/plan", { date: "2026-11-02", slot: "dinner", title: "x" }, { "x-api-key": read })).status).toBe(403);
  });
});
