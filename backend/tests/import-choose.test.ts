import { gzipSync, strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// A file with several recipes: read first, the app lists them (A–Z, all ticked), and only the ones
// you keep are imported
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const paprika = (name: string, ingredients = "1 lb beef") => ({ uid: name, name, ingredients, directions: "Cook it.", servings: "4", categories: [] });
const paprikaFile = (recipes: Record<string, unknown>[]) => Buffer.from(zipSync(Object.fromEntries(recipes.map((r, i) => [`${i}.paprikarecipe`, gzipSync(strToU8(JSON.stringify(r)))]))));
const upload = async (name: string, file: Buffer, query = "?choose=1") => {
  const b = "----recipehub";
  const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`)]);
  const r = await t.app.inject({ method: "POST", url: `/api/recipes/import/file${query}`, payload, headers: { authorization: `Bearer ${t.getToken()}`, "content-type": `multipart/form-data; boundary=${b}` } });
  expect(r.statusCode).toBe(202);
  await t.app.jobs.drain();
  return (await t.api("GET", `/api/imports/${r.json().id}`)).body;
};
const titles = async () => (await t.api("GET", "/api/recipes?sort=title")).body.recipes.map((r: any) => r.title);
const file = () => paprikaFile([paprika("Waffles"), paprika("apple pie", "6 apples"), paprika("Chili"), paprika("Bread", "3 cups flour")]);

describe("choosing which recipes to import", () => {
  it("the file is read and listed (A–Z), and nothing is imported yet", async () => {
    const job = await upload("My Recipes.paprikarecipes", file());
    expect(job).toMatchObject({ status: "done", result: { format: "Paprika" } });
    expect(job.result.choices.map((c: any) => c.title)).toEqual(["apple pie", "Bread", "Chili", "Waffles"]);
    expect(job.result.choices.every((c: any) => typeof c.n === "number" && c.already === false)).toBe(true);
    expect(await titles()).toEqual([]);
  });

  it("only the recipes kept are imported", async () => {
    const preview = await upload("My Recipes.paprikarecipes", file());
    const keep = preview.result.choices.filter((c: any) => c.title !== "Waffles").map((c: any) => c.n);
    const res = await t.api("POST", `/api/imports/${preview.id}/choose`, { keep });
    expect(res.status).toBe(202);
    await t.app.jobs.drain();
    const job = (await t.api("GET", `/api/imports/${res.body.id}`)).body;
    expect(job).toMatchObject({ status: "done", source: "My Recipes.paprikarecipes", result: { format: "Paprika", imported: 3, skipped: 0 } });
    expect(job.result.recipeIds).toHaveLength(3);
    expect(await titles()).toEqual(["apple pie", "Bread", "Chili"]);
    // and only once
    expect((await t.api("POST", `/api/imports/${preview.id}/choose`, { keep })).status).toBe(409);
  });

  it("recipes you already have are marked", async () => {
    await t.api("POST", "/api/recipes", { title: "Chili", ingredients: "1 lb beef", steps: ["Cook it."] });
    const preview = await upload("My Recipes.paprikarecipes", file());
    expect(preview.result.choices.find((c: any) => c.title === "Chili").already).toBe(true);
  });

  it("keeping none is refused; a file with just one recipe imports straight away", async () => {
    const preview = await upload("My Recipes.paprikarecipes", file());
    expect((await t.api("POST", `/api/imports/${preview.id}/choose`, { keep: [] })).status).toBe(400);
    const one = await upload("Chili.paprikarecipe", gzipSync(strToU8(JSON.stringify(paprika("Solo Chili")))) as unknown as Buffer);
    expect(one.result).toMatchObject({ imported: 1 });
    expect(one.result.choices).toBeUndefined();
  });

  it("without choose (API callers like n8n): everything is imported as before", async () => {
    const job = await upload("My Recipes.paprikarecipes", file(), "");
    expect(job.result.imported).toBe(4);
  });

  it("a cookbook PDF: the AI reads it once; choosing doesn't ask again", async () => {
    await t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText("Pancakes and Waffles", { x: 40, y: 700, size: 12, font });
    const pdf = Buffer.from(await doc.save());
    t.ai.respond = () => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify({ recipes: [{ title: "Waffles", ingredients: ["2 cups flour"], steps: ["Cook."] }, { title: "Pancakes", ingredients: ["1 cup flour"], steps: ["Fry."] }] }) } }] } });
    const preview = await upload("Breakfast.pdf", pdf);
    expect(preview.result.choices.map((c: any) => c.title)).toEqual(["Pancakes", "Waffles"]);
    const calls = t.ai.calls.length;
    const res = await t.api("POST", `/api/imports/${preview.id}/choose`, { keep: [preview.result.choices[0].n] });
    await t.app.jobs.drain();
    expect((await t.api("GET", `/api/imports/${res.body.id}`)).body.result).toMatchObject({ format: "PDF", imported: 1 });
    expect(t.ai.calls.length).toBe(calls);
    expect(await titles()).toEqual(["Pancakes"]);
  });
});

describe("choosing, then Improve all automatically", () => {
  const aiOn = () => t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });

  it("the import runs in the background and starts the AI improvements by itself when it's done", async () => {
    await aiOn();
    const preview = await upload("My Recipes.paprikarecipes", file());
    const keep = preview.result.choices.filter((c: any) => c.title === "Bread" || c.title === "Chili").map((c: any) => c.n);
    const res = await t.api("POST", `/api/imports/${preview.id}/choose`, { keep, improve: true });
    expect(res.status).toBe(202);
    // the pill can show the import straight away
    expect((await t.api("GET", "/api/imports/active")).body.map((j: any) => j.id)).toContain(res.body.id);
    await t.app.jobs.drain();
    const job = (await t.api("GET", `/api/imports/${res.body.id}`)).body;
    expect(job.result).toMatchObject({ imported: 2 });
    expect(job.result.improving).toEqual(expect.any(Number));
    const batch = (await t.api("GET", `/api/imports/${job.result.improving}`)).body;
    expect(batch).toMatchObject({ kind: "import-improve", source: "My Recipes.paprikarecipes" });
    expect(batch.result.total).toBe(2);
  });

  it("Improve with AI off: refused before anything is imported", async () => {
    const preview = await upload("My Recipes.paprikarecipes", file());
    const res = await t.api("POST", `/api/imports/${preview.id}/choose`, { keep: [0], improve: true });
    expect(res.status).toBe(409);
    expect(await titles()).toEqual([]);
  });
});
