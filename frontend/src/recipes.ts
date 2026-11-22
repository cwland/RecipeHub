// Recipe shapes from the API, and small helpers the recipe screens share

export interface Ingredient {
  raw: string;
  quantity?: number | null;
  quantityMax?: number | null;
  unit?: string | null;
  name?: string;
  note?: string | null;
  section?: string | null; // a heading instead of an ingredient
}

export interface Step {
  text: string;
  section?: string | null; // a heading instead of a step
}

export interface Named {
  id: number;
  name: string;
}

export interface Substitution {
  id: number;
  kind: "swap" | "add"; // a swap, or an item added
  original: string | null; // a swap: what it's instead of
  line: string | null; // the ingredient line it swaps, when one was picked
  amount: string | null;
  unit: string | null;
  item: string | null;
  replacement: string; // all of it: "3/4 cup Greek yogurt"
  note: string | null;
  appliedVersion: number | null; // Make a new version: the version it went into
  createdAt: string;
}

// Ingredients in the order to show them (the positions in the list): as entered, or A to Z by the
// ingredient itself (not its amount) within each section, headings staying where they are
const nameOf = (i: Ingredient) => (i.name || i.raw.replace(/^[\d\s.,/¼½¾⅓⅔⅛-]+(?:(?:cups?|tbsps?|tsps?|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l|litres?|liters?|cloves?|cans?|pinch(?:es)?)\.?\s+)?/i, "")).toLowerCase();
export function ingredientOrder(list: Ingredient[], order: "entered" | "alpha" = "entered"): number[] {
  const at = list.map((_, n) => n);
  if (order !== "alpha") return at;
  const out: number[] = [];
  let run: number[] = [];
  const flush = () => (out.push(...run.sort((a, b) => nameOf(list[a]).localeCompare(nameOf(list[b])) || a - b)), (run = []));
  for (const n of at) {
    if (list[n].section) {
      flush();
      out.push(n);
    } else run.push(n);
  }
  flush();
  return out;
}

export interface Mine {
  favorite: boolean;
  pinned: boolean;
  rating: number | null;
  notes: string | null;
}

export interface Recipe {
  id: number;
  title: string;
  description: string | null;
  ingredients: Ingredient[];
  steps: Step[];
  servings: number | null;
  yieldText: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  sourceUrl: string | null;
  sourceName: string | null;
  imageUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  categories: Named[];
  collections: Named[];
  me: Mine;
  substitutions: Substitution[];
  nutrition: Nutrition | null;
  nutritionUpdating?: boolean; // Auto nutrition is working it out right now
  versioning?: boolean; // Recipe versioning is on (the Version history tab shows)
}

// What AI Enhance suggests (POST /api/recipes/:id/enhance); nothing is saved until applied
export interface EnhanceSection<T> {
  suggested: T;
  changes: string[];
  changed: boolean;
}
export interface Enhancement {
  steps: EnhanceSection<string[]> & { mode?: "expanded" | "filled" | null }; // expanded: brief steps rewritten in full
  ingredients: EnhanceSection<string[]>;
  nutrition: EnhanceSection<Nutrition | null>;
  organize: { categories: string[]; newCategories: string[]; tags: string[]; changes: string[]; changed: boolean };
}

// Per serving: grams, calories in kcal, sodium in mg
export interface Nutrition {
  calories: number | null;
  fat: number | null;
  saturatedFat: number | null;
  carbs: number | null;
  fiber: number | null;
  sugar: number | null; // total sugars
  addedSugar?: number | null; // the part that's added (older recipes don't have it)
  protein: number | null;
  sodium: number | null;
  source: "site" | "ai" | "you";
  servings?: number | null;
  servingSize?: string | null; // "About 1½ cups (340 g)"
  note?: string | null;
  outdated?: boolean; // the ingredients changed since these numbers
  perIngredient?: { line: string; grams: number | null; calories: number }[]; // worked out one ingredient at a time (AI)
}
// A points-style estimate (like the ones diet programs use) from calories, saturated fat, sugar and
// protein. Only added sugar counts when it's known (fruit and milk sugar don't), else total sugar.
// Approximate, not any program's official number.
export function pointsEstimate(n: Nutrition): number | null {
  if (n.calories === null) return null;
  const sugar = n.addedSugar ?? n.sugar ?? 0;
  return Math.max(0, Math.round(n.calories * 0.0305 + (n.saturatedFat ?? 0) * 0.275 + sugar * 0.12 - (n.protein ?? 0) * 0.098));
}

export interface RecipeSummary {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  servings: number | null;
  yieldText: string | null;
  totalMinutes: number | null;
  sourceName: string | null;
  favorite: boolean;
  pinned: boolean;
  rating: number | null;
  tags: string[];
  updatedAt: string;
}

export interface TagInfo extends Named {
  count: number;
}
export interface CollectionInfo extends Named {
  description: string | null;
  count: number;
  images: string[];
}

// 95 -> "1 hr 35 min"
export function formatMinutes(m: number | null | undefined) {
  if (!m) return null;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return [h ? `${h} hr` : "", min ? `${min} min` : ""].filter(Boolean).join(" ");
}

// "www.seriouseats.com" from a link
export function siteName(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const FRACTIONS: [number, string][] = [[1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [3 / 8, "⅜"], [1 / 2, "½"], [5 / 8, "⅝"], [2 / 3, "⅔"], [3 / 4, "¾"], [7 / 8, "⅞"]];
// 1.5 -> "1½", 0.333 -> "⅓"
export function formatQuantity(n: number) {
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  if (frac < 0.02) return String(whole);
  if (frac > 0.98) return String(whole + 1);
  const near = FRACTIONS.find(([v]) => Math.abs(v - frac) < 0.02);
  if (near) return `${whole || ""}${near[1]}`;
  return String(Math.round(n * 100) / 100);
}

// Text for the editor: ingredients one per line (headings end with ":"), steps with a blank line between
export const ingredientsText = (list: Ingredient[]) => list.map((i) => (i.section ? `${i.section}:` : i.raw)).join("\n");
export const stepsText = (list: Step[]) => list.map((s) => (s.section ? `# ${s.section}` : s.text)).join("\n\n");

// Recipes page addresses: #/recipes, #/recipes?tag=x, #/recipes/12, #/recipes/12/edit, #/recipes/12/cook, #/recipes/new, #/recipes/review/31, #/recipes/improving/40
export type RecipeRoute = { view: "away" } | { view: "list"; params: URLSearchParams } | { view: "recipe"; id: number } | { view: "edit"; id: number } | { view: "cook"; id: number } | { view: "new" } | { view: "review"; job: number } | { view: "improving"; job: number } | { view: "receive" };
export function recipeRoute(): RecipeRoute {
  const [path, query] = window.location.hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean); // ["recipes", "12", "edit"]
  // No section at all ("", "#/") is Recipes, as AppShell reads it: opening RecipeHub while signed in
  if (parts.length > 0 && parts[0] !== "recipes") return { view: "away" }; // leaving for another section
  if (parts[1] === "new") return { view: "new" };
  if (parts[1] === "review" && Number(parts[2]) > 0) return { view: "review", job: Number(parts[2]) }; // #/recipes/review/31: an import's recipes, one by one
  if (parts[1] === "receive") return { view: "receive" }; // #/recipes/receive: a page from the Send to RecipeHub bookmark
  if (parts[1] === "improving" && Number(parts[2]) > 0) return { view: "improving", job: Number(parts[2]) }; // #/recipes/improving/40: a batch of AI improvements at work
  const id = Number(parts[1]);
  if (id > 0) return parts[2] === "edit" ? { view: "edit", id } : parts[2] === "cook" ? { view: "cook", id } : { view: "recipe", id };
  return { view: "list", params: new URLSearchParams(query ?? "") };
}

// The list as you last left it (search, collection, tag...), for the recipe page's back link
let lastList = "#/recipes";
export const rememberList = (hash: string) => void (lastList = hash);
// Recipes were added or changed somewhere else (an import finished): the recipe list reloads
export const recipesChanged = () => window.dispatchEvent(new Event("recipehub:recipes-changed"));
export const listAddress = () => lastList;

// Word units read naturally: "3 cloves", "2 cans" (abbreviations like tbsp and g stay as they are)
const PLURAL: Record<string, string> = { pinch: "pinches", dash: "dashes", box: "boxes", bunch: "bunches", inch: "inches" };
const WORD_UNITS = new Set(["cup", "clove", "can", "jar", "bottle", "package", "bag", "stick", "slice", "piece", "sprig", "head", "stalk", "handful", "scoop", "sheet", "strip", "fillet", "drop", ...Object.keys(PLURAL)]);
export function unitLabel(unit: string | null | undefined, amount: number | null | undefined) {
  if (!unit) return "";
  if (!WORD_UNITS.has(unit) || !amount || amount <= 1) return unit;
  return PLURAL[unit] ?? `${unit}s`;
}

// ---------- grocery and pantry ----------

export interface ItemSource {
  recipeId?: number;
  title: string;
}
export interface GroceryItem {
  id: number;
  listId: number;
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  aisle: string;
  checked: boolean;
  sources: ItemSource[];
}
export interface GroceryList {
  id: number;
  name: string;
  open: number;
  done: number;
  archivedAt?: string | null; // only on archived lists (GET /api/grocery/lists?archived=1)
}
export interface PantryItem {
  id: number;
  name: string;
  quantity: number | null;
  unit: string | null;
  aisle: string;
  staple: boolean;
  expiresOn: string | null;
  note: string | null;
}
export interface PreviewLine {
  key: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  aisle: string;
  sources: ItemSource[];
  pantry: { id: number; name: string; staple: boolean; quantity: number | null; unit: string | null } | null;
}
export const AISLE_NAMES: Record<string, string> = {
  produce: "Produce",
  meat: "Meat & Seafood",
  dairy: "Dairy & Eggs",
  bakery: "Bakery",
  pantry: "Pantry",
  spices: "Spices & Seasonings",
  frozen: "Frozen",
  beverages: "Drinks",
  snacks: "Snacks",
  household: "Household",
  other: "Other",
};
export const AISLE_ORDER = Object.keys(AISLE_NAMES);

// "2¼ cups", "3", "" (just "some")
export function itemAmount(i: { quantity: number | null; unit: string | null }) {
  if (i.quantity === null) return i.unit ?? "";
  // shopping amounts: to the nearest kitchen fraction (2.19 cups -> 2¼ cups)
  const whole = Math.floor(i.quantity);
  const snaps = [0, 1, ...FRACTIONS.map(([v]) => v)];
  const frac = snaps.reduce((a, b) => (Math.abs(b - (i.quantity! - whole)) < Math.abs(a - (i.quantity! - whole)) ? b : a));
  const q = Math.max(whole + frac, FRACTIONS[0]?.[0] ?? 0.125);
  return [formatQuantity(q), unitLabel(i.unit, q)].filter(Boolean).join(" ");
}

// ---------- what people type in the editor ----------

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12 };

// "4", "4.5" (-> 5), "2-3" / "2 to 3" (-> 2), "four", "serves 6" -> a whole number; undefined if it isn't one
export function parseServings(s: string): number | null | undefined {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  const n = t.match(/\d+(?:[.,]\d+)?/)?.[0];
  if (n) return Math.max(1, Math.round(Number(n.replace(",", "."))));
  const word = t.split(/[\s-]+/).find((w) => w in NUMBER_WORDS);
  return word ? NUMBER_WORDS[word] : undefined;
}

// "90", "1 hr", "1 hour 15 min", "1:30", "1.5 hours", "45m", "an hour" -> minutes; undefined if it isn't a time
export function parseMinutes(s: string): number | null | undefined {
  const t = s.trim().toLowerCase().replace(/,/g, ".");
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t));
  const clock = t.match(/^(\d+):(\d{1,2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const FR: Record<string, number> = { "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75 };
  // "1 1/2", "1½", "3/4", "1.5", "an", "half"
  const num = (x: string) => {
    const f = x.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
    if (f) return Number(f[1] ?? 0) + Number(f[2]) / Number(f[3]);
    const u = x.match(/^(\d*)([½⅓⅔¼¾])$/);
    if (u) return Number(u[1] || 0) + FR[u[2]];
    return x in NUMBER_WORDS ? NUMBER_WORDS[x] : x === "half" || x === "half an" ? 0.5 : Number(x);
  };
  let total = 0;
  let found = false;
  for (const m of t.matchAll(/(\d+\s+\d+\/\d+|\d+\/\d+|\d*[½⅓⅔¼¾]|\d+(?:\.\d+)?|an?|one|two|three|four|five|six|half(?: an)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/g)) {
    total += num(m[1]) * (m[2].startsWith("h") ? 60 : 1);
    found = true;
  }
  if (/and a half/.test(t) && found) total += /hour|hr/.test(t) ? 30 : 0.5;
  return found ? Math.round(total) : undefined;
}

// "Pat dry: Pat the chops dry…" -> ["Pat dry:", " Pat the chops dry…"]: a short label at the start of a step
export function stepLabel(text: string): [string, string] | null {
  const m = text.match(/^(\p{Lu}[\p{L}'’&-]*(?: [\p{L}'’&-]+){0,3}:)(\s+\S[\s\S]*)$/u);
  return m ? [m[1], m[2]] : null;
}
