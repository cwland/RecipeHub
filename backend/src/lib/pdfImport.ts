import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";
import { AiError, type AiImage, type AiService } from "./ai.js";
import { aiRecipe, type ImportedRecipe } from "./importRecipe.js";

// PDF import: a printed recipe or a whole cookbook, with real text or scanned pages.
// Text goes to the AI in parts (a page of overlap, so a recipe across a break isn't lost);
// scanned pages are drawn as pictures and read a few at a time, like photos.

export class PdfError extends Error {}

export interface PdfPage {
  number: number; // 1, 2…
  text: string;
  scanned: boolean; // a picture of a page (no text to read)
}

const require = createRequire(import.meta.url);
const FONTS = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep;
const PART_CHARS = 12000; // text per AI request
const SCANS_PER_ASK = 3; // pictures per AI request

// The open PDF, and how to close it
async function open(data: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(data), standardFontDataUrl: FONTS, verbosity: 0 });
  try {
    return { pdf: await task.promise, close: () => task.destroy() };
  } catch {
    await task.destroy().catch(() => {});
    throw new PdfError("That file couldn't be read as a PDF.");
  }
}

// The text of each page (a page with almost none is a scan)
export async function readPdf(data: Buffer): Promise<PdfPage[]> {
  const { pdf, close } = await open(data);
  const pages: PdfPage[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const text = content.items
      .map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : " ") : ""))
      .join("")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim();
    pages.push({ number: n, text, scanned: text.replace(/\s/g, "").length < 5 }); // (a scan may still have a page number)
  }
  await close();
  return pages;
}

// Pages drawn as JPEG pictures (about 1600 px wide) for the AI to read
export async function pdfPagePictures(data: Buffer, numbers: number[]): Promise<AiImage[]> {
  const { pdf, close } = await open(data);
  const out: AiImage[] = [];
  for (const n of numbers) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1600 / base.width, 3) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport }).promise;
    const jpeg = await sharp(await canvas.encode("png")).jpeg({ quality: 80 }).toBuffer();
    out.push({ mime: "image/jpeg", base64: jpeg.toString("base64") });
  }
  await close();
  return out;
}

const SHAPE = `{"recipes": [{"title": "", "description": "", "ingredients": ["1 cup flour", "For the sauce:", "2 tbsp butter"], "steps": ["Heat the oven to 350°F.", "Mix..."], "servings": 4, "yieldText": "", "prepMinutes": 10, "cookMinutes": 20, "totalMinutes": 30, "tags": ["vegetarian"]}]}`;
const RULES = `Rules: include every recipe that's complete here; leave out one that's cut off at the very start or end (it's in the next part). Copy ingredient lines as written, one per line, but write amounts as numbers ("1 lb ground beef", not "One pound of ground beef"); a heading line ends with ":". Steps are the method in order, without numbers. Leave out stories, ads, indexes and nutrition. Use null for anything not given; never invent amounts or times. "tags": up to 5 short lowercase words. If there are no recipes, reply {"recipes": []}.`;
const TEXT_SYSTEM = `You find every recipe in text from a PDF (a printed recipe or a cookbook) and turn each one into JSON. Reply with JSON only, in this shape:\n${SHAPE}\n${RULES}`;
const SCAN_SYSTEM = `You read every recipe on these pages (scanned cookbook pages or recipe cards, in order) and turn each one into JSON. Reply with JSON only, in this shape:\n${SHAPE}\n${RULES} Read handwriting carefully.`;

// What happened while reading, for the log when nothing came of it
export interface PdfReport {
  textPages: number;
  scannedPages: number;
  answers: string[]; // what the AI replied, each cut short
  leftOut: { title: string; why: string }[]; // recipes in a reply that couldn't be used
}
export const newReport = (): PdfReport => ({ textPages: 0, scannedPages: 0, answers: [], leftOut: [] });

// The recipes in the AI's answer (anything it got wrong is left out, and noted). A reply of one
// recipe without the list around it counts too.
function recipesIn(json: Record<string, unknown>, report: PdfReport): ImportedRecipe[] {
  report.answers.push(JSON.stringify(json).slice(0, 400));
  const one = (json.recipe && typeof json.recipe === "object" ? json.recipe : json.title ? json : null) as unknown;
  const list = Array.isArray(json.recipes) ? json.recipes : one ? [one] : [];
  return list.flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    try {
      return [aiRecipe(r as Record<string, unknown>)];
    } catch (e) {
      report.leftOut.push({ title: String((r as { title?: unknown }).title ?? "").trim() || "(no title)", why: (e as Error).message });
      return [];
    }
  });
}

// Every recipe in a PDF. name: the file's name (it becomes the recipes' source).
export async function recipesFromPdf(ai: AiService, data: Buffer, name: string, report = newReport()): Promise<ImportedRecipe[]> {
  if (!(await ai.active())) throw new AiError("Reading a PDF needs AI. Turn on AI in Settings › AI.");
  const pages = await readPdf(data);
  report.scannedPages = pages.filter((p) => p.scanned).length;
  report.textPages = pages.length - report.scannedPages;
  const found: ImportedRecipe[] = [];

  // Text: parts of about PART_CHARS, each starting with the last page of the one before
  const ask = async (ps: PdfPage[]) => {
    const body = ps.map((p) => `--- Page ${p.number} ---\n${p.text}`).join("\n\n");
    const { json } = await ai.ask("recipe", TEXT_SYSTEM, `From ${name}, pages ${ps[0].number}–${ps[ps.length - 1].number}:\n\n${body}`, { maxTokens: 8000 });
    found.push(...recipesIn(json, report));
  };
  let part: PdfPage[] = [];
  let fresh = 0; // pages in this part not already sent in the one before
  for (const p of pages.filter((x) => !x.scanned)) {
    const size = part.reduce((n, x) => n + x.text.length, 0);
    if (fresh && size + p.text.length > PART_CHARS) {
      await ask(part);
      part = [part[part.length - 1]];
      fresh = 0;
    }
    part.push(p);
    fresh++;
  }
  if (fresh) await ask(part);

  // Scans: a few pages at a time, as pictures
  const scans = pages.filter((p) => p.scanned);
  for (let i = 0; i < scans.length; i += SCANS_PER_ASK) {
    const group = scans.slice(i, i + SCANS_PER_ASK);
    const images = await pdfPagePictures(data, group.map((p) => p.number));
    const { json } = await ai.ask("photo", SCAN_SYSTEM, `From ${name}: ${group.length === 1 ? `page ${group[0].number}` : `pages ${group.map((p) => p.number).join(", ")}`}.`, { maxTokens: 8000, images });
    found.push(...recipesIn(json, report));
  }

  // A recipe found twice (in the overlap) is kept once: the fuller copy
  const byTitle = new Map<string, ImportedRecipe>();
  const size = (r: ImportedRecipe) => r.ingredients.length + r.steps.length;
  for (const r of found) {
    const key = r.title.trim().toLowerCase();
    const had = byTitle.get(key);
    if (!had || size(r) > size(had)) byTitle.set(key, r);
  }
  return [...byTitle.values()].map((r) => ({ ...r, sourceName: name.slice(0, 200), sourceUrl: null }));
}
