import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// Substitutions: a swap (instead of an ingredient line, or of something typed) or an added item,
// with what was used as an amount, a unit and the item. Make a new version applies the ticked
// ones to the recipe's ingredients as a new version; they stay, marked with that version.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const chili = async () =>
  (await t.api("POST", "/api/recipes", { title: "Chili", servings: 4, ingredients: ["1 lb ground beef", { section: "For the topping" }, "1 cup sour cream", "1 cup shredded cheddar"], steps: ["Cook it."] })).body as { id: number };
const sub = (id: number, body: object) => t.api("POST", `/api/recipes/${id}/substitutions`, body);
const raws = async (id: number) => ((await t.api("GET", `/api/recipes/${id}`)).body.ingredients as { raw: string; section?: string }[]).map((i) => (i.section ? `# ${i.section}` : i.raw));

describe("substitutions", () => {
  it("a swap of an ingredient line, with an amount, a unit and the item: the line it replaces is kept", async () => {
    const r = await chili();
    const s = await sub(r.id, { kind: "swap", line: "1 cup sour cream", amount: "3/4", unit: "cup", item: "Greek yogurt", note: "tangier" });
    expect(s.status).toBe(201);
    expect(s.body).toMatchObject({ kind: "swap", original: "1 cup sour cream", line: "1 cup sour cream", replacement: "3/4 cup Greek yogurt", amount: "3/4", unit: "cup", item: "Greek yogurt", note: "tangier", appliedVersion: null });
    expect((await t.api("GET", `/api/recipes/${r.id}`)).body.substitutions[0]).toMatchObject({ kind: "swap", line: "1 cup sour cream" });
  });

  it("the amount and unit are optional; free text instead of a line works too (as before)", async () => {
    const r = await chili();
    expect((await sub(r.id, { kind: "swap", original: "the beans", item: "a splash of cream" })).body).toMatchObject({ original: "the beans", line: null, replacement: "a splash of cream" });
    expect((await sub(r.id, { original: "kidney beans", replacement: "black beans" })).body).toMatchObject({ kind: "swap", replacement: "black beans" });
  });

  it("an added item", async () => {
    const r = await chili();
    expect((await sub(r.id, { kind: "add", amount: "1", unit: "tsp", item: "smoked paprika" })).body).toMatchObject({ kind: "add", original: null, replacement: "1 tsp smoked paprika" });
  });

  it("a line that isn't in the recipe can't be swapped; a swap needs what it's instead of", async () => {
    const r = await chili();
    expect((await sub(r.id, { kind: "swap", line: "2 eggs", item: "flax" })).status).toBe(400);
    expect((await sub(r.id, { kind: "swap", item: "flax" })).status).toBe(400);
    expect((await sub(r.id, { kind: "add" })).status).toBe(400);
  });
});

describe("Make a new version with these changes", () => {
  it("swaps the matched lines, adds the added items at the end, as a new version that says what changed", async () => {
    const r = await chili();
    const a = (await sub(r.id, { kind: "swap", line: "1 cup sour cream", amount: "3/4", unit: "cup", item: "Greek yogurt" })).body;
    const b = (await sub(r.id, { kind: "add", amount: "1", unit: "tsp", item: "smoked paprika" })).body;
    const res = await t.api("POST", `/api/recipes/${r.id}/substitutions/apply`, { ids: [a.id, b.id] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 2, applied: 2 });
    expect(await raws(r.id)).toEqual(["1 lb ground beef", "# For the topping", "3/4 cup Greek yogurt", "1 cup shredded cheddar", "1 tsp smoked paprika"]);
    const versions = (await t.api("GET", `/api/recipes/${r.id}/versions`)).body;
    expect(versions[0]).toMatchObject({ number: 2, active: true, summary: "Substitutions: 1 cup sour cream → 3/4 cup Greek yogurt; added 1 tsp smoked paprika" });
    // they stay, marked with the version they went into
    const subs = (await t.api("GET", `/api/recipes/${r.id}`)).body.substitutions;
    expect(subs.map((x: any) => x.appliedVersion)).toEqual([2, 2]);
    // the old ingredients are in version 1
    expect((await t.api("GET", `/api/recipes/${r.id}/versions/1`)).body.data.ingredients.map((i: any) => i.raw)).toContain("1 cup sour cream");
  });

  it("only the ticked ones; free-text swaps and ones already applied are left out", async () => {
    const r = await chili();
    const a = (await sub(r.id, { kind: "swap", line: "1 lb ground beef", item: "1 lb ground turkey" })).body;
    const b = (await sub(r.id, { kind: "swap", line: "1 cup shredded cheddar", amount: "1", unit: "cup", item: "pepper jack" })).body;
    const free = (await sub(r.id, { kind: "swap", original: "the beans", item: "lentils" })).body;
    const res = (await t.api("POST", `/api/recipes/${r.id}/substitutions/apply`, { ids: [a.id, free.id] })).body;
    expect(res).toMatchObject({ applied: 1 });
    expect(await raws(r.id)).toEqual(["1 lb ground turkey", "# For the topping", "1 cup sour cream", "1 cup shredded cheddar"]);
    // a second time: the applied one is skipped
    expect((await t.api("POST", `/api/recipes/${r.id}/substitutions/apply`, { ids: [a.id] })).status).toBe(400);
    expect((await t.api("POST", `/api/recipes/${r.id}/substitutions/apply`, { ids: [b.id] })).body).toMatchObject({ version: 3, applied: 1 });
  });

  it("a line that's no longer in the recipe (changed since): skipped and said so", async () => {
    const r = await chili();
    const a = (await sub(r.id, { kind: "swap", line: "1 cup sour cream", item: "yogurt" })).body;
    const c = (await sub(r.id, { kind: "add", item: "cilantro" })).body;
    await t.api("PATCH", `/api/recipes/${r.id}`, { ingredients: ["1 lb ground beef", "2 cups sour cream"] });
    const res = (await t.api("POST", `/api/recipes/${r.id}/substitutions/apply`, { ids: [a.id, c.id] })).body;
    expect(res).toMatchObject({ applied: 1, missing: ["1 cup sour cream"] });
    expect(await raws(r.id)).toEqual(["1 lb ground beef", "2 cups sour cream", "cilantro"]);
  });

  it("nothing to apply: 400", async () => {
    const r = await chili();
    expect((await t.api("POST", `/api/recipes/${r.id}/substitutions/apply`, { ids: [] })).status).toBe(400);
  });
});

describe("ingredient order (each person's choice)", () => {
  it("as entered unless you pick A to Z", async () => {
    expect((await t.api("GET", "/api/auth/me")).body.user.ingredientOrder).toBe("entered");
    expect((await t.api("PATCH", "/api/profile", { ingredientOrder: "alpha" })).body.ingredientOrder).toBe("alpha");
    expect((await t.api("PATCH", "/api/profile", { ingredientOrder: "sideways" })).status).toBe(400);
  });
});
