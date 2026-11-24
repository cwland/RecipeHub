import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { appSettings } from "../db/schema.js";

// Settings › Recipes › Recipe chat (the owner's): notes about the household that go into every
// chat ("We're dairy-free"), and which AI service answers first (null: the usual order)
export interface RecipeChatSettings {
  notes: string;
  serviceId: string | null;
}

const NOTES = "recipeChatNotes";
const SERVICE = "recipeChatService";

async function read(db: Db, key: string): Promise<unknown> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return row?.value;
}

async function write(db: Db, key: string, value: unknown) {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function getRecipeChatSettings(db: Db): Promise<RecipeChatSettings> {
  const notes = await read(db, NOTES);
  const serviceId = await read(db, SERVICE);
  return { notes: typeof notes === "string" ? notes : "", serviceId: typeof serviceId === "string" ? serviceId : null };
}

export async function saveRecipeChatSettings(db: Db, v: Partial<RecipeChatSettings>): Promise<RecipeChatSettings> {
  if (v.notes !== undefined) await write(db, NOTES, v.notes);
  if (v.serviceId === null) await db.delete(appSettings).where(eq(appSettings.key, SERVICE));
  else if (v.serviceId !== undefined) await write(db, SERVICE, v.serviceId);
  return getRecipeChatSettings(db);
}
