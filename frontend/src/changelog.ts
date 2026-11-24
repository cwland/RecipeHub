// "What's new": one entry per version, newest first. Add an entry (and bump "version" in
// package.json) with each release; everyone sees it once after signing in, and any time from the
// version number in the bottom left.
export interface Release {
  version: string;
  date: string; // YYYY-MM-DD
  title?: string;
  // Plain bullets; or sorted under Added / Changed / Fixed. **Lead.** at the start shows bold.
  changes?: string[];
  added?: string[];
  changed?: string[];
  fixed?: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: "1.1.2",
    date: "2026-11-24",
    title: "Recipe chat answers",
    fixed: ["**Recipe chat answers with models that think first** (like Gemini Flash on OpenRouter). They used all their room thinking and sent back nothing, which showed as \"came back garbled\". Now they're asked to think briefly, and an empty answer moves on to your next AI service."],
  },
  {
    version: "1.1.1",
    date: "2026-11-24",
    title: "Recipe chat fix",
    fixed: ["**Recipe chat opens again.** Tapping the chat bubble showed a blank page in current versions of Chrome."],
  },
  {
    version: "1.1.0",
    date: "2026-11-24",
    title: "Recipe chat",
    added: [
      "**Chat about a recipe.** A chat bubble on every recipe and in Cook mode. Ask it to swap a missing ingredient, cut calories, make it healthier or dairy-free, or change the servings. It knows the recipe as you're viewing it, and only talks cooking.",
      "**Save a change as a new recipe.** When the chat suggests changes, say yes to Save as new recipe and it writes the whole recipe with them, ready to check in the editor. The original stays as it is.",
      "**Your own chats.** Everyone in the household has their own chat for each recipe. Clear chat starts over.",
      "**Household notes.** The owner can add notes in Settings › Recipes (\"We're dairy-free\") that the chat keeps in mind, and pick which AI answers when more than one is set up.",
    ],
  },
  {
    version: "1.0.3",
    date: "2026-11-23",
    title: "Room for big screens",
    changed: [
      "**Uses the whole screen.** On a big monitor, your recipes and Discover now fill the width instead of sitting in a box in the middle with empty space on both sides.",
      "**Up to 8 tiles across.** The − + buttons now go to 7 and 8 on big screens. A laptop still tops out at 6, so one setting looks right on both.",
    ],
  },
  {
    version: "1.0.2",
    date: "2026-11-22",
    title: "Plan from the recipe",
    added: [
      "**Add to meal plan from a recipe.** A new button on the recipe page opens a small calendar: pick a day (days that already have meals planned show a dot) and a meal, and it goes on the plan. If you've scaled the recipe, the plan keeps those servings.",
    ],
  },
  {
    version: "1.0.1",
    date: "2026-11-22",
    title: "Steps follow scaling",
    fixed: [
      "**Steps match the scaled ingredients.** When you scale a recipe, the amounts written in the steps (\"add 2 cans white beans and 1 tbsp cumin\") now change with it, on the recipe page and in Cook Mode, and show in Metric or US when you pick those. Can and package sizes like \"(15 oz.)\" stay as written, and times and temperatures aren't touched.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-11-22",
    title: "Welcome to RecipeHub",
    changes: [
      "**Culury is now RecipeHub.** Same app, new name. Your recipes, plans, lists and settings are all here, and backups made before the rename still restore.",
      "**Recipes**: import from a link, a photo or handwritten card, a PDF cookbook or Paprika files; tags, categories, collections, favorites, ratings, notes, versions and search.",
      "**Cook Mode**: one step at a time, ingredient checklist, timers, scaling and metric/US units, with the screen kept awake.",
      "**Meal plan, groceries and pantry**: plan the week by drag and drop and shop from shared lists sorted by aisle, live on every device.",
      "**Discover**: recipes from your favorite sites' RSS feeds, previewed before you save them.",
      "**Sharing**: public links, PDF, Paprika, Meal-Master and CookML downloads, and email.",
      "**Optional AI** (OpenAI, Claude, Gemini, OpenRouter or a home server like Ollama): reading recipes, nutrition, aisle sorting, meal ideas and recipe check-ups.",
      "**Self-hosted**: one Docker image plus PostgreSQL, daily backups, passkeys and OAuth sign-in, a household inbox and API keys for other apps.",
    ],
  },
];

// "0.10.0" > "0.9.2"
export function isNewer(a: string, b: string | null | undefined) {
  if (!b) return true;
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}
