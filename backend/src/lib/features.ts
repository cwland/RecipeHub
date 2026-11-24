import { count, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { apiKeys, appSettings } from "../db/schema.js";

// Master on/off switches (Settings > AI and API keys). Off hides that section's settings and
// stops the feature, but keeps everything saved (keys, services) for when it's back on.
//  - ai:      AI is never used
//  - apiKeys: every request with an API key is refused
//  - aiEnhance: no "Check this recipe with AI?" and no AI check (only matters while AI is on)
//  - autoNutrition: nutrition isn't worked out by itself after imports and ingredient changes
//  - recipeVersions: no versions are made and edits save without asking (on from the start)
//  - publicLinks: every recipe's /share/ link answers "not found" (on from the start)
//  - savedCopies: a blocked link import doesn't look for a saved copy in web archives (on from the start)
//  - recipeChat: the chat assistant on recipes (only matters while AI is on)
//  - discoveryRefresh: Discover's feeds aren't checked by themselves (Refresh still works; on from the start)
export const FEATURES = ["ai", "apiKeys", "aiEnhance", "autoNutrition", "recipeVersions", "savedCopies", "publicLinks", "discoveryRefresh", "recipeChat"] as const;
export type Feature = (typeof FEATURES)[number];
export type Features = Record<Feature, boolean>;

// Never switched yet: on if that feature has been set up already, so nothing stops by surprise
async function defaults(db: Db): Promise<Features> {
  const rows = await db.select({ key: appSettings.key }).from(appSettings);
  const has = new Set(rows.map((r) => r.key));
  const [{ n }] = await db.select({ n: count() }).from(apiKeys);
  return { ai: has.has("ai"), apiKeys: n > 0, aiEnhance: has.has("ai"), autoNutrition: has.has("ai"), recipeVersions: true, savedCopies: true, publicLinks: true, discoveryRefresh: true, recipeChat: has.has("ai") };
}

async function saved(db: Db): Promise<Partial<Features>> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "features"));
  return (row?.value ?? {}) as Partial<Features>;
}

export async function getFeatures(db: Db): Promise<Features> {
  const s = await saved(db);
  if (FEATURES.every((f) => typeof s[f] === "boolean")) return s as Features;
  return { ...(await defaults(db)), ...s };
}

// Only switches the user has flipped are stored; the others keep following their defaults
export async function setFeatures(db: Db, changes: Partial<Features>) {
  const value = { ...(await saved(db)), ...changes };
  await db
    .insert(appSettings)
    .values({ key: "features", value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  return getFeatures(db);
}

export const isOn = async (db: Db, f: Feature) => (await getFeatures(db))[f];
