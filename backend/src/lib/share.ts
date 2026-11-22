import { FORMATS } from "./exports.js";
import type { Nutrition } from "../db/schema.js";
import { AISLES } from "./grocery.js";

// Sharing a recipe or a grocery list: as an email (HTML with a plain-text copy), a printable page
// (save it as a PDF from the print dialog), or schema.org JSON-LD that other recipe apps import.

export interface ShareRecipe {
  id: number;
  title: string;
  description: string | null;
  ingredients: { raw: string; section?: string | null }[];
  steps: { text: string; section?: string | null }[];
  servings: number | null;
  yieldText: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  sourceUrl: string | null;
  sourceName: string | null;
  imageUrl: string | null;
  notes: string | null;
  tags: string[];
  categories: { name: string }[];
  nutrition: Nutrition | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const minutesText = (m: number | null) => (!m ? "" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ""}`);
const iso = (m: number | null) => (m ? `PT${Math.floor(m / 60) ? `${Math.floor(m / 60)}H` : ""}${m % 60 ? `${m % 60}M` : ""}` : undefined);
// "/api/photos/x.webp" -> a full address when the app's address is known (emails need one)
const absolute = (url: string | null, appUrl: string | null) => (!url ? null : /^https?:/i.test(url) ? url : appUrl ? `${appUrl.replace(/\/+$/, "")}${url}` : null);
export const fileName = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "recipe";

// ---------- schema.org ----------

export function recipeJsonLd(r: ShareRecipe, appUrl: string | null) {
  const n = r.nutrition;
  const steps: object[] = [];
  let section: { "@type": string; name: string; itemListElement: object[] } | null = null;
  for (const s of r.steps) {
    if (s.section) {
      section = { "@type": "HowToSection", name: s.section, itemListElement: [] };
      steps.push(section);
    } else (section ? section.itemListElement : steps).push({ "@type": "HowToStep", text: s.text });
  }
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: r.title,
    ...(r.description && { description: r.description }),
    ...(absolute(r.imageUrl, appUrl) && { image: absolute(r.imageUrl, appUrl) }),
    recipeIngredient: r.ingredients.filter((i) => !i.section).map((i) => i.raw),
    recipeInstructions: steps,
    ...((r.yieldText || r.servings) && { recipeYield: r.yieldText || `${r.servings} servings` }),
    ...(r.prepMinutes && { prepTime: iso(r.prepMinutes) }),
    ...(r.cookMinutes && { cookTime: iso(r.cookMinutes) }),
    ...(r.totalMinutes && { totalTime: iso(r.totalMinutes) }),
    ...(r.categories.length && { recipeCategory: r.categories.map((c) => c.name) }),
    ...(r.tags.length && { keywords: r.tags.join(", ") }),
    ...(r.sourceUrl && { isBasedOn: r.sourceUrl }),
    ...(n && {
      nutrition: {
        "@type": "NutritionInformation",
        ...(n.calories !== null && { calories: `${Math.round(n.calories)} calories` }),
        ...(n.fat !== null && { fatContent: `${n.fat} g` }),
        ...(n.saturatedFat !== null && { saturatedFatContent: `${n.saturatedFat} g` }),
        ...(n.carbs !== null && { carbohydrateContent: `${n.carbs} g` }),
        ...(n.fiber !== null && { fiberContent: `${n.fiber} g` }),
        ...(n.sugar !== null && { sugarContent: `${n.sugar} g` }),
        ...(n.protein !== null && { proteinContent: `${n.protein} g` }),
        ...(n.sodium !== null && { sodiumContent: `${n.sodium} mg` }),
      },
    }),
  };
}

// ---------- the recipe as HTML (email and print) ----------

const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function recipeBody(r: ShareRecipe, appUrl: string | null) {
  const img = absolute(r.imageUrl, appUrl);
  const facts = factsOf(r);
  return `
<h1 style="margin:0 0 6px;font-size:28px;line-height:1.2">${esc(r.title)}</h1>
${r.description ? `<p style="margin:0 0 10px;color:#555">${esc(r.description)}</p>` : ""}
${factsHtml(facts)}
${img ? `<img src="${esc(img)}" alt="" style="display:block;width:100%;max-width:640px;max-height:360px;object-fit:cover;border-radius:12px;margin:0 0 18px">` : ""}
${recipeMain(r)}`;
}

const factsHtml = (facts: unknown[]) => (facts.length ? `<p style="margin:0 0 14px;color:#555;font-size:14px">${facts.map((f) => esc(String(f))).join(" &nbsp;·&nbsp; ")}</p>` : "");
const factsOf = (r: ShareRecipe) =>
  [
    r.prepMinutes && `Prep ${minutesText(r.prepMinutes)}`,
    r.cookMinutes && `Cook ${minutesText(r.cookMinutes)}`,
    r.totalMinutes && `Total ${minutesText(r.totalMinutes)}`,
    (r.yieldText || r.servings) && (r.yieldText || `${r.servings} servings`),
  ].filter(Boolean);

// Ingredients, steps, notes, nutrition and source (under the title and photo)
function recipeMain(r: ShareRecipe) {
  let stepNo = 0;
  const n = r.nutrition;
  return `
<div class="cols">
<div class="ing">
<h2 style="font-size:18px;margin:0 0 8px">Ingredients</h2>
<ul style="padding-left:20px;margin:0 0 18px;line-height:1.6">
${r.ingredients.map((i) => (i.section ? `</ul><h3 style="font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#666;margin:12px 0 4px">${esc(i.section)}</h3><ul style="padding-left:20px;margin:0 0 12px;line-height:1.6">` : `<li>${esc(i.raw)}</li>`)).join("\n")}
</ul>
</div>
<div class="steps">
<h2 style="font-size:18px;margin:0 0 8px">Steps</h2>
${r.steps.map((s) => (s.section ? `<h3 style="font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#666;margin:14px 0 6px">${esc(s.section)}</h3>` : `<p style="margin:0 0 12px;line-height:1.55"><strong>${++stepNo}.</strong> ${esc(s.text)}</p>`)).join("\n")}
</div>
</div>
${r.notes ? `<h2 style="font-size:18px;margin:18px 0 6px">Notes</h2><p style="margin:0;white-space:pre-line;line-height:1.55">${esc(r.notes)}</p>` : ""}
${n && n.calories !== null ? `<p style="margin:18px 0 0;font-size:13px;color:#555"><strong>Per serving:</strong> ${[`${Math.round(n.calories)} calories`, n.protein !== null && `${n.protein} g protein`, n.carbs !== null && `${n.carbs} g carbs`, n.fat !== null && `${n.fat} g fat`].filter(Boolean).join(", ")}${n.source === "ai" ? " (estimated)" : ""}</p>` : ""}
${r.sourceUrl ? `<p style="margin:18px 0 0;font-size:13px;color:#777">From <a href="${esc(r.sourceUrl)}" style="color:#1a7f4b">${esc(r.sourceName || r.sourceUrl)}</a></p>` : r.sourceName ? `<p style="margin:18px 0 0;font-size:13px;color:#777">From ${esc(r.sourceName)}</p>` : ""}`;
}

// The shared-recipe email: the photo (in the email, cid:recipe-photo), title, summary, times, the
// note, a big Open the recipe button to the public link, then the recipe itself, for reading
// without opening anything. photoCid: the photo is attached inline; else it's linked.
export function recipeEmail(r: ShareRecipe, opts: { appUrl: string | null; from: string; note?: string | null; shareUrl?: string | null; photoCid?: boolean; attached?: string | null }) {
  const img = opts.photoCid ? "cid:recipe-photo" : absolute(r.imageUrl, opts.appUrl);
  const button = opts.shareUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 6px"><tr><td style="border-radius:10px;background:#1a7f4b"><a href="${esc(opts.shareUrl)}" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">Open the recipe</a></td></tr></table>`
    : "";
  // At the bottom: the public page, and each format (the page opens with that one ready to download)
  const formats = Object.entries(FORMATS) as [string, { name: string }][];
  const downloads = opts.shareUrl
    ? `<div style="margin:16px 0 0;padding:16px 22px;background:#fff;border-radius:16px;font-size:14px">
<p style="margin:0 0 6px"><a href="${esc(opts.shareUrl)}" style="color:#1a7f4b;font-weight:700">View the recipe</a></p>
<p style="margin:0;color:#555">Download it as: ${formats.map(([id, f]) => `<a href="${esc(opts.shareUrl!)}?download=${id}" style="color:#1a7f4b;font-weight:600">${f.name}</a>`).join(" · ")}</p>
</div>`
    : "";
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;background:#f4f6f5;${font};color:#1d2b24">
<div style="max-width:640px;margin:0 auto;padding:24px 12px">
<p style="margin:0 0 14px;color:#555;font-size:15px">${esc(opts.from)} shared a recipe with you${opts.note ? ":" : "."}</p>
${opts.note ? `<p style="margin:0 0 16px;padding:12px 14px;background:#fff;border-left:4px solid #1a7f4b;border-radius:6px">${esc(opts.note)}</p>` : ""}
<div style="background:#fff;border-radius:16px;overflow:hidden">
${img ? `<img src="${esc(img)}" alt="${esc(r.title)}" width="640" style="display:block;width:100%;max-width:640px;height:auto;max-height:340px;object-fit:cover;border:0">` : ""}
<div style="padding:22px 22px 8px">
<h1 style="margin:0 0 6px;font-size:28px;line-height:1.2">${esc(r.title)}</h1>
${r.description ? `<p style="margin:0 0 10px;color:#555;font-size:16px">${esc(r.description)}</p>` : ""}
${factsHtml(factsOf(r))}
${button}
${opts.attached ? `<p style="margin:10px 0 0;font-size:13px;color:#666">The recipe is attached as ${esc(opts.attached)}.</p>` : ""}
</div>
<div style="padding:18px 22px 24px;border-top:1px solid #eef1ef">${recipeMain(r)}</div>
</div>
${downloads}
<p style="margin:16px 4px 0;font-size:12px;color:#888">Sent from RecipeHub${opts.appUrl ? ` · <a href="${esc(opts.appUrl.replace(/\/+$/, ""))}/#/recipes/${r.id}" style="color:#888">open it in RecipeHub</a>` : ""}</p>
</div></body></html>`;
  const intro = `${opts.note ? `${opts.from}: ${opts.note}` : `${opts.from} shared a recipe with you.`}\n${opts.shareUrl ? `\nOpen the recipe: ${opts.shareUrl}\n` : ""}${opts.attached ? `\nThe recipe is attached as ${opts.attached}.\n` : ""}\n`;
  const textDownloads = opts.shareUrl ? `\n\nView the recipe: ${opts.shareUrl}\nDownload it as:\n${formats.map(([id, f]) => `${f.name}: ${opts.shareUrl}?download=${id}`).join("\n")}\n` : "";
  return { subject: r.title, html, text: recipeText(r, intro) + textDownloads };
}

export function recipeText(r: ShareRecipe, intro = "") {
  let stepNo = 0;
  return `${intro}${r.title}\n${r.description ? `${r.description}\n` : ""}\nIngredients\n${r.ingredients.map((i) => (i.section ? `\n${i.section}:` : `- ${i.raw}`)).join("\n")}\n\nSteps\n${r.steps.map((s) => (s.section ? `\n${s.section}:` : `${++stepNo}. ${s.text}`)).join("\n")}\n${r.notes ? `\nNotes\n${r.notes}\n` : ""}${r.sourceUrl ? `\nFrom ${r.sourceUrl}\n` : ""}`;
}

// A page to print (or save as PDF): two columns on paper, no app around it
export function recipePrintPage(r: ShareRecipe) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.title)}</title>
<style>
body{margin:0;${font};color:#111;background:#fff}
main{max-width:820px;margin:0 auto;padding:28px 24px}
.cols{display:grid;grid-template-columns:1fr 1.6fr;gap:28px}
@media (max-width:640px){.cols{grid-template-columns:1fr}}
@media print{main{padding:0}img{max-height:240px!important}a{color:inherit}@page{margin:16mm}h2,h3{break-after:avoid}p,li{break-inside:avoid}}
</style></head><body><main>${recipeBody(r, null)}</main></body></html>`;
}

// ---------- grocery list ----------

interface ListItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  aisle: string;
  checked: boolean;
}
const FRACTIONS: [number, string][] = [[1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [1 / 2, "½"], [2 / 3, "⅔"], [3 / 4, "¾"]];
// 2.25 cup -> "2¼ cup"
export function amountText(i: { quantity: number | null; unit: string | null }) {
  if (i.quantity === null) return i.unit ?? "";
  const whole = Math.floor(i.quantity + 1e-9);
  const f = FRACTIONS.find(([v]) => Math.abs(v - (i.quantity! - whole)) < 0.03);
  const q = f ? `${whole || ""}${f[1]}` : String(Math.round(i.quantity * 100) / 100);
  return [q, i.unit].filter(Boolean).join(" ");
}

export function groceryEmail(listName: string, items: ListItem[], from: string) {
  const amount = amountText;
  const open = items.filter((i) => !i.checked);
  const groups = AISLES.map((a) => ({ a, list: open.filter((i) => i.aisle === a.id) })).filter((g) => g.list.length);
  const line = (i: (typeof open)[number]) => `${amount(i) ? `${amount(i)} ` : ""}${i.name}${i.note ? ` (${i.note})` : ""}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f5;${font};color:#1d2b24">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<p style="margin:0 0 12px;color:#555">${esc(from)} sent you the grocery list.</p>
<div style="background:#fff;border-radius:16px;padding:20px 24px">
<h1 style="margin:0 0 12px;font-size:24px">${esc(listName)} <span style="font-size:15px;color:#777;font-weight:normal">${open.length} item${open.length === 1 ? "" : "s"}</span></h1>
${groups.map((g) => `<h2 style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#777;margin:16px 0 4px">${esc(g.a.name)}</h2>${g.list.map((i) => `<p style="margin:0;padding:6px 0;border-bottom:1px solid #eee">☐ ${esc(line(i))}</p>`).join("")}`).join("\n")}
</div></div></body></html>`;
  const text = `${listName}\n${groups.map((g) => `\n${g.a.name}\n${g.list.map((i) => `[ ] ${line(i)}`).join("\n")}`).join("\n")}\n`;
  return { subject: `Grocery list: ${listName}`, html, text };
}
