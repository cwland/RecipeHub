import { sql } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { aisleChoices, categories, collectionRecipes, collections, groceryItems, groceryLists, mealPlan, pantryItems, recipeCategories, recipeVersions, recipeTags, recipeUser, recipes, substitutions, tags, users, inboxItems, discoveryFeeds } from "../db/schema.js";
import { versionsAfterRestore } from "./versions.js";
import { refreshSearch } from "./recipes.js";
import { exportSettings, importSettings, type BackupSecrets, type SettingsSection } from "./settingsBackup.js";

export const EXPORT_VERSION = 1;

// The data tables that go into exports and backups, in an order that restores cleanly (a table
// comes after the tables it points at). Each feature adds its tables here as it's built.
// Not included: the login, API keys, signed-in devices, sign-in history and logs.
//  - user: a column pointing at a person. Restoring on a server where that person doesn't exist
//    clears it ("null") or skips the row ("drop").
//  - omit: columns left out of the file (rebuilt after a restore)
export interface DataTable {
  key: string;
  table: PgTable;
  user?: { column: string; missing: "null" | "drop" };
  omit?: string[];
}
export const DATA_TABLES: DataTable[] = [
  { key: "tags", table: tags },
  { key: "categories", table: categories },
  { key: "collections", table: collections },
  { key: "recipes", table: recipes, user: { column: "createdBy", missing: "null" }, omit: ["searchVector"] },
  { key: "recipeTags", table: recipeTags },
  { key: "recipeCategories", table: recipeCategories },
  { key: "collectionRecipes", table: collectionRecipes },
  { key: "recipeUser", table: recipeUser, user: { column: "userId", missing: "drop" } },
  { key: "substitutions", table: substitutions, user: { column: "userId", missing: "null" } },
  { key: "mealPlan", table: mealPlan, user: { column: "createdBy", missing: "null" } },
  { key: "groceryLists", table: groceryLists },
  { key: "groceryItems", table: groceryItems, user: { column: "addedBy", missing: "null" } },
  { key: "pantryItems", table: pantryItems },
  { key: "aisleChoices", table: aisleChoices },
  { key: "recipeVersions", table: recipeVersions, user: { column: "createdBy", missing: "null" } },
  { key: "inboxItems", table: inboxItems },
  // Discovery: the feeds (their posts are fetched again after a restore)
  { key: "discoveryFeeds", table: discoveryFeeds, user: { column: "createdBy", missing: "null" } },
];

const sqlName = (t: PgTable) => getTableConfig(t).name;
const hasId = (t: PgTable) => getTableConfig(t).columns.some((c) => c.name === "id");

// Everything in DATA_TABLES, plus settings (their saved keys and passwords only when BACKUP_KEY is
// set, encrypted with it; see settingsBackup.ts)
export async function buildExport(db: Db, secrets: BackupSecrets) {
  const data: Record<string, unknown[]> = {};
  for (const t of DATA_TABLES) {
    const rows = (await db.select().from(t.table)) as Record<string, unknown>[];
    data[t.key] = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !t.omit?.includes(k))));
  }
  return {
    app: "RecipeHub",
    exportVersion: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data,
    settings: await exportSettings(db, secrets),
  };
}

// ---------- CSV ----------

export function toCsv(rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    // Stop spreadsheet apps from treating text like "=SUM(...)" as a formula
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

// ---------- Restore ----------

export const importSchema = z.object({
  app: z.enum(["RecipeHub", "Culury"]), // Culury: the app's name before 1.0
  exportVersion: z.literal(1),
  data: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  settings: z.object({ secrets: z.enum(["encrypted", "left out"]), values: z.record(z.string(), z.unknown()) }).optional(),
});
export type ImportData = z.infer<typeof importSchema>;

// JSON turns dates into strings; turn timestamp fields back into Dates
const TIMESTAMP = /(At|_at)$/;
function revive(row: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(out)) if (TIMESTAMP.test(k) && typeof v === "string") out[k] = new Date(v);
  return out;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
async function insertChunks(tx: Tx, table: PgTable, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 500) await tx.insert(table).values(rows.slice(i, i + 500).map(revive) as never);
}

// Replaces ALL data in DATA_TABLES with the backup's contents (the login and API keys are kept).
// Runs in one database transaction, so a bad file changes nothing.
export async function importData(db: Db, data: ImportData, secrets: BackupSecrets) {
  let settings: Awaited<ReturnType<typeof importSettings>> | null = null;
  const counts: Record<string, number> = {};
  await db.transaction(async (tx) => {
    if (DATA_TABLES.length) await tx.execute(sql.raw(`truncate ${DATA_TABLES.map((t) => `"${sqlName(t.table)}"`).join(", ")} restart identity cascade`));
    const people = new Set((await tx.select({ id: users.id }).from(users)).map((u) => u.id));
    for (const t of DATA_TABLES) {
      let rows = (data.data[t.key] ?? []).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !t.omit?.includes(k))));
      if (t.user) {
        const { column, missing } = t.user;
        const known = (r: Record<string, unknown>) => r[column] === null || r[column] === undefined || people.has(Number(r[column]));
        rows = missing === "drop" ? rows.filter(known) : rows.map((r) => (known(r) ? r : { ...r, [column]: null }));
      }
      counts[t.key] = rows.length;
      if (rows.length) await insertChunks(tx, t.table, rows);
      // New rows should get ids after the restored ones
      const name = sqlName(t.table);
      if (hasId(t.table)) await tx.execute(sql.raw(`select setval(pg_get_serial_sequence('"${name}"', 'id'), coalesce((select max(id) from "${name}"), 0) + 1, false)`));
    }
    await refreshSearch(tx);
    // A backup from before versions: each recipe gets its versions (old undo points included)
    await versionsAfterRestore(tx, (data.data.recipeSnapshots ?? []) as never);
    if (data.settings) settings = await importSettings(tx as unknown as Db, data.settings as SettingsSection, secrets);
  });
  // settings null: a backup without settings (yours were left as they are)
  return { counts, settings };
}
