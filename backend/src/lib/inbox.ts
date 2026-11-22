import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { apiKeys, inboxItems, users } from "../db/schema.js";
import type { EventBus } from "./events.js";

// Who sent something: the API key's name, or the person's name
export async function whoSent(db: Db, auth: { method: "apiKey"; keyId: number } | { method: "token"; userId: number }) {
  if (auth.method === "apiKey") {
    const [k] = await db.select({ name: apiKeys.name }).from(apiKeys).where(eq(apiKeys.id, auth.keyId));
    return k?.name ?? null;
  }
  const [u] = await db.select({ name: users.displayName, username: users.username }).from(users).where(eq(users.id, auth.userId));
  return u ? u.name || u.username : null;
}

// A recipe imported straight in (the Companion's Import): a note of it in the inbox's Imported list.
// The same link waiting in the inbox is the one marked imported, rather than a second entry.
export async function recordImported(db: Db, events: EventBus | undefined, i: { url: string; title: string; recipeId: number; sentBy: string | null; sourceApp: string | null }) {
  const now = new Date();
  const [waiting] = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(and(eq(inboxItems.url, i.url), eq(inboxItems.status, "PENDING")))
    .limit(1);
  if (waiting) await db.update(inboxItems).set({ status: "PROCESSED", recipeId: i.recipeId, reviewedAt: now }).where(eq(inboxItems.id, waiting.id));
  else {
    const instagram = /^https?:\/\/([^/]+\.)?instagram\.com\//i.test(i.url);
    await db.insert(inboxItems).values({ type: instagram ? "INSTAGRAM_LINK" : "RECIPE_LINK", title: i.title, url: i.url, sourceApp: i.sourceApp, sentBy: i.sentBy, status: "PROCESSED", recipeId: i.recipeId, reviewedAt: now });
  }
  events?.emit({ topic: "inbox", by: null });
}
