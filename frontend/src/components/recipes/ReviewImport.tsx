import { useEffect, useState } from "react";
import { api } from "../../api";
import { recipesChanged } from "../../recipes";
import { useAiStatus } from "../../ai";
import type { Recipe } from "../../recipes";
import EnhanceWizard from "./EnhanceWizard";

// #/recipes/review/31: the recipes import 31 brought in, one by one through Improve with AI.
// Skip moves on, Save improves it (its original stays in Version history), Stop reviewing ends
// early. Where you are is remembered in this browser, so coming back carries on from there.

interface ImportJob {
  id: number;
  source: string | null;
  result: { recipeIds?: number[]; format?: string } | null;
}
interface Progress {
  at: number; // index into the recipes
  improved: number;
  skipped: number;
}

const KEY = (job: number) => `recipehub-review-${job}`;
const load = (job: number): Progress => {
  try {
    return { at: 0, improved: 0, skipped: 0, ...JSON.parse(localStorage.getItem(KEY(job)) ?? "{}") };
  } catch {
    return { at: 0, improved: 0, skipped: 0 };
  }
};
const keep = (job: number, p: Progress) => {
  try {
    localStorage.setItem(KEY(job), JSON.stringify(p));
  } catch {
    /* private window: just this visit */
  }
};

export default function ReviewImport({ job }: { job: number }) {
  const ai = useAiStatus();
  const [ids, setIds] = useState<number[] | null>(null);
  const [source, setSource] = useState("");
  const [progress, setProgress] = useState<Progress>(() => load(job));
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<ImportJob>("GET", `/api/imports/${job}`)
      .then((j) => {
        setIds(j.result?.recipeIds ?? []);
        setSource(j.source ?? "");
      })
      .catch((e) => setError((e as Error).message));
  }, [job]);

  const done = !!ids && (stopped || progress.at >= ids.length);
  useEffect(() => void (done && recipesChanged()), [done]); // the recipe list shows the reviewed ones

  // The recipe at this place (one deleted since the import is passed over)
  useEffect(() => {
    if (!ids || done) return;
    setRecipe(null);
    api<Recipe>("GET", `/api/recipes/${ids[progress.at]}`)
      .then(setRecipe)
      .catch(() => move("gone"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, progress.at, done]);

  const move = (how: "improved" | "skipped" | "gone") =>
    setProgress((p) => {
      const next = { at: p.at + 1, improved: p.improved + (how === "improved" ? 1 : 0), skipped: p.skipped + (how === "skipped" ? 1 : 0) };
      keep(job, next);
      return next;
    });

  const total = ids?.length ?? 0;
  return (
    <div className="mx-auto max-w-[760px] px-3 pb-16 pt-4 sm:px-6">
      <h1 className="text-2xl font-semibold">Reviewing imported recipes</h1>
      {source && <p className="mt-1 text-subtle">From {source}</p>}
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-error-subtle px-4 py-3 text-error">
          {error}
        </p>
      )}
      {ids && !ai.enhance && !done && (
        <p role="alert" className="mt-4 rounded-lg bg-error-subtle px-4 py-3 text-error">
          Improve with AI is turned off. Turn it on in Settings › AI to review these recipes.
        </p>
      )}
      {done && (
        <div role="status" aria-label="Review finished" className="mt-4 rounded-lg bg-success-subtle px-4 py-3">
          <p className="font-semibold">
            {stopped && progress.at < total ? `Stopped after ${progress.at} of ${total} recipes` : `Reviewed ${total} recipe${total === 1 ? "" : "s"}`}: {progress.improved} improved, {progress.skipped} skipped.
          </p>
          <p className="mt-1 text-sm">Each recipe's original is kept as v1 in its Version history.</p>
          <a href="#/recipes" className="mt-2 inline-block font-semibold text-link hover:underline">
            See your recipes
          </a>
        </div>
      )}
      {!done && ai.enhance && recipe && (
        <EnhanceWizard
          key={recipe.id}
          recipe={recipe}
          position={{ n: progress.at + 1, of: total }}
          onApplied={() => move("improved")}
          onClose={() => move("skipped")}
          onFinished={() => move("skipped")}
          onStop={() => setStopped(true)}
        />
      )}
    </div>
  );
}
