// How the recipe list is shown (cards or a list, and tiles across), kept in this browser
export type RecipeView = { mode: "cards" | "list"; across: number };

const KEY = "recipehub-recipe-view";
export const MIN_ACROSS = 2;
export const MAX_ACROSS = 8;
const DEFAULT: RecipeView = { mode: "cards", across: 4 };

export function loadView(): RecipeView {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!v || typeof v !== "object") return DEFAULT;
    const n = Number(v.across);
    return {
      mode: v.mode === "list" ? "list" : "cards",
      across: clampAcross(n),
    };
  } catch {
    return DEFAULT;
  }
}

export function saveView(v: RecipeView) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode or full: it just won't stick */
  }
}

// Discover's grid has its own tiles across (cards only), kept in this browser too
const DISCOVER_KEY = "recipehub-discover-across";
const clampAcross = (n: number) => (Number.isFinite(n) ? Math.min(MAX_ACROSS, Math.max(MIN_ACROSS, Math.round(n))) : DEFAULT.across);

export function loadDiscoverAcross(): number {
  try {
    const v = JSON.parse(localStorage.getItem(DISCOVER_KEY) ?? "null");
    return v == null ? DEFAULT.across : clampAcross(Number(v));
  } catch {
    return DEFAULT.across;
  }
}

export function saveDiscoverAcross(n: number) {
  try {
    localStorage.setItem(DISCOVER_KEY, JSON.stringify(n));
  } catch {
    /* private mode or full: it just won't stick */
  }
}

// Phones always get 2 across; the picked number shows once the screen has room for it.
// Spelled out so Tailwind sees every class.
const GRID: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
  // 7 and 8 are for big monitors; a laptop screen still stops at 6
  7: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7",
  8: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8",
};
export const gridClass = (across: number) => GRID[across] ?? GRID[DEFAULT.across];
