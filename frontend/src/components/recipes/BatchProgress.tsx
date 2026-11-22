import { useEffect, useState } from "react";
import { api } from "../../api";
import { recipesChanged } from "../../recipes";

// #/recipes/improving/40: the AI improving every recipe an import brought in, in the background.
// Checks in every couple of seconds; Stop finishes the recipe being worked on, then ends.

interface Batch {
  id: number;
  status: "queued" | "running" | "done" | "failed";
  source: string | null;
  error: string | null;
  result: { total?: number; done?: number; improved?: number; unchanged?: number; failed?: { title: string; reason: string }[]; stopped?: boolean; stop?: boolean } | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function BatchProgress({ job }: { job: number }) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = () =>
      api<Batch>("GET", `/api/imports/${job}`)
        .then((b) => {
          if (!alive) return;
          setBatch(b);
          if (b.status === "queued" || b.status === "running") timer = setTimeout(check, 2000);
        })
        .catch((e) => alive && setError((e as Error).message));
    void check();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [job]);

  const stop = async () => {
    setStopping(true);
    try {
      await api("POST", `/api/imports/${job}/stop`);
    } catch (e) {
      setError((e as Error).message);
      setStopping(false);
    }
  };

  const r = batch?.result ?? {};
  const total = r.total ?? 0;
  const done = r.done ?? 0;
  const improved = r.improved ?? 0;
  const unchanged = r.unchanged ?? 0;
  const failed = r.failed ?? [];
  const working = batch && (batch.status === "queued" || batch.status === "running");
  const finished = batch?.status === "done";
  useEffect(() => void (finished && recipesChanged()), [finished]); // the recipe list shows the improved ones

  return (
    <div className="mx-auto max-w-[760px] px-3 pb-16 pt-4 sm:px-6">
      <h1 className="text-2xl font-semibold">Improving imported recipes</h1>
      {batch?.source && <p className="mt-1 text-subtle">From {batch.source}</p>}
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-error-subtle px-4 py-3 text-error">
          {error}
        </p>
      )}
      {batch?.status === "failed" && (
        <p role="alert" className="mt-4 rounded-lg bg-error-subtle px-4 py-3 text-error">
          {batch.error ?? "It stopped with a problem."}
        </p>
      )}

      {working && (
        <div className="mt-4 rounded-lg bg-container p-4">
          {!batch.result ? (
            <p className="font-semibold">Starting…</p>
          ) : (
            <>
              <p className="font-semibold">{done < total ? `Improving ${done + 1} of ${total}…` : "Finishing…"}</p>
              <div role="progressbar" aria-label="Recipes improved" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="mt-2 h-2 overflow-hidden rounded-full bg-pressed">
                <div className="h-full bg-action transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
              </div>
              <p className="mt-2 text-sm text-subtle">
                {improved} improved · {unchanged} needed no changes · {failed.length} couldn't be improved
              </p>
            </>
          )}
          <p className="mt-2 text-sm text-subtle">Each recipe's original is kept as v1 in its Version history.</p>
          <p className="mt-1 text-sm text-subtle">It keeps going if you leave this page.</p>
          {stopping || r.stop ? (
            <p className="mt-3 text-sm font-semibold">Stopping after this recipe…</p>
          ) : (
            <button type="button" onClick={() => void stop()} className="mt-3 rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-pressed">
              Stop
            </button>
          )}
        </div>
      )}

      {finished && (
        <div role="status" aria-label="Batch finished" className="mt-4 rounded-lg bg-success-subtle px-4 py-3">
          <p className="font-semibold">
            {r.stopped ? `Stopped after ${done} of ${plural(total, "recipe")}: ${improved} improved.` : `Improved ${improved} of ${plural(total, "recipe")}.`}
            {!r.stopped && unchanged > 0 && ` ${unchanged} needed no changes.`}
          </p>
          {failed.length > 0 && (
            <>
              <p className="mt-2 text-sm font-semibold text-error">{plural(failed.length, "recipe")} couldn't be improved:</p>
              <ul aria-label="Couldn't be improved" className="mt-1 list-disc pl-5 text-sm">
                {failed.map((f, i) => (
                  <li key={i}>
                    {f.title}: {f.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-2 text-sm">Each recipe's original is kept as v1 in its Version history.</p>
          <a href="#/recipes" className="mt-2 inline-block font-semibold text-link hover:underline">
            See your recipes
          </a>
        </div>
      )}
    </div>
  );
}
