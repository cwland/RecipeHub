import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jobs } from "../src/db/schema.js";
import { setupTestApp, type TestApp } from "./helpers.js";

// What's running in the background, for the status pill at the top of every screen
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const add = (kind: string, status: string, result: object | null = null, finishedAgo?: number) =>
  t.app.db
    .insert(jobs)
    .values({ kind, status: status as never, payload: { name: "My Recipes.paprikarecipes", importId: 1, recipeIds: [] }, result: result as never, ...(finishedAgo !== undefined ? { finishedAt: new Date(Date.now() - finishedAgo * 1000) } : {}) })
    .returning()
    .then((r) => r[0].id);

describe("background imports and AI batches", () => {
  it("lists what's queued or running, with progress; a batch that just finished stays a minute", async () => {
    const running = await add("import-improve", "running", { total: 42, done: 17, improved: 15, unchanged: 1, failed: [] });
    const file = await add("import-file", "queued");
    const justDone = await add("import-improve", "done", { total: 10, done: 10, improved: 9, unchanged: 1, failed: [] }, 20);
    await add("import-improve", "done", { total: 5, done: 5 }, 300); // long done
    await add("import-url", "done", { recipeId: 1 }, 5); // single imports aren't shown
    const r = await t.api("GET", "/api/imports/active");
    expect(r.status).toBe(200);
    expect(r.body.map((j: any) => [j.id, j.kind, j.status])).toEqual([
      [justDone, "import-improve", "done"],
      [file, "import-file", "queued"],
      [running, "import-improve", "running"],
    ]);
    expect(r.body.find((j: any) => j.id === running).result).toMatchObject({ total: 42, done: 17 });
  });

  it("nothing going on: an empty list", async () => {
    await t.app.db.execute(sql`delete from jobs`);
    expect((await t.api("GET", "/api/imports/active")).body).toEqual([]);
  });
});
