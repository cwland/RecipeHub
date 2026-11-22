// Cooking helpers: scaling amounts, metric <-> US units, timers and temperatures in step text.
// Pure functions (tested in cooking.test.ts).
import { formatQuantity, unitLabel, type Ingredient } from "./recipes";

export type Units = "original" | "metric" | "us";

export interface Amount {
  quantity: number | null;
  quantityMax: number | null;
  unit: string | null;
}

// ---------- scaling ----------

export function scale(i: Ingredient, factor: number): Amount {
  const q = i.quantity ?? null;
  return { quantity: q === null ? null : q * factor, quantityMax: i.quantityMax ? i.quantityMax * factor : null, unit: i.unit ?? null };
}

// ---------- units ----------

// How much of a base unit each unit is: ml for volume, g for weight
const VOLUME: Record<string, number> = { tsp: 4.929, tbsp: 14.787, "fl oz": 29.574, cup: 236.588, pt: 473.176, qt: 946.353, gal: 3785.41, ml: 1, cl: 10, dl: 100, l: 1000 };
const WEIGHT: Record<string, number> = { oz: 28.3495, lb: 453.592, g: 1, kg: 1000, mg: 0.001 };
const US_VOLUME = new Set(["cup", "fl oz", "pt", "qt", "gal"]);
const METRIC_VOLUME = new Set(["ml", "cl", "dl", "l"]);
const US_WEIGHT = new Set(["oz", "lb"]);
const METRIC_WEIGHT = new Set(["g", "kg", "mg"]);

// Round metric amounts the way a measuring jug (10 ml marks) or kitchen scale (to the gram) reads
function roundMetric(n: number, step100: number) {
  if (n >= 100) return Math.round(n / step100) * step100;
  if (n >= 20) return Math.round(n / 5) * 5;
  return Math.round(n);
}
// To the nearest 1/8, or 1/4 above 2 (cups and pounds you can actually measure)
const roundUs = (n: number) => (n >= 2 ? Math.round(n * 4) / 4 : Math.max(Math.round(n * 8) / 8, 0.125));

function toMetric(value: number, unit: string): { value: number; unit: string } | null {
  if (US_VOLUME.has(unit)) {
    const ml = value * VOLUME[unit];
    return ml >= 1000 ? { value: Math.round((ml / 1000) * 100) / 100, unit: "l" } : { value: roundMetric(ml, 10), unit: "ml" };
  }
  if (US_WEIGHT.has(unit)) {
    const g = value * WEIGHT[unit];
    return g >= 1000 ? { value: Math.round((g / 1000) * 100) / 100, unit: "kg" } : { value: roundMetric(g, 5), unit: "g" };
  }
  if (unit === "inch") return { value: Math.round(value * 2.54 * 2) / 2, unit: "cm" };
  return null; // tsp, tbsp and counts are the same everywhere
}

function toUs(value: number, unit: string): { value: number; unit: string } | null {
  if (METRIC_VOLUME.has(unit)) {
    const ml = value * VOLUME[unit];
    if (ml >= 946) return { value: roundUs(ml / VOLUME.qt), unit: "qt" };
    if (ml >= 59) return { value: roundUs(ml / VOLUME.cup), unit: "cup" };
    if (ml >= 14) return { value: roundUs(ml / VOLUME.tbsp), unit: "tbsp" };
    return { value: roundUs(ml / VOLUME.tsp), unit: "tsp" };
  }
  if (METRIC_WEIGHT.has(unit)) {
    const g = value * WEIGHT[unit];
    if (g >= 440) return { value: roundUs(g / WEIGHT.lb), unit: "lb" }; // (close enough to a pound to say so)
    return { value: g >= 28 ? Math.round((g / WEIGHT.oz) * 2) / 2 : roundUs(g / WEIGHT.oz), unit: "oz" };
  }
  if (unit === "cm") return { value: roundUs(value / 2.54), unit: "inch" };
  return null;
}

export function convert(a: Amount, to: Units): Amount {
  if (to === "original" || !a.unit || a.quantity === null) return a;
  const fn = to === "metric" ? toMetric : toUs;
  const q = fn(a.quantity, a.unit);
  if (!q) return a;
  const max = a.quantityMax ? fn(a.quantityMax, a.unit) : null;
  return { quantity: q.value, quantityMax: max && max.unit === q.unit ? max.value : null, unit: q.unit };
}

// Which way a recipe leans, to offer the other: "metric" if most measured amounts are metric
export function recipeUnits(list: Ingredient[]): "metric" | "us" | null {
  let metric = 0;
  let us = 0;
  for (const i of list) {
    if (!i.unit) continue;
    if (METRIC_VOLUME.has(i.unit) || METRIC_WEIGHT.has(i.unit)) metric++;
    if (US_VOLUME.has(i.unit) || US_WEIGHT.has(i.unit)) us++;
  }
  if (!metric && !us) return null;
  return metric > us ? "metric" : "us";
}

// "1½–2 cups"
export function formatAmount(a: Amount): string {
  if (a.quantity === null) return a.unit ?? "";
  const q = formatQuantity(a.quantity) + (a.quantityMax ? `–${formatQuantity(a.quantityMax)}` : "");
  return [q, unitLabel(a.unit, a.quantityMax ?? a.quantity)].filter(Boolean).join(" ");
}

// ---------- cups and spoons <-> grams ----------

// Grams in a US cup of each (first match wins, so the specific names come first). "liquid": measured
// by volume in metric too (millilitres), never weighed. Anything not here isn't guessed.
const WEIGHTS: [RegExp, number | "liquid"][] = [
  [/chocolate chips|chocolate chunks/, 170],
  [/buttermilk/, "liquid"],
  [/peanut butter|almond butter/, 258],
  [/\bbutter\b/, 227],
  [/cream cheese/, 227],
  [/sour cream/, 230],
  [/yogh?urt/, 245],
  [/\b(milk|cream|half-and-half|half and half|water|broth|stock|juice|wine|vinegar|oil|soy sauce|beer|coffee|liqueur|rum|vodka|bourbon|whiskey)\b/, "liquid"],
  [/brown sugar/, 213],
  [/powdered sugar|confectioners'? sugar|icing sugar/, 120],
  [/\bsugar\b/, 200],
  [/almond flour|almond meal/, 96],
  [/coconut flour/, 112],
  [/bread flour/, 127],
  [/cake flour/, 114],
  [/\bflour\b/, 120],
  [/corn ?starch/, 128],
  [/cornmeal|polenta/, 138],
  [/cocoa/, 85],
  [/\boats\b/, 90],
  [/quinoa/, 170],
  [/lentils/, 192],
  [/\brice\b/, 185],
  [/honey/, 340],
  [/maple syrup/, 322],
  [/molasses/, 337],
  [/parmesan|pecorino/, 100],
  [/cheddar|mozzarella|monterey jack|pepper jack|gruyere|swiss cheese|shredded cheese/, 113],
  [/mayonnaise|\bmayo\b/, 220],
  [/raisins/, 150],
  [/walnuts/, 120],
  [/pecans/, 110],
  [/almonds/, 143],
  [/coconut/, 85],
  [/panko/, 50],
  [/bread ?crumbs/, 108],
  [/baking soda/, 230],
  [/baking powder/, 192],
  [/kosher salt/, 0], // brands differ by half: not guessed
  [/\bsalt\b/, 288],
];
function cupWeight(i: Ingredient): number | "liquid" | null {
  const text = `${i.name ?? ""} ${i.raw}`.toLowerCase();
  for (const [re, g] of WEIGHTS) if (re.test(text)) return g || null;
  return null;
}
const SPOON_OR_CUP = new Set(["tsp", "tbsp", "cup", "fl oz", "pt", "qt"]);
const roundG = (g: number) => (g >= 1000 ? `≈${Math.round(g / 100) / 10} kg` : `≈${roundMetric(g, 5)} g`);

// Metric: a dry ingredient measured in cups or spoons, as about how many grams. From the weights
// table, or else the AI's weight for this line (worked out with nutrition). Under 5 g stays in spoons.
function inGrams(i: Ingredient, factor: number, aiGrams: number | null | undefined) {
  if (!i.unit || !SPOON_OR_CUP.has(i.unit) || i.quantity == null) return null;
  const w = cupWeight(i);
  if (w === "liquid") return null;
  const cups = (scale(i, factor).quantity! * VOLUME[i.unit]) / VOLUME.cup;
  const g = w ? cups * w : aiGrams ? aiGrams * factor : null;
  if (!g || g < 5) return null;
  return { amount: roundG(g), estimate: (w ? "table" : "ai") as "table" | "ai" };
}

// US: grams of a dry ingredient the table knows, as cups or spoons
function inCups(i: Ingredient, factor: number) {
  if (!i.unit || !METRIC_WEIGHT.has(i.unit) || i.quantity == null) return null;
  const w = cupWeight(i);
  if (!w || w === "liquid") return null;
  const cups = (scale(i, factor).quantity! * WEIGHT[i.unit]) / w;
  const a: Amount = cups >= 0.25 ? { quantity: roundUs(cups), quantityMax: null, unit: "cup" } : cups * 16 >= 1 ? { quantity: roundUs(cups * 16), quantityMax: null, unit: "tbsp" } : { quantity: roundUs(cups * 48), quantityMax: null, unit: "tsp" };
  return { amount: `≈${formatAmount(a)}`, estimate: "table" as const };
}

// The line as it should read at this scale and in these units ("" amount: show the line as written).
// dried: for fresh herbs, the dried amount to use instead ("1 tsp dried"). was: the measure it was,
// when it's shown as an estimate in grams or cups ("≈240 g" was "2 cups"). aiGrams: the AI's weight
// for the whole line (nutrition's per-ingredient numbers), used when the weights table doesn't know it.
export function ingredientLine(i: Ingredient, factor: number, units: Units, aiGrams?: number | null) {
  const none = { was: null, estimate: null };
  if (i.section) return { amount: "", name: i.section, note: null, plain: true, dried: null, ...none };
  if (i.quantity == null && !i.unit) return { amount: "", name: i.raw, note: null, plain: true, dried: null, ...none };
  const base = { name: i.name ?? i.raw, note: i.note ?? null, plain: false, dried: driedEquivalent(i, factor, units) };
  const est = units === "metric" ? inGrams(i, factor, aiGrams) : units === "us" ? inCups(i, factor) : null;
  if (est) return { ...base, amount: est.amount, was: formatAmount(scale(i, factor)), estimate: est.estimate };
  return { ...base, amount: formatAmount(convert(scale(i, factor), units)), ...none };
}

// The AI's weight for each ingredient line (from nutrition worked out one ingredient at a time),
// by the line as written; nothing when the ingredients changed since
export function aiWeights(n: { perIngredient?: { line: string; grams: number | null }[] | null; outdated?: boolean } | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  if (!n || n.outdated) return m;
  for (const x of n.perIngredient ?? []) if (x.grams) m.set(x.line.trim().toLowerCase(), x.grams);
  return m;
}

// ---------- fresh herbs -> dried ----------

// Dried herbs are about three times as strong: 1 tbsp fresh = 1 tsp dried. Sprigs and bunches are
// estimates (a sprig of thyme ≈ ¼ tsp dried, of rosemary ≈ ½ tsp; a bunch ≈ 1 cup of fresh leaves).
const HERBS = /\b(basil|parsley|cilantro|coriander leaves|dill|chives|mint|oregano|thyme|rosemary|sage|tarragon|marjoram|chervil|savory|lemon balm)\b/;
const SPRIG_TSP: Record<string, number> = { rosemary: 0.5 };
const NICE = [0, 1 / 8, 1 / 4, 1 / 3, 3 / 8, 1 / 2, 5 / 8, 2 / 3, 3 / 4, 7 / 8, 1];
const nice = (n: number) => {
  const whole = Math.floor(n);
  const frac = NICE.reduce((best, f) => (Math.abs(f - (n - whole)) < Math.abs(best - (n - whole)) ? f : best), 0);
  return Math.max(whole + frac, 1 / 8);
};

export function driedEquivalent(i: Ingredient, factor: number, units: Units): string | null {
  const text = `${i.name ?? ""} ${i.raw}`.toLowerCase();
  const herb = text.match(HERBS)?.[1];
  if (!herb || /\b(dried|dry|ground)\b/.test(text) || i.quantity == null || !i.unit) return null;
  const a = scale(i, factor);
  let tsp: number; // dried, in teaspoons
  let estimate = false;
  if (i.unit === "sprig") {
    tsp = a.quantity! * (SPRIG_TSP[herb] ?? 0.25);
    estimate = true;
  } else if (i.unit === "bunch") {
    tsp = (a.quantity! * VOLUME.cup) / VOLUME.tsp / 3;
    estimate = true;
  } else if (VOLUME[i.unit] && i.unit !== "gal") {
    if (!/\bfresh\b|\b(chopped|minced|torn|leaves|sliced|snipped)\b/.test(text) && !["cilantro", "parsley", "chives", "basil", "mint", "dill"].includes(herb)) return null;
    tsp = (a.quantity! * VOLUME[i.unit]) / VOLUME.tsp / 3;
  } else return null;
  // A spoon or cup you can measure; in metric, the bigger amounts in millilitres
  let out: Amount;
  if (tsp < 2.95) out = { quantity: nice(tsp), quantityMax: null, unit: "tsp" };
  else if (tsp < 12) out = { quantity: nice(tsp / 3), quantityMax: null, unit: "tbsp" };
  else out = units === "metric" ? convert({ quantity: tsp / 48, quantityMax: null, unit: "cup" }, "metric") : { quantity: nice(tsp / 48), quantityMax: null, unit: "cup" };
  return `${estimate ? "about " : ""}${formatAmount(out)} dried`;
}

// ---------- temperatures in steps ----------

// "350°F" / "180 C" / "400 degrees F" -> the other scale (to the nearest 5), shown after it
export function convertTemperatures(text: string, units: Units): string {
  if (units === "original") return text;
  // (without ° or "degrees", only oven-size numbers: "200 C", never "2 C")
  return text.replace(/(\d{2,3})\s*(°|º|degrees?\s*)?\s*([FC])\b/g, (m, n: string, mark: string | undefined, scaleLetter: string) => {
    const v = Number(n);
    if (!mark && v < 100) return m;
    const isF = scaleLetter.toUpperCase() === "F";
    if (units === "metric" && isF) return `${Math.round((((v - 32) * 5) / 9) / 5) * 5}°C`;
    if (units === "us" && !isF) return `${Math.round(((v * 9) / 5 + 32) / 5) * 5}°F`;
    return m;
  });
}

// ---------- timers in steps ----------

export interface FoundTimer {
  start: number; // where it is in the text
  end: number;
  label: string; // "15 min", "6–8 min", "1 hr 30 min"
  seconds: number; // the timer is set to the shorter time in a range: check early
}

const WORD_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, "forty-five": 45, forty: 40, sixty: 60, ninety: 90, half: 0.5 };
const FRACTION_CHARS: Record<string, number> = { "½": 1 / 2, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 1 / 4, "¾": 3 / 4, "⅛": 1 / 8, "⅜": 3 / 8, "⅝": 5 / 8, "⅞": 7 / 8 };
const NUM = String.raw`(?:\d+(?:[.,]\d+)?\s*[½¼¾⅓⅔]?|[½¼¾⅓⅔]|\d+\s+\d\/\d|\d\/\d|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty-five|forty|sixty|ninety)`;
const UNIT = String.raw`(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b`;
const ONE = String.raw`(${NUM})(?:\s*(?:-|–|—|to|or)\s*(${NUM}))?\s*(?:and a half\s+)?${UNIT}(?:\s+and a half)?`;
const TIMER = new RegExp(String.raw`\b${ONE}(?:\s*(?:and\s+)?(${NUM})\s*(minutes?|mins?|m)\b)?`, "gi");

function num(s: string): number | null {
  const t = s.trim().toLowerCase().replace(",", ".");
  if (t in WORD_NUMBERS) return WORD_NUMBERS[t];
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d+)\s+(\d)\/(\d)$/))) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  if ((m = t.match(/^(\d)\/(\d)$/))) return Number(m[1]) / Number(m[2]);
  if ((m = t.match(/^(\d+(?:\.\d+)?)?\s*([½¼¾⅓⅔])$/))) return Number(m[1] ?? 0) + FRACTION_CHARS[m[2]];
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const secondsPer = (u: string) => (/^h/i.test(u) ? 3600 : /^m/i.test(u) ? 60 : 1);

export function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h} hr${m ? ` ${m} min` : ""}`;
  if (m) return `${m} min${s ? ` ${s} sec` : ""}`;
  return `${s} sec`;
}

export function findTimers(text: string): FoundTimer[] {
  const out: FoundTimer[] = [];
  for (const m of text.matchAll(TIMER)) {
    const [whole, a, b, unit, extraNum, extraUnit] = m;
    // single letters (h, m, s) only right after a digit ("10m"), never "a m" in a sentence
    if (/^[hms]$/i.test(unit) && !/\d\s*[hms]$/i.test(whole.replace(/\s+and.*$/, "").trim())) continue;
    const half = /and a half/i.test(whole) ? 0.5 : 0;
    const lo = num(a);
    if (lo === null) continue;
    const hi = b ? num(b) : null;
    const per = secondsPer(unit);
    const extra = extraNum ? (num(extraNum) ?? 0) * secondsPer(extraUnit) : 0;
    const seconds = Math.round((lo + half) * per + extra);
    if (seconds < 5 || seconds > 48 * 3600) continue;
    const label = hi && hi > lo ? `${formatDuration(Math.round(lo * per))}`.replace(/ (hr|min|sec)$/, "") + `–${formatDuration(Math.round((hi + half) * per))}` : formatDuration(seconds);
    out.push({ start: m.index!, end: m.index! + whole.length, label, seconds });
  }
  return out;
}

// ---------- which ingredients a step uses ----------

const STOP = new Set(["of", "and", "or", "the", "a", "an", "fresh", "large", "small", "medium", "chopped", "diced", "minced", "ground", "to", "taste", "for", "with", "into", "plus", "more"]);
const stem = (w: string) => w.replace(/(?:es|s)$/i, "");
// The words that name an ingredient: "San Marzano tomatoes" -> ["marzano", "tomato"] (skips filler words)
export function keyWords(name: string) {
  return name
    .toLowerCase()
    .split(/[^a-zÀ-ɏ]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}
export function stepUses(step: string, ingredient: Ingredient): boolean {
  if (ingredient.section) return false;
  const words = keyWords(ingredient.name ?? ingredient.raw);
  if (!words.length) return false;
  const inStep = new Set(keyWords(step));
  // the last word is usually the thing itself ("olive oil" -> oil, "kidney beans" -> bean)
  return inStep.has(words[words.length - 1]);
}

// ---------- amounts written in step text ----------

// Unit words as written in steps -> the stored unit (as the server's ingredient reader names them)
const STEP_UNITS: Record<string, string> = {};
const units = (unit: string, ...names: string[]) => names.forEach((n) => (STEP_UNITS[n] = unit));
units("cup", "cup", "cups", "c.");
units("tbsp", "tbsp", "tbsp.", "tbs", "tbs.", "tablespoon", "tablespoons");
units("tsp", "tsp", "tsp.", "teaspoon", "teaspoons");
units("fl oz", "fl oz", "fl. oz", "fl. oz.", "fluid ounce", "fluid ounces");
units("oz", "oz", "oz.", "ounce", "ounces");
units("lb", "lb", "lb.", "lbs", "lbs.", "pound", "pounds");
units("g", "g", "gram", "grams");
units("kg", "kg", "kilogram", "kilograms");
units("ml", "ml", "milliliter", "milliliters", "millilitre", "millilitres");
units("l", "l", "liter", "liters", "litre", "litres");
units("pt", "pt", "pint", "pints");
units("qt", "qt", "quart", "quarts");
units("pinch", "pinch", "pinches");
units("dash", "dash", "dashes");
units("clove", "clove", "cloves");
units("can", "can", "cans", "tin", "tins");
units("jar", "jar", "jars");
units("package", "package", "packages", "packet", "packets");
units("stick", "stick", "sticks");
units("slice", "slice", "slices");
units("bunch", "bunch", "bunches");
units("sprig", "sprig", "sprigs");
units("inch", "inch", "inches");
const STEP_UNIT_WORDS = Object.keys(STEP_UNITS).sort((a, b) => b.length - a.length);
// Spelled-out units written as words ("tablespoons"): kept spelled out, singular or plural to match
const SPELLED = /^(tablespoon|teaspoon|ounce|pound|gram|kilogram|liter|litre|milliliter|millilitre|pint|quart)s?$/i;

const AMOUNT_NUM = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+\s?[½⅓⅔¼¾⅛⅜⅝⅞]|\d+|[½⅓⅔¼¾⅛⅜⅝⅞])`;
// an amount: "2", "1½", "1 1/2", "2-3", "2 to 3", then maybe a size "(15 oz.)"
const STEP_AMOUNT = new RegExp(String.raw`(?<![\w.,/])(${AMOUNT_NUM})(?:\s*(?:-|–|to)\s*(${AMOUNT_NUM}))?(\s*\([^)]*\))?`, "g");

function numberValue(s: string): number {
  const t = s.trim();
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return +mixed[1] + +mixed[2] / +mixed[3];
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return +frac[1] / +frac[2];
  const uni = t.match(/^(\d*)\s?([½⅓⅔¼¾⅛⅜⅝⅞])$/);
  if (uni) return (uni[1] ? +uni[1] : 0) + FRACTION_CHARS[uni[2]];
  return parseFloat(t);
}

const family = (u: string | null | undefined) => (!u ? "count" : u in VOLUME ? "volume" : u in WEIGHT ? "weight" : u);

// The ingredient an amount in a step belongs to: one whose name's last word ("beans") comes in the
// words after the amount (up to the next comma or full stop), measured the same way (a count for a
// count, a volume for a volume…). None: the amount isn't scaled ("20 minutes", "2 inch pieces").
function ingredientFor(rest: string, unit: string | null, ingredients: Ingredient[]) {
  const words = new Set(keyWords(rest.split(/[,.;:!?(]|\d/)[0]));
  return ingredients.find((i) => {
    if (i.section) return false;
    const key = keyWords(i.name ?? i.raw);
    return key.length > 0 && words.has(key[key.length - 1]) && family(i.unit) === family(unit);
  });
}

// A step's text with the amounts that belong to an ingredient scaled (and in the chosen units),
// the way the ingredient list shows them. Can and package sizes in brackets stay as written.
export function scaleStepText(text: string, ingredients: Ingredient[], factor: number, to: Units): string {
  if (factor === 1 && to === "original") return text;
  let out = "";
  let at = 0;
  for (const m of text.matchAll(STEP_AMOUNT)) {
    const [whole, n1, n2, size = ""] = m;
    const start = m.index!;
    if (start < at) continue;
    const after = text.slice(start + whole.length);
    if (/^\s*(°|degrees|%)/i.test(after)) continue;
    // the unit word right after the amount ("cups", "tbsp"), if any
    const lead = after.match(/^\s+/)?.[0] ?? "";
    const lower = after.slice(lead.length).toLowerCase();
    const word = lead ? STEP_UNIT_WORDS.find((u) => lower.startsWith(u) && (lower.length === u.length || /[\s,.;:)]/.test(lower[u.length]) || u.endsWith("."))) : undefined;
    const unit = word ? STEP_UNITS[word] : null;
    if (!ingredientFor(word ? lower.slice(word.length) : lower, unit, ingredients)) continue;

    const lo = numberValue(n1) * factor;
    const hi = n2 ? numberValue(n2) * factor : null;
    const written = word ? after.slice(lead.length, lead.length + word.length) : "";
    const shown = convert({ quantity: lo, quantityMax: hi, unit }, to);
    let replacement: string;
    if (unit && shown.unit !== unit) {
      replacement = `${formatAmount(shown)}${size}`; // another unit now: the new amount and unit replace both
    } else {
      const number = formatQuantity(lo) + (hi ? `–${formatQuantity(hi)}` : "");
      let newWord = written;
      if (unit && (written.toLowerCase() === unit || written.toLowerCase() === unitLabel(unit, 2))) newWord = unitLabel(unit, hi ?? lo);
      else if (SPELLED.test(written)) newWord = written.replace(/s$/i, "") + ((hi ?? lo) > 1 ? "s" : "");
      replacement = `${number}${size}${word ? lead + newWord : ""}`;
    }
    out += text.slice(at, start) + replacement;
    at = start + whole.length + (word ? lead.length + word.length : 0);
  }
  return out + text.slice(at);
}
