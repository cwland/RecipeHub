import { gunzipSync } from "node:zlib";
import sharp from "sharp";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readPdf } from "../src/lib/pdfImport.js";
import { setupTestApp, type TestApp } from "./helpers.js";

// Downloads of a recipe: PDF, schema.org JSON-LD, Paprika, Meal-Master, CookML. From the app
// (signed in) and from a public share link (no sign-in, nothing private).
let t: TestApp;
let photo: string;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
  photo = await t.app.photos.save(await sharp({ create: { width: 800, height: 600, channels: 3, background: "#c0602a" } }).png().toBuffer());
});

const chili = {
  title: "Texas Chili & Beans",
  description: "Big and beefy.",
  ingredients: "2 lb chuck, cubed\n1 1/2 tsp salt\n⅓ cup masa harina\nSauce:\n3 dried anchos\nsalt, to taste",
  steps: ["Brown the beef in batches.", "# Simmer", "Simmer 2 hours at 300°F, stirring now and then."],
  servings: 6,
  prepMinutes: 20,
  cookMinutes: 120,
  totalMinutes: 140,
  notes: "Grandma's secret: a square of chocolate.",
  categories: ["Dinner"],
  tags: ["spicy"],
  sourceUrl: "https://food.test/chili",
  sourceName: "Food Test",
};
const add = async () => {
  const r = (await t.api("POST", "/api/recipes", { ...chili, imageUrl: photo })).body;
  await t.api("PUT", `/api/recipes/${r.id}/nutrition`, { calories: 520, fat: 30, saturatedFat: 12, sodium: 900, carbs: 12, fiber: 3, sugar: 4, protein: 45, servingSize: "1½ cups" });
  return r;
};
const download = (url: string, signedIn = true) => t.app.inject({ method: "GET", url, headers: signedIn ? { authorization: `Bearer ${t.getToken()}` } : {} });
const tokenOf = async (id: number) => (await t.api("GET", `/api/recipes/${id}/share-link`)).body.path.split("/").pop() as string;

describe("downloading a recipe", () => {
  it("each format has its own file type and name", async () => {
    const r = await add();
    const want = { pdf: ["application/pdf", "texas-chili-beans.pdf"], jsonld: ["application/ld+json", "texas-chili-beans.json"], paprika: ["application/octet-stream", "texas-chili-beans.paprikarecipe"], mealmaster: ["text/plain", "texas-chili-beans.mmf"], cookml: ["application/xml", "texas-chili-beans.cml"] };
    for (const [format, [type, file]] of Object.entries(want)) {
      const res = await download(`/api/recipes/${r.id}/export?format=${format}`);
      expect([format, res.statusCode, String(res.headers["content-type"]).split(";")[0], res.headers["content-disposition"]]).toEqual([format, 200, type, `attachment; filename="${file}"`]);
    }
    expect((await download(`/api/recipes/${r.id}/export?format=docx`)).statusCode).toBe(400);
  });

  it("PDF: the photo, ingredients, steps and nutrition, with fractions and degrees as they read", async () => {
    const r = await add();
    const pdf = (await download(`/api/recipes/${r.id}/export?format=pdf`)).rawPayload;
    const text = (await readPdf(pdf)).map((p) => p.text).join("\n");
    for (const s of ["Texas Chili & Beans", "Big and beefy.", "Serves 6", "Prep 20 min", "2 lb chuck, cubed", "1 1/2 tsp salt", "1/3 cup masa harina", "SAUCE", "Brown the beef in batches.", "SIMMER", "300°F", "Calories", "520", "Food Test"]) expect([s, text.includes(s)]).toEqual([s, true]);
    expect(text).toMatch(/Ingredients[\s\S]*Steps/);
    // the photo is in it
    const doc = await PDFDocument.load(pdf);
    const xobjects = doc.getPages()[0].node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
    expect(xobjects?.keys().length ?? 0).toBeGreaterThan(0);
  });

  it("PDF: a long recipe goes onto more pages", async () => {
    const r = (await t.api("POST", "/api/recipes", { title: "Long", ingredients: Array.from({ length: 80 }, (_, i) => `${i + 1} cups thing number ${i + 1}`).join("\n"), steps: Array.from({ length: 30 }, (_, i) => `Step ${i + 1}: ${"stir and keep stirring. ".repeat(8)}`) })).body;
    const pages = await readPdf((await download(`/api/recipes/${r.id}/export?format=pdf`)).rawPayload);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.map((p) => p.text).join("\n")).toContain("Step 30:");
  });

  it("Paprika: imports back into RecipeHub (and into Paprika) with its photo, servings and times", async () => {
    const r = await add();
    const file = (await download(`/api/recipes/${r.id}/export?format=paprika`)).rawPayload;
    const p = JSON.parse(gunzipSync(file).toString("utf8"));
    expect(p).toMatchObject({ name: "Texas Chili & Beans", servings: "6", prep_time: "20 min", cook_time: "2 hr", source: "Food Test", source_url: "https://food.test/chili", categories: ["Dinner"] });
    expect(p.photo_data.length).toBeGreaterThan(100);
    expect(p.ingredients.split("\n")).toContain("2 lb chuck, cubed");
    expect(p.nutritional_info).toContain("Calories: 520");
    // back in
    await t.api("DELETE", `/api/recipes/${r.id}`);
    const b = "----recipehub";
    const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="chili.paprikarecipe"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`)]);
    const job = (await t.app.inject({ method: "POST", url: "/api/recipes/import/file", payload, headers: { authorization: `Bearer ${t.getToken()}`, "content-type": `multipart/form-data; boundary=${b}` } })).json();
    await t.app.jobs.drain();
    const done = (await t.api("GET", `/api/imports/${job.id}`)).body;
    expect(done.result.imported).toBe(1);
    const back = (await t.api("GET", `/api/recipes/${done.result.recipeIds[0]}`)).body;
    expect(back).toMatchObject({ title: "Texas Chili & Beans", servings: 6, prepMinutes: 20, cookMinutes: 120, sourceUrl: "https://food.test/chili" });
    expect(back.ingredients.map((i: any) => i.raw)).toContain("2 lb chuck, cubed");
    expect(back.steps.filter((s: any) => !s.section).map((s: any) => s.text)).toEqual(["Brown the beef in batches.", "Simmer 2 hours at 300°F, stirring now and then."]);
    expect(back.steps.find((s: any) => s.section)?.section).toBe("Simmer");
    expect(back.imageUrl).toMatch(/^\/api\/photos\//);
  });

  it("Meal-Master: the classic layout (amount, two-letter unit, ingredient), sections, directions", async () => {
    const r = await add();
    const mm = (await download(`/api/recipes/${r.id}/export?format=mealmaster`)).body;
    const lines = mm.split(/\r?\n/);
    expect(lines[0]).toBe("MMMMM----- Recipe via Meal-Master (tm) v8.05");
    expect(mm).toContain("      Title: Texas Chili & Beans");
    expect(mm).toContain(" Categories: Dinner, Spicy");
    expect(mm).toContain("      Yield: 6 servings");
    expect(lines).toContain("      2 lb chuck, cubed");
    expect(lines).toContain("  1 1/2 t  salt");
    expect(lines).toContain("    1/3 c  masa harina");
    expect(lines).toContain("           salt, to taste");
    expect(lines.some((l) => /^MMMMM-+SAUCE-+$/.test(l))).toBe(true);
    expect(mm).toContain("Brown the beef in batches.");
    expect(mm).toContain("300 F"); // Meal-Master files are plain ASCII
    expect(lines.filter(Boolean).pop()).toBe("MMMMM");
    expect(/^[\x00-\x7f]*$/.test(mm)).toBe(true);
  });

  it("CookML: XML with the head, ingredients by part, and preparation; text escaped", async () => {
    const r = await add();
    const xml = (await download(`/api/recipes/${r.id}/export?format=cookml`)).body;
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toMatch(/<cookml version="1\.0\.14" prog="RecipeHub" progver="[\d.]+">/);
    expect(xml).toContain('<head title="Texas Chili &amp; Beans" servingqty="6" servingtype="servings">');
    expect(xml).toContain("<cat>Dinner</cat>");
    expect(xml).toContain('<ingredient qty="2" unit="lb" item="chuck" preparation="cubed"/>');
    expect(xml).toContain('<part title="Sauce">');
    expect(xml).toContain("<text>Brown the beef in batches.</text>");
    expect(xml).toContain('<picbin format="JPG">');
    expect(xml.trim().endsWith("</cookml>")).toBe(true);
  });

  it("from the app, the recipe's notes come too; from a share link they don't", async () => {
    const r = await add();
    expect((await download(`/api/recipes/${r.id}/export?format=mealmaster`)).body).toContain("chocolate");
    const token = await tokenOf(r.id);
    for (const format of ["pdf", "jsonld", "paprika", "mealmaster", "cookml"]) {
      const res = await download(`/api/public/share/${token}/export?format=${format}`, false);
      expect([format, res.statusCode]).toEqual([format, 200]);
      const body = format === "paprika" ? gunzipSync(res.rawPayload).toString("utf8") : format === "pdf" ? (await readPdf(res.rawPayload)).map((p) => p.text).join(" ") : res.body;
      expect([format, body.includes("chocolate")]).toEqual([format, false]);
    }
  });

  it("a share link's downloads stop with the link (replaced, or links off)", async () => {
    const r = await add();
    const token = await tokenOf(r.id);
    await t.api("PUT", "/api/settings/features", { publicLinks: false });
    expect((await download(`/api/public/share/${token}/export?format=pdf`, false)).statusCode).toBe(404);
    await t.api("PUT", "/api/settings/features", { publicLinks: true });
    await t.api("POST", `/api/recipes/${r.id}/share-link/new`);
    expect((await download(`/api/public/share/${token}/export?format=pdf`, false)).statusCode).toBe(404);
  });
});
