// RecipeHub database schema (Drizzle ORM)
// After changing this file run: npm run db:generate
import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  jsonb,
  date,
  real,
  primaryKey,
  customType,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// PostgreSQL full-text search document
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  // owner: runs the server (settings, API keys, backups, members); member: everything else
  role: text("role").$type<"owner" | "member">().notNull().default("member"),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  email: text("email"), // used for password resets (and later, notifications)
  // Bumped to sign out every device: login tokens carry the version they were issued with
  tokenVersion: integer("token_version").notNull().default(0),
  seenVersion: text("seen_version"), // the app version whose "What's new" was dismissed
  theme: text("theme"), // Settings > Profile > Appearance (null: the default)
  colorMode: text("color_mode"), // light, dark or system (null: system)
  units: text("units").$type<"original" | "metric" | "us">().notNull().default("original"), // how amounts show to start with (As is, Metric, US)
  keepAwake: boolean("keep_awake").notNull().default(true), // Cook mode keeps the screen on
  ingredientOrder: text("ingredient_order").$type<"entered" | "alpha">().notNull().default("entered"), // recipes show ingredients as entered, or A to Z
  setupDoneAt: timestamp("setup_done_at", { withTimezone: true }), // through the setup wizard (null: not yet)
  dismissedUpdate: text("dismissed_update"), // the newer version whose top bar was dismissed
  // Daily meal plan email at this time ("17:30", server time; null: off), and the last day it went
  remindAt: text("remind_at"),
  discoveryTags: jsonb("discovery_tags").$type<string[]>().notNull().default([]), // Discovery: this person's filter tags
  remindedOn: date("reminded_on", { mode: "string" }),
  // The OAuth / OpenID Connect identity linked to this account (Settings > Security)
  oauthIssuer: text("oauth_issuer"),
  oauthSubject: text("oauth_subject"),
  oauthEmail: text("oauth_email"), // shown in Settings (what the provider called it)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// App-wide settings changed from the Settings page (e.g. "email"). Secrets inside are encrypted.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One-time password reset links. Only a hash of the token is stored.
export const passwordResets = pgTable("password_resets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Keys for other apps (n8n, Home Assistant, ...). Only a hash is stored.
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(), // first characters, shown in the UI to identify the key
  keyHash: text("key_hash").notNull().unique(),
  // What the key may do (see lib/keyAccess.ts)
  access: text("access").notNull().default("read"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

// Signed-in devices: one row per sign-in (each login token carries its row's tokenId).
// A session works while it isn't signed out, its token version is current and it hasn't expired.
export const sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenId: text("token_id").notNull().unique(),
    tokenVersion: integer("token_version").notNull(),
    how: text("how").notNull(), // password, setup, reset link, earlier sign-in
    userAgent: text("user_agent"),
    ip: text("ip"), // where it signed in from
    lastIp: text("last_ip"), // where it was last used from
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }), // signed out
    // A random id the browser keeps (localStorage), so signing in again in the same browser reuses
    // its row: one row per browser in Signed-in devices. Null for sessions from before this.
    deviceId: text("device_id"),
  },
  (t) => [index("sessions_user_idx").on(t.userId), uniqueIndex("sessions_user_device_idx").on(t.userId, t.deviceId)]
);

// Every sign-in attempt, good or bad (Settings > Security)
export const loginEvents = pgTable(
  "login_events",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    username: text("username"), // as typed
    success: boolean("success").notNull(),
    reason: text("reason"), // why it failed, or how it signed in
    ip: text("ip"),
    userAgent: text("user_agent"),
    sessionId: integer("session_id").references(() => sessions.id, { onDelete: "set null" }),
  },
  (t) => [index("login_events_at_idx").on(t.at)]
);

// Passkeys (WebAuthn): sign in with a fingerprint, face or device PIN instead of the password.
// Each one belongs to the web address it was made on (rp_id), e.g. localhost or your domain.
export const passkeys = pgTable("passkeys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull().unique(), // base64url
  publicKey: text("public_key").notNull(), // base64url (COSE)
  counter: integer("counter").notNull().default(0),
  transports: jsonb("transports").$type<string[]>(),
  rpId: text("rp_id").notNull(), // the address it works on (no port), e.g. recipes.example.com
  name: text("name").notNull(), // shown in Settings > Security
  deviceType: text("device_type"), // singleDevice / multiDevice (synced, e.g. iCloud Keychain)
  backedUp: boolean("backed_up").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

// Settings > Logs: emails sent, AI problems, API errors, and scheduled task
// runs (backups, imports...). Only short descriptions, never message bodies or
// secrets. Kept for 30 days.
export const appLog = pgTable(
  "app_log",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    category: text("category").notNull(), // email, ai, api, schedule
    level: text("level").notNull(), // info, warning, error
    source: text("source"), // which one: an email type, AI service, bank, task name, API key...
    event: text("event").notNull(), // one line: what happened
    detail: text("detail"), // the error message, counts, etc.
  },
  (t) => [index("app_log_at_idx").on(t.at)]
);

// ---------- Recipes ----------
// Recipes belong to the household (everyone signed in sees them). Favorites, pins, ratings and
// personal notes are per person (recipe_user). Ingredients and steps are kept in order as JSON.

// One ingredient line. "raw" is what was typed or imported; the rest is parsed from it
// (lib/ingredients.ts) for scaling, unit conversion and grocery lists. A line with only
// "section" set is a heading ("For the sauce").
export interface Ingredient {
  raw: string;
  quantity?: number | null; // 1.5
  quantityMax?: number | null; // "2-3 cloves": 3
  unit?: string | null; // normalized: "cup", "tbsp", "g"...
  name?: string; // "flour"
  note?: string | null; // "sifted"
  section?: string | null; // a heading instead of an ingredient
}

// One step. A step with only "section" set is a heading ("Make the dough").
export interface Step {
  text: string;
  section?: string | null;
}

// Per serving. "site": from the recipe's page; "ai": estimated by AI; "you": typed in.
export interface Nutrition {
  calories: number | null;
  fat: number | null; // grams
  saturatedFat: number | null;
  carbs: number | null;
  fiber: number | null;
  sugar: number | null; // total sugars
  addedSugar?: number | null; // part of sugar (older recipes don't have it)
  protein: number | null;
  sodium: number | null; // milligrams
  source: "site" | "ai" | "you";
  servings?: number | null; // the servings it was worked out for
  servingSize?: string | null; // "About 1½ cups (340 g)"
  note?: string | null;
  outdated?: boolean; // the ingredients changed since (cleared by a new estimate or typing them in)
  perIngredient?: { line: string; grams: number | null; calories: number }[]; // AI estimates: what each line came to (whole amount), largest first
}

export const recipes = pgTable(
  "recipes",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    // The public read-only link (/share/<token>): random, made for every recipe; New link replaces it
    shareToken: text("share_token").notNull().unique().default(sql`'rcp_' || replace(gen_random_uuid()::text, '-', '')`),
    ingredients: jsonb("ingredients").$type<Ingredient[]>().notNull().default([]),
    steps: jsonb("steps").$type<Step[]>().notNull().default([]),
    servings: integer("servings"), // how many it makes, for scaling
    yieldText: text("yield_text"), // as written: "4 servings", "24 cookies"
    prepMinutes: integer("prep_minutes"),
    cookMinutes: integer("cook_minutes"),
    totalMinutes: integer("total_minutes"),
    sourceUrl: text("source_url"),
    sourceName: text("source_name"), // "Serious Eats", "Grandma's card"
    imageUrl: text("image_url"),
    notes: text("notes"), // the recipe's own notes (everyone sees them)
    nutrition: jsonb("nutrition").$type<Nutrition>(),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Full-text search over title, ingredients, tags, description and notes (kept up to date by lib/recipes.ts)
    searchVector: tsvector("search_vector"),
  },
  (t) => [index("recipes_search_idx").using("gin", t.searchVector), index("recipes_updated_idx").on(t.updatedAt)]
);

// Free-form labels: "vegetarian", "weeknight", "grill"
export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // stored lowercase
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recipeTags = pgTable(
  "recipe_tags",
  {
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.tagId] }), index("recipe_tags_tag_idx").on(t.tagId)]
);

// The household's own list of meal types or courses, in their order: Breakfast, Dinner, Dessert...
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recipeCategories = pgTable(
  "recipe_categories",
  {
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.categoryId] }), index("recipe_categories_category_idx").on(t.categoryId)]
);

// The recipe as it was before its latest AI Enhance change, for "Undo AI changes" (one level)

// Recipe versions. Each one is a full copy of the recipe's own content (not its tags, categories,
// collections, photo or anyone's favorites and notes). The recipe row always holds the active
// version's content, so search, the grocery list, the meal plan and Cook Mode just read recipes.
export interface RecipeVersionData {
  title: string;
  description: string | null;
  ingredients: Ingredient[];
  steps: Step[];
  servings: number | null;
  yieldText: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  notes: string | null;
  nutrition: Nutrition | null;
}
export const recipeVersions = pgTable(
  "recipe_versions",
  {
    id: serial("id").primaryKey(),
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    number: integer("number").notNull(), // v1, v2… (not reused after a delete)
    source: text("source").$type<"import" | "created" | "ai" | "edit">().notNull(),
    summary: text("summary").notNull(), // "Imported", "Changed ingredients and steps"…
    data: jsonb("data").$type<RecipeVersionData>().notNull(),
    active: boolean("active").notNull().default(false),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("recipe_versions_number").on(t.recipeId, t.number), uniqueIndex("recipe_versions_one_active").on(t.recipeId).where(sql`${t.active}`)]
);

// Hand-picked lists in your own order: "Quick Meals", "Ninja CREAMi", "Thanksgiving"
export const collections = pgTable("collections", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const collectionRecipes = pgTable(
  "collection_recipes",
  {
    collectionId: integer("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.recipeId] }), index("collection_recipes_recipe_idx").on(t.recipeId)]
);

// Each person's own take on a recipe: favorite, pinned to the top, rating, private notes
export const recipeUser = pgTable(
  "recipe_user",
  {
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    favorite: boolean("favorite").notNull().default(false),
    pinned: boolean("pinned").notNull().default(false),
    rating: integer("rating"), // 1-5, null: not rated
    notes: text("notes"), // only this person sees them
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.userId] }), index("recipe_user_user_idx").on(t.userId)]
);

// What was swapped when cooking it ("Greek yogurt instead of sour cream"), newest first
export const substitutions = pgTable(
  "substitutions",
  {
    id: serial("id").primaryKey(),
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").$type<"swap" | "add">().notNull().default("swap"), // a swap, or an item added
    original: text("original"), // "sour cream" (a swap: what it's instead of; an added item: none)
    line: text("line"), // the ingredient line it swaps, when one was picked ("1 cup sour cream")
    amount: text("amount"), // what was used: "3/4"
    unit: text("unit"), // "cup"
    item: text("item"), // "Greek yogurt"
    replacement: text("replacement").notNull(), // all of it: "3/4 cup Greek yogurt"
    note: text("note"), // "a bit tangier, worked fine"
    appliedVersion: integer("applied_version"), // Make a new version: the version it went into
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("substitutions_recipe_idx").on(t.recipeId)]
);

// ---------- Background jobs ----------
// Work that takes a while (importing a recipe from a link, reading pasted text with AI) runs in
// the background, picked up by the worker in lib/jobs.ts. Finished jobs are kept 30 days.
// A discovered post's recipe, shown before it's saved: read with plain code, or with AI when asked
export interface RecipePreview {
  recipe: import("../lib/importRecipe.js").ImportedRecipe | null;
  how: "schema.org" | "text" | "ai" | null;
  from: "site" | "copy" | "feed" | null; // the recipe's own page, a saved copy of it (the site kept RecipeHub out), or the feed's copy of the post
  savedCopy?: { from: string; url: string; date?: string }; // from "copy": which archive, the copy's address and date
  problem: string | null; // why the site's page couldn't give the recipe
}

export interface JobResult {
  recipeId?: number;
  title?: string;
  duplicateOf?: number; // already in your recipes (import again with force to keep both)
  improving?: number; // asked for AI correction: the import-improve job working on it
  how?: "schema.org" | "ai" | "text" | "photo" | "file" | "pdf"; // how the recipe was read
  format?: string; // import-file: Paprika, Mealie…
  imported?: number; // import-file: recipes added
  recipeIds?: number[]; // import-file: the recipes added, in order
  skipped?: number; // import-file: already in your recipes
  problems?: { name: string; reason: string }[]; // import-file: entries that couldn't be used
  warnings?: string[];
  sorted?: number; // sort-aisles: items given an aisle
  total?: number; // import-improve: recipes to improve
  done?: number; // import-improve: worked through so far
  improved?: number; // import-improve: changed by AI
  unchanged?: number; // import-improve: the AI had nothing to change
  failed?: { title: string; reason: string }[]; // import-improve: couldn't be improved
  stopped?: boolean; // import-improve: stopped before the end
  choices?: { n: number; title: string; already: boolean }[]; // import-file (choose): the recipes in the file, A–Z
  chosen?: number; // import-file (choose): the import that brought in the ones picked
  savedCopy?: { from: string; url: string; date?: string }; // import-url: read from a web archive's copy
  savedCopies?: { from: string; outcome: "none" | "captcha" | "failed" | "no-recipe"; link?: string }[]; // import-url (failed): the archives tried
  sent?: boolean; // import-url: the page came from your browser (Send to RecipeHub)
  fromFeed?: boolean; // import-url from Discovery: the site kept RecipeHub out, so the feed's copy of the post was read
  trying?: string; // import-url (running): the archive being asked now
  blocked?: { reason: "captcha" | "paywall" | "refused" | "rate-limited" | "unavailable"; by?: string; url: string }; // import-url (failed): why the site kept it from us
}

export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(), // import-url, import-text
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"queued" | "running" | "done" | "failed">().notNull().default("queued"),
    result: jsonb("result").$type<JobResult>(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.id)]
);

// ---------- Meal plan ----------
// One row per planned dish: a recipe, or just a note ("Leftovers", "Eat out"). The slot is one of
// the household's meal slots (Settings › Recipes › Meal plan; Breakfast, Lunch, Dinner, Snack).
export const mealPlan = pgTable(
  "meal_plan",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" }).notNull(), // YYYY-MM-DD
    slot: text("slot").notNull(), // a slot id: breakfast, lunch, dinner, snack, or one you added
    position: integer("position").notNull().default(0), // order within the day's slot
    recipeId: integer("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    title: text("title").notNull(), // the recipe's name when planned (kept if it's deleted), or the note
    servings: integer("servings"), // how many to make (null: as the recipe says)
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("meal_plan_date_idx").on(t.date, t.slot, t.position), index("meal_plan_recipe_idx").on(t.recipeId)]
);

// ---------- Grocery lists and pantry ----------
export const groceryLists = pgTable("grocery_lists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }), // null: an active list; set: kept read-only
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Active lists have different names (capitals and outer spaces don't count); archived ones may repeat
  uniqueIndex("grocery_lists_active_name").on(sql`lower(btrim(${t.name}))`).where(sql`${t.archivedAt} is null`),
]);

// Where an item on the list came from ("Chili", "Pizza") so you know what it's for
export interface ItemSource {
  recipeId?: number;
  title: string;
}

export const groceryItems = pgTable(
  "grocery_items",
  {
    id: serial("id").primaryKey(),
    listId: integer("list_id")
      .notNull()
      .references(() => groceryLists.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    quantity: real("quantity"), // null: just "some"
    unit: text("unit"),
    note: text("note"),
    aisle: text("aisle").notNull().default("other"), // lib/grocery.ts AISLES
    aisleBy: text("aisle_by").$type<"words" | "ai" | "you">().notNull().default("words"), // who sorted it
    checked: boolean("checked").notNull().default(false),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    position: integer("position").notNull().default(0),
    sources: jsonb("sources").$type<ItemSource[]>().notNull().default([]),
    addedBy: integer("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("grocery_items_list_idx").on(t.listId, t.checked)]
);

// Where things go in the store, as you (or AI) chose: used for the same item next time
export const aisleChoices = pgTable("aisle_choices", {
  key: text("key").primaryKey(), // itemKey(name): "onion", "olive oil"
  aisle: text("aisle").notNull(),
  by: text("by").$type<"ai" | "you">().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// What's at home. Staples (salt, oil...) are things you always have: never added to a list.
export const pantryItems = pgTable("pantry_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  quantity: real("quantity"),
  unit: text("unit"),
  aisle: text("aisle").notNull().default("other"),
  staple: boolean("staple").notNull().default(false),
  expiresOn: date("expires_on", { mode: "string" }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// The inbox: links, notes and recipe data sent in by other apps (the RecipeHub Companion browser
// extension) to look at later. One inbox for the household.
export const INBOX_TYPES = ["RECIPE_LINK", "INSTAGRAM_LINK", "TEXT_NOTE", "RAW_RECIPE_DATA"] as const;
export const INBOX_STATUSES = ["PENDING", "PROCESSED", "DISMISSED"] as const;
export interface InboxMetadata {
  pageTitle?: string;
  favIconUrl?: string;
  capturedAt?: string;
}
export const inboxItems = pgTable(
  "inbox_items",
  {
    id: serial("id").primaryKey(),
    type: text("type").$type<(typeof INBOX_TYPES)[number]>().notNull(),
    title: text("title").notNull(),
    url: text("url"),
    content: text("content"),
    sourceApp: text("source_app"),
    metadata: jsonb("metadata").$type<InboxMetadata>(),
    status: text("status").$type<(typeof INBOX_STATUSES)[number]>().notNull().default("PENDING"),
    sentBy: text("sent_by"), // the API key's name, or the person's name, when it came in
    recipeId: integer("recipe_id").references(() => recipes.id, { onDelete: "set null" }), // imported: the recipe it became
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [index("inbox_items_status_idx").on(t.status, t.createdAt)]
);

// Discovery: RSS / Atom feeds the household subscribes to, and their posts (read with plain code,
// no AI). Posts are kept until 60 days after they last appeared in their feed.
export const discoveryFeeds = pgTable("discovery_feeds", {
  id: serial("id").primaryKey(),
  url: text("url").notNull().unique(),
  title: text("title").notNull(),
  siteUrl: text("site_url"),
  iconUrl: text("icon_url"),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const discoveryItems = pgTable(
  "discovery_items",
  {
    id: serial("id").primaryKey(),
    feedId: integer("feed_id")
      .notNull()
      .references(() => discoveryFeeds.id, { onDelete: "cascade" }),
    guid: text("guid").notNull(),
    title: text("title").notNull(),
    link: text("link"),
    pubDate: timestamp("pub_date", { withTimezone: true }),
    author: text("author"),
    categories: jsonb("categories").$type<string[]>().notNull().default([]),
    description: text("description"),
    contentHtml: text("content_html"), // made safe when read (lib/rss.ts)
    thumbnailUrl: text("thumbnail_url"),
    recipeId: integer("recipe_id").references(() => recipes.id, { onDelete: "set null" }), // imported: the recipe it became
    preview: jsonb("preview").$type<RecipePreview>(), // the recipe on its page, read when the post was opened (lib/discoveryPreview.ts)
    previewAt: timestamp("preview_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("discovery_items_feed_guid").on(t.feedId, t.guid), index("discovery_items_sort_idx").on(t.pubDate, t.id)]
);
