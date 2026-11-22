import type { Ingredient } from "../db/schema.js";

// Reads ingredient lines as people write them:
//   "1 1/2 cups flour, sifted"   -> 1.5 cup  flour       (note: sifted)
//   "2-3 cloves garlic, minced"  -> 2-3 clove garlic     (note: minced)
//   "1 (14 oz) can tomatoes"     -> 1 can     tomatoes    (note: 14 oz)
//   "½ tsp salt"                 -> 0.5 tsp   salt
//   "One pound of sausage"       -> 1 lb      sausage     (amounts in words too)
//   "Salt and pepper to taste"   -> no quantity: Salt and pepper (note: to taste)
//   "For the sauce:"             -> a section heading

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 1 / 2, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 1 / 4, "¾": 3 / 4, "⅕": 1 / 5, "⅖": 2 / 5, "⅗": 3 / 5, "⅘": 4 / 5,
  "⅙": 1 / 6, "⅚": 5 / 6, "⅛": 1 / 8, "⅜": 3 / 8, "⅝": 5 / 8, "⅞": 7 / 8,
};

// Unit spellings -> the one name we store. Case-sensitive keys first ("T" is a tablespoon, "t" a teaspoon).
const CASE_SENSITIVE: Record<string, string> = { T: "tbsp", Tb: "tbsp", Tbs: "tbsp", t: "tsp" };
const UNITS: Record<string, string> = {};
const add = (unit: string, ...names: string[]) => names.forEach((n) => (UNITS[n] = unit));
add("cup", "cup", "cups", "c", "c.");
add("tbsp", "tbsp", "tbsp.", "tbs", "tbs.", "tablespoon", "tablespoons", "tbl", "tbl.");
add("tsp", "tsp", "tsp.", "teaspoon", "teaspoons");
add("fl oz", "fl oz", "fl. oz", "fl. oz.", "fluid ounce", "fluid ounces");
add("oz", "oz", "oz.", "ounce", "ounces");
add("lb", "lb", "lb.", "lbs", "lbs.", "pound", "pounds");
add("g", "g", "g.", "gram", "grams", "gramme", "grammes", "gr");
add("kg", "kg", "kgs", "kilogram", "kilograms");
add("mg", "mg", "milligram", "milligrams");
add("ml", "ml", "ml.", "milliliter", "milliliters", "millilitre", "millilitres");
add("cl", "cl", "centiliter", "centiliters");
add("dl", "dl", "deciliter", "deciliters");
add("l", "l", "liter", "liters", "litre", "litres");
add("pt", "pt", "pt.", "pint", "pints");
add("qt", "qt", "qt.", "quart", "quarts");
add("gal", "gal", "gallon", "gallons");
add("pinch", "pinch", "pinches");
add("dash", "dash", "dashes");
add("drop", "drop", "drops");
add("clove", "clove", "cloves");
add("can", "can", "cans", "tin", "tins");
add("jar", "jar", "jars");
add("bottle", "bottle", "bottles");
add("package", "package", "packages", "pkg", "pkg.", "packet", "packets", "pack", "packs");
add("box", "box", "boxes");
add("bag", "bag", "bags");
add("stick", "stick", "sticks");
add("slice", "slice", "slices");
add("piece", "piece", "pieces", "pc", "pcs");
add("bunch", "bunch", "bunches");
add("sprig", "sprig", "sprigs");
add("head", "head", "heads");
add("stalk", "stalk", "stalks");
add("handful", "handful", "handfuls");
add("scoop", "scoop", "scoops");
add("sheet", "sheet", "sheets");
add("strip", "strip", "strips");
add("fillet", "fillet", "fillets");
add("quart", "quart");
add("inch", "inch", "inches", "in.");

// Longest first, so "fl oz" wins over "fl" and "tablespoons" over "t"
const UNIT_WORDS = Object.keys(UNITS).sort((a, b) => b.length - a.length);

const NUMBER = String.raw`(?:\d+-\d+\/\d+|\d+\s+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|\d+|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])`;
const QUANTITY = new RegExp(String.raw`^(${NUMBER})(?:\s*(?:-|–|—|to|or)\s*(${NUMBER}))?(?=\s|$|[a-zA-Z(])`, "i");

export function parseNumber(s: string): number | null {
  const t = s.trim();
  let m: RegExpMatchArray | null;
  // "1-1/2" is how some sites write one and a half
  if ((m = t.match(/^(\d+)(?:\s+|-)(\d+)\/(\d+)$/))) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  if ((m = t.match(/^(\d+)\/(\d+)$/))) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  if ((m = t.match(/^(\d+)\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$/))) return Number(m[1]) + UNICODE_FRACTIONS[m[2]];
  if (t in UNICODE_FRACTIONS) return UNICODE_FRACTIONS[t];
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

// ---------- amounts written as words ----------

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const NUM_WORD = `(${Object.keys(WORDS).join("|")})`;
// "a"/"an" counts as one only before a unit or a size ("a pinch", "a large onion"), never "a little"
const SIZE_WORDS = ["small", "medium", "large", "big", "heaping", "heaped", "level", "scant", "generous"];
const unitAt = (s: string) => {
  const lower = s.toLowerCase();
  return UNIT_WORDS.find((u) => lower.startsWith(u) && (lower.length === u.length || /[\s,.)]/.test(lower[u.length])));
};

// The amount at the start of a line, in words: its value (and the top of a range) and how long it is
function wordAmount(s: string): { n: number; max: number | null; len: number } | null {
  let m: RegExpMatchArray | null;
  if ((m = s.match(new RegExp(`^${NUM_WORD}\\s+and\\s+a\\s+half\\b`, "i")))) return { n: WORDS[m[1].toLowerCase()] + 0.5, max: null, len: m[0].length };
  if ((m = s.match(/^(?:half\s+an?|a\s+half|one\s+half)\b/i))) return { n: 0.5, max: null, len: m[0].length };
  if ((m = s.match(/^a\s+dozen\b/i))) return { n: 12, max: null, len: m[0].length };
  if ((m = s.match(new RegExp(`^${NUM_WORD}\\s*(?:-|–|—|to|or)\\s*${NUM_WORD}\\b`, "i")))) return { n: WORDS[m[1].toLowerCase()], max: WORDS[m[2].toLowerCase()], len: m[0].length };
  if ((m = s.match(new RegExp(`^${NUM_WORD}\\b`, "i")))) return { n: WORDS[m[1].toLowerCase()], max: null, len: m[0].length };
  if ((m = s.match(/^an?\s+/i))) {
    const next = s.slice(m[0].length);
    if (unitAt(next) || SIZE_WORDS.some((w) => next.toLowerCase().startsWith(w + " "))) return { n: 1, max: null, len: m[0].trimEnd().length };
  }
  return null;
}

// Phrases at the end of a name that are really notes
const TRAILING_NOTE = /\s+(to taste|for garnish(?:ing)?|for serving|for decoration|for topping|optional)\s*$/i;

// "For the sauce:", "## Sauce", "SAUCE:" -> "For the sauce" / "Sauce"
function sectionOf(line: string): string | null {
  const md = line.match(/^#{1,6}\s+(.+)$/);
  if (md) return md[1].trim();
  if (/:\s*$/.test(line) && !/\d/.test(line) && line.length <= 60) return line.replace(/:\s*$/, "").trim();
  return null;
}

export function parseIngredient(input: string): Ingredient {
  const raw = input.replace(/\s+/g, " ").trim();
  const section = sectionOf(raw);
  if (section) return { raw, section };

  // Bullets and checkboxes from pasted lists
  let rest = raw.replace(/^(?:[-*•▢☐□]\s*|\[\s?\]\s*)/, "");
  const out: Ingredient = { raw, quantity: null, quantityMax: null, unit: null, name: rest, note: null };

  const q = rest.match(QUANTITY);
  const w = q ? null : wordAmount(rest);
  if (q) {
    out.quantity = round(parseNumber(q[1]) ?? 0) || null;
    out.quantityMax = q[2] ? round(parseNumber(q[2]) ?? 0) || null : null;
    rest = rest.slice(q[0].length).trim();
  } else if (w) {
    out.quantity = w.n;
    out.quantityMax = w.max;
    rest = rest.slice(w.len).trim();
  }

  // "1 (14 oz) can tomatoes": the size in brackets is a note
  const notes: string[] = [];
  const size = rest.match(/^\(([^)]*)\)\s*/) ?? (out.quantity !== null ? rest.match(/^(\d+(?:\.\d+)?-?\s?(?:oz|ounce|g|ml|lb)\.?)\s+(?=[a-z])/i) : null);
  if (size) {
    notes.push(size[1].trim());
    rest = rest.slice(size[0].length);
  }

  if (out.quantity !== null || size) {
    const word = rest.match(/^([A-Za-z]+\.?)(?:\s|$)/)?.[1];
    if (word && CASE_SENSITIVE[word]) {
      out.unit = CASE_SENSITIVE[word];
      rest = rest.slice(word.length).trim();
    } else {
      const lower = rest.toLowerCase();
      const unit = UNIT_WORDS.find((u) => lower.startsWith(u) && (lower.length === u.length || /[\s,.)]/.test(lower[u.length]) || u.endsWith(".")));
      if (unit) {
        out.unit = UNITS[unit];
        rest = rest.slice(unit.length).trim();
      }
    }
    rest = rest.replace(/^of\s+/i, "");
    // "1 pound (450g) ground beef": a size in brackets after the unit
    const after = !size && out.unit ? rest.match(/^\(([^)]*)\)\s*/) : null;
    if (after) {
      notes.push(after[1].trim());
      rest = rest.slice(after[0].length);
    }
  }

  // "butter (softened)", "Italian seasoning (oregano, basil) to taste": words in brackets are notes
  // (a comma inside brackets doesn't split the name)
  rest = rest.replace(/\s*\(([^)]*)\)/g, (_, inside: string) => (notes.push(inside.trim()), " ")).replace(/\s+/g, " ").trim();
  // "flour, sifted"
  const comma = rest.indexOf(",");
  if (comma > 0) {
    notes.push(rest.slice(comma + 1).trim());
    rest = rest.slice(0, comma).trim();
  }
  // "parsley for garnish", "salt to taste"
  let tail: RegExpMatchArray | null;
  while ((tail = rest.match(TRAILING_NOTE)) && tail.index! > 0) {
    notes.push(tail[1]);
    rest = rest.slice(0, tail.index).trim();
  }
  out.name = rest.trim() || raw;
  out.note = notes.filter(Boolean).join("; ") || null;
  return out;
}

// One ingredient per line (blank lines skipped)
export const parseIngredientLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseIngredient);

const FRACTIONS: [number, string][] = [
  [1 / 8, "1/8"], [1 / 4, "1/4"], [1 / 3, "1/3"], [3 / 8, "3/8"], [1 / 2, "1/2"], [5 / 8, "5/8"], [2 / 3, "2/3"], [3 / 4, "3/4"], [7 / 8, "7/8"],
];

// 1.5 -> "1 1/2", 0.333 -> "1/3", 2 -> "2", 1.1 -> "1.1"
export function formatQuantity(n: number): string {
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  if (frac < 0.02) return String(whole);
  if (frac > 0.98) return String(whole + 1);
  const near = FRACTIONS.find(([v]) => Math.abs(v - frac) < 0.02);
  if (near) return whole ? `${whole} ${near[1]}` : near[1];
  return String(round(n));
}

// Imports and AI: an amount written in words becomes numbers, so the line scales.
// "One pound of ground sausage" -> "1 lb ground sausage", "half a cup of milk" -> "1/2 cup milk".
// Lines already in numbers, headings and lines with no amount are kept as they are.
export function tidyIngredientLine(line: string): string {
  const trimmed = line.trim();
  if (sectionOf(trimmed) || QUANTITY.test(trimmed)) return line;
  const w = wordAmount(trimmed);
  if (!w) return line;
  let rest = trimmed.slice(w.len).trim();
  const amount = formatQuantity(w.n) + (w.max ? `–${formatQuantity(w.max)}` : "");
  const unit = unitAt(rest);
  if (unit) {
    let word = rest.slice(0, unit.length);
    rest = rest.slice(unit.length).trim().replace(/^of\s+/i, "");
    if (UNITS[unit.toLowerCase()] === "lb") word = "lb";
    return `${amount} ${word} ${rest}`.trim();
  }
  return `${amount} ${rest}`.trim();
}
