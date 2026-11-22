import { eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "../db/index.js";
import { jobs, recipes, type JobResult } from "../db/schema.js";
import type { AiService } from "./ai.js";
import { logEvent } from "./appLog.js";
import { applyEnhancements, type applyInput, type Enhancement, suggestEnhancements } from "./enhance.js";
import type { EventBus } from "./events.js";
import type { JobQueue } from "./jobs.js";
import { afterAiCheck } from "./nutrition.js";
import { changedParts, describeParts, ensureVersions, newVersion, syncActive, versionData } from "./versions.js";

type ApplyBody = z.infer<typeof applyInput>;
interface Deps {
  db: Db;
  jobs: JobQueue;
}

// Save the parts of an AI suggestion that were kept (Improve with AI's Save, and batch improve).
// New steps or ingredients make a new version (the recipe as it was stays); only nutrition,
// categories or tags change the active one. Then nutrition is looked after (Auto nutrition).
export async function saveImprovements(d: Deps, recipeId: number, body: ApplyBody, userId: number | null) {
  const [before] = await d.db.select().from(recipes).where(eq(recipes.id, recipeId));
  if (before) await ensureVersions(d.db, recipeId);
  await applyEnhancements(d.db, recipeId, body, userId);
  const [after] = await d.db.select().from(recipes).where(eq(recipes.id, recipeId));
  if (!before || !after) return;
  const parts = changedParts(versionData(before), versionData(after));
  if (parts.includes("steps") || parts.includes("ingredients")) await newVersion(d.db, recipeId, "ai", `AI check: changed ${describeParts(parts)}`, userId);
  else await syncActive(d.db, recipeId);
  await afterAiCheck(d, recipeId, before.ingredients, body.nutrition !== undefined);
}

// Every part the AI changed (what batch improve keeps)
export function everyChange(e: Enhancement): ApplyBody {
  return {
    ...(e.steps.changed && { steps: e.steps.suggested }),
    ...(e.ingredients.changed && { ingredients: e.ingredients.suggested }),
    ...(e.nutrition.changed && { nutrition: e.nutrition.suggested as ApplyBody["nutrition"] }),
    ...(e.organize.changed && { categories: e.organize.categories, tags: e.organize.tags }),
  };
}

// ---------- batch: improve every recipe an import brought in ----------

export type BatchResult = Required<Pick<JobResult, "total" | "done" | "improved" | "unchanged" | "failed">> & { stopped?: boolean };

export function registerBatchImprove(queue: JobQueue, d: Deps & { ai: AiService; events: EventBus }) {
  queue.handle("import-improve", async (job) => {
    const { recipeIds, name } = job.payload as { recipeIds: number[]; name: string };
    const result: BatchResult = { total: recipeIds.length, done: 0, improved: 0, unchanged: 0, failed: [] };
    // Progress for the page watching it (merged, so a Stop sent meanwhile isn't lost)
    const save = () => d.db.update(jobs).set({ result: sql`coalesce(${jobs.result}, '{}'::jsonb) || ${JSON.stringify(result)}::jsonb` }).where(eq(jobs.id, job.id));
    await save();
    for (const id of recipeIds) {
      const [row] = await d.db.select({ result: jobs.result }).from(jobs).where(eq(jobs.id, job.id));
      if ((row?.result as { stop?: boolean } | null)?.stop) {
        result.stopped = true;
        break;
      }
      const [r] = await d.db.select({ title: recipes.title }).from(recipes).where(eq(recipes.id, id));
      if (r) {
        try {
          const body = everyChange(await suggestEnhancements(d.db, d.ai, id));
          if (Object.keys(body).length) {
            await saveImprovements(d, id, body, job.createdBy);
            result.improved++;
            d.events.emit({ topic: "recipes", id, by: null });
          } else result.unchanged++;
        } catch (e) {
          result.failed.push({ title: r.title, reason: (e as Error).message.split("\n")[0].slice(0, 300) });
        }
      }
      result.done++;
      await save();
    }
    await logEvent(d.db, {
      category: "import",
      level: result.failed.length ? "warning" : "info",
      source: name.slice(0, 200),
      event: `Improved ${result.improved} of ${result.total} recipe${result.total === 1 ? "" : "s"} from ${name}`.slice(0, 300),
      detail: [result.unchanged && `${result.unchanged} needed no changes`, result.failed.length && `${result.failed.length} couldn't be improved`, result.stopped && "stopped early"].filter(Boolean).join(", ") || undefined,
    });
    return result;
  });
}
