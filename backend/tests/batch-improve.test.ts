import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jobs } from "../src/db/schema.js";
import { setupTestApp, type TestApp } from "./helpers.js";

// Batch import: every recipe a file brought in is improved by AI in the background, with progress
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const reply = (obj: object) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
const aiOn = async () => {
  await t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
  await t.api("PUT", "/api/settings/features", { autoNutrition: false });
};
// What a file import leaves behind: its recipes, and the finished import naming them
async function imported(titles: string[]) {
  const ids: number[] = [];
  for (const title of titles) ids.push((await t.api("POST", "/api/recipes", { title, ingredients: "1 lb beef", steps: ["Cook it."] })).body.id);
  const [job] = await t.app.db.insert(jobs).values({ kind: "import-file", payload: { file: "x", name: "My Recipes.paprikarecipes" }, status: "done", result: { format: "Paprika", imported: ids.length, recipeIds: ids } }).returning();
  return { importId: job.id, ids };
}
const better = (title: string) => ({ steps: [`Cook the ${title} well, 10 minutes.`], stepChanges: ["Added a time."], ingredients: ["1 lb beef", "1 tsp salt"], ingredientChanges: ["Added salt."], categories: ["Dinner"], tags: ["easy"], organizeChanges: ["Added Dinner."] });
const improve = async (importId: number) => {
  const r = await t.api("POST", `/api/imports/${importId}/improve`);
  await t.app.jobs.drain();
  return { start: r, job: r.body.id ? (await t.api("GET", `/api/imports/${r.body.id}`)).body : null };
};

describe("improving every imported recipe at once", () => {
  it("each recipe gets the AI's changes as a new version; its original stays v1", async () => {
    await aiOn();
    const { importId, ids } = await imported(["Chili", "Stew"]);
    t.ai.respond = (_u, body) => reply(better(String(body.messages[1].content).includes("Chili") ? "chili" : "stew"));
    const { start, job } = await improve(importId);
    expect(start.status).toBe(202);
    expect(job).toMatchObject({ kind: "import-improve", status: "done", source: "My Recipes.paprikarecipes", result: { total: 2, done: 2, improved: 2, unchanged: 0, failed: [] } });
    const r = (await t.api("GET", `/api/recipes/${ids[0]}`)).body;
    expect(r.steps).toEqual([{ text: "Cook the chili well, 10 minutes." }]);
    expect(r.tags).toEqual(["easy"]);
    const versions = (await t.api("GET", `/api/recipes/${ids[0]}/versions`)).body;
    expect(versions.map((v: any) => [v.number, v.source, v.active])).toEqual([
      [2, "ai", true],
      [1, "created", false],
    ]);
  });

  it("a recipe the AI has nothing to change is counted, not changed", async () => {
    await aiOn();
    const { importId } = await imported(["Chili"]);
    t.ai.respond = () => reply({ steps: ["Cook it."], ingredients: ["1 lb beef"], categories: [], tags: [] });
    const { job } = await improve(importId);
    expect(job.result).toMatchObject({ total: 1, done: 1, improved: 0, unchanged: 1 });
  });

  it("one that fails is listed with why; the rest carry on", async () => {
    await aiOn();
    const { importId } = await imported(["Chili", "Stew"]);
    t.ai.respond = (_u, body) => (String(body.messages[1].content).includes("Chili") ? { status: 500, json: { error: "boom" } } : reply(better("stew")));
    const { job } = await improve(importId);
    expect(job.status).toBe("done");
    expect(job.result).toMatchObject({ total: 2, done: 2, improved: 1 });
    expect(job.result.failed).toHaveLength(1);
    expect(job.result.failed[0].title).toBe("Chili");
    const log = (await t.api("GET", "/api/logs?category=import")).body[0];
    expect(log).toMatchObject({ level: "warning", event: "Improved 1 of 2 recipes from My Recipes.paprikarecipes" });
  });

  it("shows how far along it is while it works", async () => {
    await aiOn();
    const { importId } = await imported(["Chili", "Stew", "Soup"]);
    const seen: number[] = [];
    let batchId = 0;
    t.ai.respond = async (_u, body) => {
      if (String(body.messages[0].content).startsWith("You estimate nutrition")) return reply({ ingredients: [{ line: "1 lb beef", calories: 1000 }] }); // the check's own nutrition request
      if (batchId) seen.push(((await t.app.db.select().from(jobs).where(eq(jobs.id, batchId)))[0].result as { done: number }).done);
      return reply(better("x"));
    };
    const realKick = t.app.jobs.kick;
    t.app.jobs.kick = () => {};
    batchId = (await t.api("POST", `/api/imports/${importId}/improve`)).body.id;
    t.app.jobs.kick = realKick;
    t.app.jobs.kick();
    await t.app.jobs.drain();
    expect(seen).toEqual([0, 1, 2]);
  });

  it("Stop ends it after the recipe being worked on", async () => {
    await aiOn();
    const { importId } = await imported(["Chili", "Stew", "Soup"]);
    let batchId = 0;
    t.ai.respond = async () => {
      await t.api("POST", `/api/imports/${batchId}/stop`);
      return reply(better("x"));
    };
    const realKick = t.app.jobs.kick;
    t.app.jobs.kick = () => {};
    batchId = (await t.api("POST", `/api/imports/${importId}/improve`)).body.id;
    t.app.jobs.kick = realKick;
    t.app.jobs.kick();
    await t.app.jobs.drain();
    const job = (await t.api("GET", `/api/imports/${batchId}`)).body;
    expect(job.result).toMatchObject({ total: 3, done: 1, improved: 1, stopped: true });
  });

  it("recipes deleted since the import are passed over", async () => {
    await aiOn();
    const { importId, ids } = await imported(["Chili", "Stew"]);
    await t.api("DELETE", `/api/recipes/${ids[0]}`);
    t.ai.respond = () => reply(better("stew"));
    const { job } = await improve(importId);
    expect(job.result).toMatchObject({ total: 2, done: 2, improved: 1, failed: [] });
    expect(t.ai.calls.filter((c) => String(c.body.messages[0].content).startsWith("You check home recipes"))).toHaveLength(1);
  });

  it("needs Improve with AI on, and an import that brought recipes in", async () => {
    const { importId } = await imported(["Chili"]);
    expect((await t.api("POST", `/api/imports/${importId}/improve`)).status).toBe(409);
    await aiOn();
    const [other] = await t.app.db.insert(jobs).values({ kind: "import-url", payload: { url: "https://x.test" }, status: "done", result: { recipeId: 1 } }).returning();
    expect((await t.api("POST", `/api/imports/${other.id}/improve`)).status).toBe(400);
    expect((await t.api("POST", "/api/imports/999/improve")).status).toBe(404);
    expect(await t.app.db.execute(sql`select count(*)::int as n from jobs where kind = 'import-improve'`).then((r) => (r.rows[0] as { n: number }).n)).toBe(0);
  });
});
