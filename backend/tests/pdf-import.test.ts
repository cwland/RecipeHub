import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readPdf } from "../src/lib/pdfImport.js";
import { setupTestApp, type TestApp } from "./helpers.js";

// PDF import: one recipe or a whole cookbook; pages with text, or scanned pages (pictures)

// A PDF whose pages hold these lines of text ("scan" pages are a picture with no text)
async function makePdf(pages: (string[] | "scan")[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const scan = await doc.embedJpg(await sharp({ create: { width: 300, height: 400, channels: 3, background: "#f4efe6" } }).jpeg().toBuffer());
  for (const p of pages) {
    const page = doc.addPage([612, 792]);
    if (p === "scan") page.drawImage(scan, { x: 0, y: 0, width: 612, height: 792 });
    else p.forEach((line, i) => page.drawText(line, { x: 40, y: 750 - (i % 70) * 10, size: 8, font }));
  }
  return Buffer.from(await doc.save());
}

describe("reading a PDF", () => {
  it("gives the text of each page, and says which pages are scans", async () => {
    const pdf = await makePdf([["Texas Chili", "2 lb chuck"], "scan"]);
    const pages = await readPdf(pdf);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ number: 1, scanned: false });
    expect(pages[0].text).toContain("Texas Chili");
    expect(pages[0].text).toContain("2 lb chuck");
    expect(pages[1]).toMatchObject({ number: 2, scanned: true, text: "" });
  });

  it("something that isn't a PDF says so", async () => {
    await expect(readPdf(Buffer.from("hello"))).rejects.toThrow("couldn't be read as a PDF");
  });
});

describe("importing a PDF", () => {
  let t: TestApp;
  beforeAll(async () => (t = await setupTestApp()));
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.login();
  });

  const reply = (obj: object) => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(obj) } }] } });
  const aiOn = () => t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k", photos: true }], maxPerRun: 50 });
  const upload = async (name: string, file: Buffer) => {
    const b = "----recipehub";
    const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`)]);
    const r = await t.app.inject({ method: "POST", url: "/api/recipes/import/file", payload, headers: { authorization: `Bearer ${t.getToken()}`, "content-type": `multipart/form-data; boundary=${b}` } });
    expect(r.statusCode).toBe(202);
    await t.app.jobs.drain();
    return (await t.api("GET", `/api/imports/${r.json().id}`)).body;
  };
  const chili = { title: "Texas Chili", ingredients: ["Two pounds of chuck", "3 dried anchos"], steps: ["Brown the beef.", "Simmer 2 hours."], servings: 6 };
  const titles = async () => (await t.api("GET", "/api/recipes?sort=title")).body.recipes.map((r: any) => r.title);

  it("one recipe: read from the text, and saved (amounts in numbers)", async () => {
    await aiOn();
    t.ai.respond = () => reply({ recipes: [chili] });
    const job = await upload("chili.pdf", await makePdf([["Texas Chili", "Two pounds of chuck", "3 dried anchos", "Brown the beef. Simmer 2 hours."]]));
    expect(job).toMatchObject({ status: "done", result: { format: "PDF", imported: 1, skipped: 0 } });
    expect(job.result.recipeIds).toHaveLength(1);
    const sent = t.ai.calls[0].body.messages[1].content as string;
    expect(sent).toContain("Two pounds of chuck");
    expect(t.ai.calls[0].body.messages[0].content).toMatch(/every recipe/i);
    const r = (await t.api("GET", `/api/recipes/${job.result.recipeIds[0]}`)).body;
    expect(r.ingredients.map((i: any) => i.raw)).toEqual(["2 lb chuck", "3 dried anchos"]);
    expect(r).toMatchObject({ servings: 6, sourceName: "chili.pdf" });
  });

  it("a cookbook: read in parts that overlap by a page; a recipe found twice is kept once", async () => {
    await aiOn();
    const filler = (word: string) => Array.from({ length: 140 }, (_, i) => `${word} line ${i} with enough words to fill the page up nicely`);
    const pdf = await makePdf([["Pancakes", ...filler("a")], ["Waffles", ...filler("b")], ["Muffins", ...filler("c")], ["Scones", ...filler("d")]]);
    t.ai.respond = (_u, body) => {
      const text = body.messages[1].content as string;
      const found = ["Pancakes", "Waffles", "Muffins", "Scones"].filter((n) => text.includes(n)).map((title) => ({ title, ingredients: ["1 cup flour"], steps: ["Bake."] }));
      return reply({ recipes: found });
    };
    const job = await upload("Baking Book.pdf", pdf);
    expect(t.ai.calls.length).toBeGreaterThan(1);
    expect(job.result).toMatchObject({ format: "PDF", imported: 4 });
    expect(await titles()).toEqual(["Muffins", "Pancakes", "Scones", "Waffles"]);
  });

  it("scanned pages are sent as pictures, a few pages at a time", async () => {
    await aiOn();
    t.ai.respond = (_u, body) => {
      const images = (body.messages[1].content as any[]).filter((c) => c.type === "image_url");
      return reply({ recipes: images.length ? [{ ...chili, title: `Card ${images.length}` }] : [] });
    };
    const job = await upload("cards.pdf", await makePdf(["scan", "scan", "scan", "scan"]));
    expect(job.result).toMatchObject({ format: "PDF", imported: 2 });
    const sentImages = t.ai.calls.map((c) => (c.body.messages[1].content as any[]).filter((x) => x.type === "image_url").length);
    expect(sentImages).toEqual([3, 1]);
    expect((t.ai.calls[0].body.messages[1].content as any[]).find((x) => x.type === "image_url").image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("no recipes in it: says so", async () => {
    await aiOn();
    t.ai.respond = () => reply({ recipes: [] });
    const job = await upload("taxes.pdf", await makePdf([["Line 1: income", "Line 2: deductions"]]));
    expect(job.status).toBe("failed");
    expect(job.error).toBe("No recipes were found in taxes.pdf.");
  });

  it("nothing found: the log says what the AI answered, so it can be looked into", async () => {
    await aiOn();
    t.ai.respond = () => reply({ recipes: [] });
    await upload("taxes.pdf", await makePdf([["Line 1: income", "Line 2: deductions"]]));
    const logs = (await t.api("GET", "/api/logs?category=import")).body;
    const log = logs.find((l: any) => l.event.startsWith("No recipes"));
    expect(log).toMatchObject({ level: "warning", source: "taxes.pdf", event: "No recipes were found in taxes.pdf" });
    expect(log.detail).toMatch(/1 page with text, 0 scanned/);
    expect(log.detail).toContain('{"recipes":[]}');
  });

  it("the AI found a recipe but gave no ingredients: says so, instead of just 'none found'", async () => {
    await aiOn();
    t.ai.respond = () => reply({ recipes: [{ title: "Chile Crisp Fried Rice", ingredients: [], steps: ["Fry."] }] });
    const job = await upload("rice.pdf", await makePdf([["Chile Crisp Fried Rice", "Fry."]]));
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/found "Chile Crisp Fried Rice" but without any ingredients/);
    const log = (await t.api("GET", "/api/logs?category=import")).body.find((l: any) => l.event.startsWith("No recipes"));
    expect(log.detail).toMatch(/Left out "Chile Crisp Fried Rice"/);
  });

  it("ingredients in groups or as parts (amount, unit, name) are read too, and one recipe without the list around it", async () => {
    await aiOn();
    t.ai.respond = () =>
      reply({
        title: "Chile Crisp Fried Rice",
        ingredients: [
          { heading: "For the rice", items: ["3 cups cooked rice", { quantity: 1, unit: "cup", name: "frozen edamame" }] },
          { group: "To finish", ingredients: [{ amount: "2", unit: "tbsp", item: "chile crisp" }, { text: "Scallions, sliced" }] },
        ],
        steps: [{ text: "Fry the rice." }, "Stir in the chile crisp."],
      });
    const job = await upload("rice.pdf", await makePdf([["Chile Crisp Fried Rice", "3 cups cooked rice"]]));
    expect(job).toMatchObject({ status: "done", result: { imported: 1 } });
    const r = (await t.api("GET", `/api/recipes/${job.result.recipeIds[0]}`)).body;
    expect(r.ingredients.map((i: any) => i.raw)).toEqual(["For the rice:", "3 cups cooked rice", "1 cup frozen edamame", "To finish:", "2 tbsp chile crisp", "Scallions, sliced"]);
    expect(r.steps.map((s: any) => s.text ?? s)).toEqual(expect.arrayContaining(["Fry the rice.", "Stir in the chile crisp."]));
  });

  it("reading a PDF needs AI", async () => {
    const job = await upload("chili.pdf", await makePdf([["Texas Chili", "2 lb chuck"]]));
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/Reading a PDF needs AI/);
  });

  it("a file that only says it's a PDF", async () => {
    await aiOn();
    const job = await upload("broken.pdf", Buffer.from("not really a pdf"));
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/couldn't be read as a PDF/);
  });

  it("a recipe already saved is skipped", async () => {
    await aiOn();
    t.ai.respond = () => reply({ recipes: [chili] });
    const pdf = await makePdf([["Texas Chili", "Two pounds of chuck"]]);
    await upload("chili.pdf", pdf);
    const again = await upload("chili.pdf", pdf);
    expect(again.result).toMatchObject({ imported: 0, skipped: 1 });
  });
});
