import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Ingredient, Nutrition } from "../db/schema.js";
import { fileName, recipeJsonLd } from "./share.js";
import { APP_VERSION } from "./version.js";

// A recipe as a file: PDF, schema.org JSON-LD, Paprika (.paprikarecipe), Meal-Master (.mmf) or
// CookML (.cml). From the app the recipe's notes come along; from a share link they don't.

export const FORMATS = {
  pdf: { type: "application/pdf", ext: "pdf", name: "PDF" },
  jsonld: { type: "application/ld+json", ext: "json", name: "JSON-LD" },
  paprika: { type: "application/octet-stream", ext: "paprikarecipe", name: "Paprika" },
  mealmaster: { type: "text/plain; charset=us-ascii", ext: "mmf", name: "Meal-Master" },
  cookml: { type: "application/xml; charset=utf-8", ext: "cml", name: "CookML" },
} as const;
export type ExportFormat = keyof typeof FORMATS;

export interface ExportRecipe {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  ingredients: Ingredient[];
  steps: { text: string; section?: string | null }[];
  servings: number | null;
  yieldText: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  nutrition: Nutrition | null;
  sourceUrl: string | null;
  sourceName: string | null;
  notes: string | null;
  tags: string[];
  categories: { name: string }[];
}

export async function exportRecipe(r: ExportRecipe, format: ExportFormat, opts: { appUrl: string | null; photoDir: string }) {
  const f = FORMATS[format];
  const filename = `${fileName(r.title)}.${f.ext}`;
  const photo = () => photoJpeg(r.imageUrl, opts.photoDir);
  let body: Buffer;
  if (format === "pdf") body = await recipePdf(r, await photo());
  else if (format === "jsonld") body = Buffer.from(JSON.stringify(recipeJsonLd(r as never, opts.appUrl), null, 2));
  else if (format === "paprika") body = paprika(r, await photo());
  else if (format === "mealmaster") body = Buffer.from(mealMaster(r), "ascii");
  else body = Buffer.from(cookMl(r, await photo()), "utf8");
  return { body, type: f.type, filename };
}

// ---------- shared bits ----------

// The recipe's own photo (saved here) as a JPEG; a photo shown from another site isn't fetched
export async function photoJpeg(imageUrl: string | null, dir: string) {
  const name = imageUrl?.match(/^\/api\/photos\/([0-9a-f-]{36}\.webp)$/)?.[1];
  if (!name) return null;
  try {
    return await sharp(await fs.readFile(path.join(dir, name))).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  } catch {
    return null;
  }
}

const minutes = (m: number | null) => (!m ? null : m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m / 60} hr`);

// 1.5 -> "1 1/2", 0.333 -> "1/3" (the fractions cooks use), else the decimal
function fraction(q: number) {
  const whole = Math.floor(q + 1e-9);
  const rest = q - whole;
  if (rest < 0.02) return String(whole);
  for (const d of [2, 3, 4, 8]) {
    const n = Math.round(rest * d);
    if (n > 0 && n < d && Math.abs(rest - n / d) < 0.02) {
      const g = n % 2 === 0 && d % 2 === 0 ? 2 : 1;
      return `${whole ? `${whole} ` : ""}${n / g}/${d / g}`;
    }
  }
  return String(Math.round(q * 100) / 100);
}
const amountOf = (i: Ingredient) => (i.quantity == null ? "" : `${fraction(i.quantity)}${i.quantityMax != null ? `-${fraction(i.quantityMax)}` : ""}`);
const itemOf = (i: Ingredient) => [i.name ?? i.raw, i.note].filter(Boolean).join(", ");
const nutritionLines = (n: Nutrition | null) => {
  if (!n) return [];
  const rows: [string, number | null | undefined, string][] = [
    ["Calories", n.calories, ""],
    ["Total fat", n.fat, " g"],
    ["Saturated fat", n.saturatedFat, " g"],
    ["Sodium", n.sodium, " mg"],
    ["Total carbohydrate", n.carbs, " g"],
    ["Dietary fiber", n.fiber, " g"],
    ["Total sugars", n.sugar, " g"],
    ["Added sugars", n.addedSugar, " g"],
    ["Protein", n.protein, " g"],
  ];
  return rows.filter(([, v]) => v != null).map(([label, v, unit]) => `${label}: ${Math.round(v! * 10) / 10}${unit}`);
};

// ---------- PDF ----------

const FRACTIONS: Record<string, string> = { "⅓": "1/3", "⅔": "2/3", "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅙": "1/6", "⅚": "5/6", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8" };

async function recipePdf(r: ExportRecipe, photo: Buffer | null) {
  const doc = await PDFDocument.create();
  doc.setTitle(r.title);
  doc.setProducer(`RecipeHub ${APP_VERSION}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // The standard fonts only have the usual Western characters: ½ ° é stay, ⅓ becomes 1/3
  const known = new Set(font.getCharacterSet());
  const clean = (s: string) =>
    [...s.normalize("NFC").replace(/[⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (c) => FRACTIONS[c]).replace(/[‐-‒]/g, "-")]
      .map((c) => (known.has(c.codePointAt(0)!) ? c : c.normalize("NFD").replace(/[̀-ͯ]/g, "")))
      .map((c) => (c.length === 1 && known.has(c.codePointAt(0)!) ? c : c === "\n" ? c : "?"))
      .join("");
  const W = 612, H = 792, M = 54, inner = W - 2 * M;
  const ink = rgb(0.12, 0.12, 0.12), soft = rgb(0.38, 0.38, 0.38), green = rgb(0.1, 0.5, 0.29);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const pages: PDFPage[] = [page];
  const room = (h: number) => {
    if (y - h < M + 20) {
      page = doc.addPage([W, H]);
      pages.push(page);
      y = H - M;
    }
  };
  const wrap = (text: string, f: PDFFont, size: number, width: number) => {
    const out: string[] = [];
    for (const para of clean(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) <= width) line = next;
        else {
          if (line) out.push(line);
          line = word;
        }
      }
      out.push(line);
    }
    return out;
  };
  const write = (text: string, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number } = {}) => {
    const size = o.size ?? 11, f = o.f ?? font, x = o.x ?? M, lh = size * 1.35;
    for (const line of wrap(text, f, size, o.width ?? inner - (x - M))) {
      room(lh);
      page.drawText(line, { x, y: y - size, size, font: f, color: o.color ?? ink });
      y -= lh;
    }
    y -= o.gap ?? 0;
  };
  const heading = (text: string) => {
    room(40);
    y -= 8;
    write(text, { size: 15, f: bold, color: green, gap: 4 });
  };

  if (photo) {
    const img = await doc.embedJpg(photo);
    const h = Math.min(210, (img.height / img.width) * inner);
    const w = (img.width / img.height) * h;
    page.drawImage(img, { x: M + (inner - w) / 2, y: y - h, width: w, height: h });
    y -= h + 18;
  }
  write(r.title, { size: 24, f: bold, gap: 4 });
  if (r.description) write(r.description, { size: 12, color: soft, gap: 4 });
  const meta = [r.servings ? `Serves ${r.servings}` : r.yieldText ? `Makes ${r.yieldText}` : null, r.prepMinutes && `Prep ${minutes(r.prepMinutes)}`, r.cookMinutes && `Cook ${minutes(r.cookMinutes)}`, r.totalMinutes && `Total ${minutes(r.totalMinutes)}`].filter(Boolean).join("   ·   ");
  if (meta) write(meta, { size: 10.5, color: soft, gap: 2 });
  const source = r.sourceName || (r.sourceUrl && new URL(r.sourceUrl).hostname.replace(/^www\./, ""));
  if (source) write(`From ${source}${r.sourceUrl ? ` (${r.sourceUrl})` : ""}`, { size: 10, color: soft, gap: 2 });

  heading("Ingredients");
  for (const i of r.ingredients) {
    if (i.section) {
      y -= 4;
      write(i.section.toUpperCase(), { size: 10, f: bold, color: soft, gap: 1 });
    } else {
      room(15);
      page.drawText("•", { x: M + 2, y: y - 11, size: 11, font, color: green });
      write(i.raw, { x: M + 16, gap: 2 });
    }
  }

  heading("Steps");
  let n = 0;
  for (const s of r.steps) {
    if (s.section) {
      y -= 4;
      write(s.section.toUpperCase(), { size: 10, f: bold, color: soft, gap: 2 });
      continue;
    }
    room(15);
    page.drawText(`${++n}.`, { x: M, y: y - 11, size: 11, font: bold, color: green });
    write(s.text, { x: M + 22, gap: 6 });
  }

  const facts = nutritionLines(r.nutrition);
  if (facts.length) {
    heading(`Nutrition${r.nutrition?.servingSize ? ` (per serving, ${r.nutrition.servingSize})` : " (per serving)"}`);
    for (const line of facts) {
      const [label, value] = line.split(": ");
      room(15);
      page.drawText(clean(label), { x: M, y: y - 10.5, size: 10.5, font: label === "Calories" ? bold : font, color: ink });
      page.drawText(clean(value), { x: M + 180, y: y - 10.5, size: 10.5, font: bold, color: ink });
      y -= 15;
    }
  }
  if (r.notes) {
    heading("Notes");
    write(r.notes, { gap: 4 });
  }
  pages.forEach((p, k) => p.drawText(clean(`${r.title}  ·  RecipeHub${pages.length > 1 ? `  ·  ${k + 1} of ${pages.length}` : ""}`), { x: M, y: M - 24, size: 8, font, color: soft }));
  return Buffer.from(await doc.save());
}

// ---------- Paprika (.paprikarecipe: gzip-compressed JSON, what Paprika 3 exports) ----------

function paprika(r: ExportRecipe, photo: Buffer | null) {
  const uid = randomUUID().toUpperCase();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const p = {
    uid,
    name: r.title,
    description: r.description ?? "",
    ingredients: r.ingredients.map((i) => (i.section ? `${i.section}:` : i.raw)).join("\n"),
    directions: r.steps.map((s) => (s.section ? `# ${s.section}` : s.text)).join("\n"),
    notes: r.notes ?? "",
    nutritional_info: nutritionLines(r.nutrition).join("\n"),
    servings: r.servings ? String(r.servings) : (r.yieldText ?? ""),
    prep_time: minutes(r.prepMinutes) ?? "",
    cook_time: minutes(r.cookMinutes) ?? "",
    total_time: minutes(r.totalMinutes) ?? "",
    source: r.sourceName ?? "",
    source_url: r.sourceUrl ?? "",
    image_url: r.imageUrl && /^https?:/.test(r.imageUrl) ? r.imageUrl : "",
    photo: photo ? `${uid}.jpg` : "",
    photo_data: photo ? photo.toString("base64") : "",
    categories: r.categories.map((c) => c.name),
    rating: 0,
    difficulty: "",
    created: now,
    hash: "",
  };
  return gzipSync(Buffer.from(JSON.stringify(p), "utf8"));
}

// ---------- Meal-Master (.mmf: plain ASCII, fixed columns) ----------

// Meal-Master's two-letter units; others go in front of the ingredient
const MM_UNITS: Record<string, string> = { tsp: "t", tbsp: "T", cup: "c", "fl oz": "fl", oz: "oz", lb: "lb", g: "g", kg: "kg", mg: "mg", ml: "ml", cl: "cl", dl: "dl", l: "l", pt: "pt", qt: "qt", quart: "qt", gal: "ga", pinch: "pn", dash: "ds", drop: "dr", can: "cn", package: "pk", slice: "sl", bunch: "bn", piece: "ea" };
const ASCII: Record<string, string> = { "½": "1/2", "¼": "1/4", "¾": "3/4", ...FRACTIONS, "°": " ", "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "--", "…": "...", "×": "x", " ": " " };
const ascii = (s: string) =>
  s
    .replace(/[½¼¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞°‘’“”–—…× ]/g, (c) => ASCII[c])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "?");
const wrapAt = (s: string, width: number) => {
  const out: string[] = [];
  let line = "";
  for (const word of s.split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + word).length > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
};
const mmSection = (name: string) => {
  const t = ascii(name).toUpperCase().slice(0, 60);
  const left = Math.max(5, Math.floor((71 - t.length) / 2));
  return `MMMMM${"-".repeat(left)}${t}${"-".repeat(Math.max(5, 71 - t.length - left))}`;
};

function mealMaster(r: ExportRecipe) {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const cats = [...r.categories.map((c) => c.name), ...r.tags.map(cap)].filter((c, k, all) => all.indexOf(c) === k);
  const out = ["MMMMM----- Recipe via Meal-Master (tm) v8.05", "", `      Title: ${ascii(r.title)}`, ` Categories: ${ascii(cats.join(", ")) || "None"}`, `      Yield: ${r.servings ? `${r.servings} servings` : ascii(r.yieldText ?? "1 recipe")}`, ""];
  for (const i of r.ingredients) {
    if (i.section) {
      out.push("", mmSection(i.section));
      continue;
    }
    const amount = amountOf(i);
    const code = i.unit ? MM_UNITS[i.unit] : "";
    const text = ascii(code || !i.unit ? itemOf(i) : `${i.unit}${(i.quantityMax ?? i.quantity ?? 1) > 1 && !/s$/.test(i.unit) ? "s" : ""} ${itemOf(i)}`);
    const lines = wrapAt(text, 28);
    out.push(`${ascii(amount).padStart(7)} ${(code ?? "").padEnd(2)} ${lines[0] ?? ""}`.trimEnd() || ascii(i.raw));
    for (const more of lines.slice(1)) out.push(`${" ".repeat(11)}-${more}`);
  }
  out.push("");
  for (const s of r.steps) {
    if (s.section) out.push("", `  ${ascii(s.section).toUpperCase()}`, "");
    else out.push(...wrapAt(ascii(s.text), 74).map((l) => `  ${l}`), "");
  }
  if (r.description) out.push(...wrapAt(ascii(r.description), 74).map((l) => `  ${l}`), "");
  const facts = nutritionLines(r.nutrition);
  if (facts.length) out.push("  Per serving: " + ascii(facts.join("; ")), "");
  if (r.notes) out.push("  Notes:", ...wrapAt(ascii(r.notes), 74).map((l) => `  ${l}`), "");
  if (r.sourceName || r.sourceUrl) out.push(`  Source: ${ascii([r.sourceName, r.sourceUrl].filter(Boolean).join(", "))}`, "");
  out.push("MMMMM", "");
  return out.join("\r\n");
}

// ---------- CookML (.cml: XML, version 1.0.14) ----------

const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

function cookMl(r: ExportRecipe, photo: Buffer | null) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', `<cookml version="1.0.14" prog="RecipeHub" progver="${APP_VERSION}">`, '  <recipe lang="en">'];
  out.push(`    <head title="${x(r.title)}" servingqty="${r.servings ?? 1}" servingtype="${r.servings ? "servings" : x(r.yieldText ?? "recipe")}">`);
  for (const c of r.categories) out.push(`      <cat>${x(c.name)}</cat>`);
  if (r.notes) out.push(`      <hint>${x(r.notes)}</hint>`);
  if (r.sourceName || r.sourceUrl) out.push(`      <sourceline>${x([r.sourceName, r.sourceUrl].filter(Boolean).join(", "))}</sourceline>`);
  if (r.prepMinutes) out.push(`      <preptime type="Preparation" time="${r.prepMinutes}"/>`);
  if (r.cookMinutes) out.push(`      <preptime type="Cooking" time="${r.cookMinutes}"/>`);
  if (r.totalMinutes) out.push(`      <preptime type="Total" time="${r.totalMinutes}"/>`);
  if (photo) out.push(`      <picbin format="JPG">${photo.toString("base64")}</picbin>`);
  out.push("    </head>");
  if (r.description) out.push(`    <remark>${x(r.description)}</remark>`);
  // Ingredients by part: the ones before any heading, then one part per heading
  let open = false;
  const part = (title: string) => {
    if (open) out.push("    </part>");
    out.push(`    <part title="${x(title)}">`);
    open = true;
  };
  for (const i of r.ingredients) {
    if (i.section) {
      part(i.section);
      continue;
    }
    if (!open) part("Ingredients");
    const attrs = [i.quantity != null && `qty="${Math.round(i.quantity * 1000) / 1000}"`, i.unit && `unit="${x(i.unit)}"`, `item="${x(i.name ?? i.raw)}"`, i.note && `preparation="${x(i.note)}"`].filter(Boolean).join(" ");
    out.push(`      <ingredient ${attrs}/>`);
  }
  if (open) out.push("    </part>");
  out.push("    <preparation>");
  for (const s of r.steps) out.push(`      <text>${x(s.section ? s.section.toUpperCase() : s.text)}</text>`);
  out.push("    </preparation>", "  </recipe>", "</cookml>", "");
  return out.join("\n");
}
