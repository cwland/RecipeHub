// Grocery helpers: store aisles, matching an item to the same thing elsewhere (list, pantry), and
// adding amounts together.

export const AISLES = [
  { id: "produce", name: "Produce" },
  { id: "meat", name: "Meat & Seafood" },
  { id: "dairy", name: "Dairy & Eggs" },
  { id: "bakery", name: "Bakery" },
  { id: "pantry", name: "Pantry" },
  { id: "spices", name: "Spices & Seasonings" },
  { id: "frozen", name: "Frozen" },
  { id: "beverages", name: "Drinks" },
  { id: "snacks", name: "Snacks" },
  { id: "household", name: "Household" },
  { id: "other", name: "Other" },
] as const;
export type Aisle = (typeof AISLES)[number]["id"];
export const AISLE_IDS = AISLES.map((a) => a.id) as [Aisle, ...Aisle[]];

// Words that put an item in an aisle (checked as whole words, longest phrases first)
const WORDS: Record<Exclude<Aisle, "other">, string[]> = {
  produce: ["apple", "avocado", "banana", "basil", "bell pepper", "berries", "blueberries", "broccoli", "cabbage", "carrot", "cauliflower", "celery", "cilantro", "corn", "cucumber", "dill", "eggplant", "garlic", "ginger", "grape", "green onion", "herbs", "jalapeno", "jalapeño", "kale", "leek", "lemon", "lettuce", "lime", "mango", "mint", "mushroom", "onion", "orange", "parsley", "peach", "pear", "pepper", "potato", "raspberries", "romaine", "rosemary", "sage", "scallion", "shallot", "spinach", "squash", "strawberries", "sweet potato", "thyme", "tomato", "zucchini", "arugula", "chive", "fennel", "radish", "beet", "asparagus", "green bean", "pineapple", "watermelon", "melon", "cherry tomato", "salad"],
  meat: ["bacon", "beef", "chicken", "chuck", "fish", "ground beef", "ground turkey", "ham", "lamb", "pork", "prosciutto", "salmon", "sausage", "shrimp", "steak", "tuna steak", "turkey", "cod", "tilapia", "brisket", "ribs", "chorizo", "pancetta", "scallops", "crab", "lobster", "mussels", "anchovy", "breast", "thigh", "drumstick", "tenderloin", "sirloin", "meatball"],
  dairy: ["butter", "buttermilk", "cheddar", "cheese", "cottage cheese", "cream", "cream cheese", "egg", "feta", "greek yogurt", "half and half", "heavy cream", "milk", "mozzarella", "parmesan", "ricotta", "sour cream", "yogurt", "goat cheese", "gruyere", "mascarpone", "ghee", "creme fraiche", "brie", "provolone", "swiss", "monterey jack", "pecorino"],
  bakery: ["bagel", "baguette", "bread", "bun", "ciabatta", "croissant", "english muffin", "pita", "roll", "sourdough", "tortilla", "naan", "brioche", "flatbread"],
  pantry: ["baking powder", "baking soda", "beans", "black beans", "breadcrumbs", "broth", "brown sugar", "canned", "chickpeas", "chocolate", "chocolate chips", "cocoa", "coconut milk", "cornstarch", "couscous", "crushed tomatoes", "diced tomatoes", "flour", "honey", "jam", "kidney beans", "ketchup", "lentils", "maple syrup", "mayonnaise", "mustard", "noodles", "nuts", "oats", "oil", "olive oil", "pasta", "peanut butter", "panko", "quinoa", "rice", "soy sauce", "spaghetti", "stock", "sugar", "syrup", "tomato paste", "tomato sauce", "vanilla", "vinegar", "worcestershire", "yeast", "almonds", "walnuts", "pecans", "raisins", "marinara", "salsa", "sriracha", "hot sauce", "tahini", "fish sauce", "hoisin", "molasses", "cornmeal", "powdered sugar", "evaporated milk", "condensed milk", "macaroni", "penne", "lasagna", "rigatoni", "fettuccine", "linguine", "orzo", "ramen", "sesame oil", "vegetable oil", "canola oil", "coconut oil", "san marzano"],
  spices: ["allspice", "bay leaf", "bay leaves", "black pepper", "cardamom", "cayenne", "chili powder", "cinnamon", "clove", "cloves", "coriander", "cumin", "curry powder", "garlic powder", "italian seasoning", "nutmeg", "onion powder", "oregano", "paprika", "pepper flakes", "red pepper flakes", "salt", "smoked paprika", "turmeric", "seasoning", "kosher salt", "sea salt", "peppercorns", "garam masala", "dried basil", "dried thyme", "ground ginger", "sesame seeds", "fennel seed", "mustard seed", "za'atar", "sumac", "five spice"],
  frozen: ["frozen", "ice cream", "frozen peas", "frozen corn", "frozen spinach", "puff pastry", "pie crust", "popsicle"],
  beverages: ["beer", "coffee", "juice", "soda", "sparkling water", "tea", "water", "wine", "kombucha", "lemonade"],
  snacks: ["chips", "cookies", "crackers", "popcorn", "pretzels", "granola bar", "candy", "trail mix"],
  household: ["aluminum foil", "dish soap", "foil", "napkins", "paper towels", "parchment", "plastic wrap", "sponge", "toilet paper", "trash bags", "zip bags", "detergent", "batteries"],
};
const PHRASES = Object.entries(WORDS)
  .flatMap(([aisle, list]) => list.map((w) => ({ aisle: aisle as Aisle, w })))
  .sort((a, b) => b.w.length - a.w.length);

// "2 lb boneless chicken thighs" -> meat, "frozen peas" -> frozen (the longest match wins)
export function guessAisle(name: string): Aisle {
  const n = ` ${name.toLowerCase().replace(/[^a-zà-ÿ' ]+/g, " ").replace(/\s+/g, " ")} `;
  for (const { aisle, w } of PHRASES) {
    const re = new RegExp(`\\s${w.replace(/ /g, "\\s")}(?:s|es)?\\s`);
    if (re.test(n)) return aisle;
  }
  return "other";
}

// The same thing, written differently: "Large Yellow Onions" and "onion" -> "onion"
const FILLER = new Set(["fresh", "large", "small", "medium", "chopped", "diced", "minced", "sliced", "grated", "shredded", "finely", "roughly", "thinly", "peeled", "boneless", "skinless", "organic", "ripe", "whole", "extra", "virgin", "extra-virgin", "unsalted", "salted", "softened", "melted", "cold", "warm", "room", "temperature", "to", "taste", "for", "serving", "optional", "packed", "light", "dark", "plain", "raw", "cooked", "yellow", "white", "red", "green", "of", "and", "or", "a", "the", "some", "about"]);
const singular = (w: string) => (w.length > 3 && /(?:ch|sh|x|ss|o)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && /ies$/.test(w) ? `${w.slice(0, -3)}y` : w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);
export function itemKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .split(/,/)[0]
    .split(/[^a-zà-ÿ'-]+/)
    .filter((w) => w && !FILLER.has(w))
    .map(singular);
  return words.join(" ") || name.toLowerCase().trim();
}
// Pantry match: the same key, or the pantry item's key is the end of this one ("chicken stock" has "stock"? no: needs all words)
export const sameItem = (a: string, b: string) => {
  const x = itemKey(a);
  const y = itemKey(b);
  return x === y || (x.split(" ").length > 1 && y.split(" ").length > 1 && (x.endsWith(` ${y}`) || y.endsWith(` ${x}`)));
};

// ---------- amounts ----------

const VOLUME: Record<string, number> = { tsp: 4.929, tbsp: 14.787, "fl oz": 29.574, cup: 236.588, pt: 473.176, qt: 946.353, gal: 3785.41, ml: 1, cl: 10, dl: 100, l: 1000 };
const WEIGHT: Record<string, number> = { oz: 28.3495, lb: 453.592, g: 1, kg: 1000, mg: 0.001 };
const family = (u: string | null) => (u && u in VOLUME ? VOLUME : u && u in WEIGHT ? WEIGHT : null);

// Can these be added up? Same unit (or both none), or both volumes, or both weights
export function addable(a: string | null, b: string | null) {
  if ((a ?? null) === (b ?? null)) return true;
  const f = family(a);
  return !!f && f === family(b);
}
// q in unit `from` -> in unit `to` (same family)
export function convertTo(q: number, from: string | null, to: string | null) {
  if ((from ?? null) === (to ?? null) || !from || !to) return q;
  const f = family(from)!;
  return (q * f[from]) / f[to];
}
export const round = (n: number) => Math.round(n * 100) / 100;

// Bigger units once an amount adds up: 35 tbsp -> 2.19 cup, 24 oz -> 1.5 lb, 1500 g -> 1.5 kg
const STEP_UP: [string, number, string][] = [["tsp", 6, "tbsp"], ["tbsp", 8, "cup"], ["oz", 16, "lb"], ["g", 1000, "kg"], ["ml", 1000, "l"]];
export function tidy(quantity: number, unit: string | null): { quantity: number; unit: string | null } {
  let q = quantity;
  let u = unit;
  for (const [from, at, to] of STEP_UP) if (u === from && q >= at) (q = convertTo(q, from, to)), (u = to);
  return { quantity: round(q), unit: u };
}

// A typed line, split at commas: "eggs, 2 lb chicken, milk" is three things, but a piece that is
// only how to prep it stays with the one before ("1 onion, diced", "butter, softened").
const PREP = /^(?:(?:finely|roughly|thinly|freshly|coarsely|lightly)\s+)?(?:diced|chopped|minced|sliced|grated|shredded|cubed|crushed|peeled|softened|melted|beaten|divided|drained|rinsed|halved|quartered|julienned|trimmed|cooked|room temperature|at room temperature|to taste|optional|or more|plus more|for serving|for garnish|cut\b|thawed|packed|sifted|seeded|torn|zested|juiced)/i;
export function splitLine(line: string): string[] {
  const pieces = line.split(",").map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of pieces) {
    if (out.length && PREP.test(p)) out[out.length - 1] += `, ${p}`;
    else out.push(...(/\d/.test(p) ? [p] : p.split(/\s+and\s+/).map((x) => x.replace(/^and\s+/, "").trim()).filter(Boolean)));
  }
  return out;
}

// An ingredient with no amount, as things to buy: "Salt and pepper to taste" -> salt, pepper
export function shoppingNames(name: string): string[] {
  const t = name.replace(/\b(?:to taste|as needed|for serving|for garnish|optional|if desired)\b/gi, "").replace(/[,\s]+$/, "").trim();
  return t.split(/\s*(?:,|&|\band\b)\s*/i).map((x) => x.trim().toLowerCase()).filter(Boolean);
}

// Lists are weekly: "Week of November 16", named after the Monday of today's week (server time zone)
export function weekListName(now: Date = new Date()): string {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return `Week of ${monday.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`;
}
