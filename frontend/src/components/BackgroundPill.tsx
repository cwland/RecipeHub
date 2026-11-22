import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Check, CloseIcon } from "./Icons";
import type { ImportJob } from "./recipes/ImportDialog";

// The floating pill at the top of every screen: a file import or an AI batch running in the
// background ("Improving 18 of 42…", tap for the progress), and a batch that just finished.
// Checked every few seconds; starting one shows it straight away (startedInBackground).

type Bg = Omit<ImportJob, "kind" | "result"> & { kind: ImportJob["kind"] | "import-improve"; result: (NonNullable<ImportJob["result"]> & { total?: number; done?: number; improved?: number; stopped?: boolean }) | null };
const EVENT = "recipehub:background";
export const startedInBackground = (job: Bg) => window.dispatchEvent(new CustomEvent(EVENT, { detail: job }));

function text(j: Bg, fresh: boolean) {
  const r = j.result ?? {};
  if (j.kind === "import-file") return `Importing ${j.source}…`;
  if (fresh) return "Import started · improving in the background";
  if (j.status === "done" || j.status === "failed") {
    if (j.status === "failed") return "The AI improvements stopped with a problem";
    return r.stopped ? `Stopped after ${r.done ?? 0} of ${r.total ?? 0} recipes` : `Improved ${r.improved ?? 0} of ${r.total ?? 0} recipes`;
  }
  if (!r.total) return "Starting the AI improvements…";
  return `Improving ${Math.min((r.done ?? 0) + 1, r.total)} of ${r.total}…`;
}

export function BackgroundPill() {
  const [jobs, setJobs] = useState<Bg[]>([]);
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [fresh, setFresh] = useState<number | null>(null); // just started: "Import started" for a moment
  // A job just started is held until a check includes it (the server may not have picked it up yet)
  const [pending, setPending] = useState<Bg | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    // every 3 seconds while something's going on, every 15 when it's quiet
    let busy = false;
    const poll = () => {
      clearTimeout(t);
      return api<Bg[]>("GET", "/api/imports/active")
        .then((list) => {
          if (!alive) return;
          setJobs(list);
          busy = list.some((j) => j.status === "queued" || j.status === "running");
        })
        .catch(() => {})
        .finally(() => alive && (t = setTimeout(poll, busy ? 3000 : 15000)));
    };
    void poll();
    const started = (e: Event) => {
      const j = (e as CustomEvent<Bg>).detail;
      setPending(j);
      setFresh(j.id);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setFresh(null), 3000);
      setTimeout(() => setPending((p) => (p?.id === j.id ? null : p)), 10000);
      busy = true;
      void poll();
    };
    window.addEventListener(EVENT, started);
    return () => {
      alive = false;
      clearTimeout(t);
      clearTimeout(timer.current);
      window.removeEventListener(EVENT, started);
    };
  }, []);

  const all = pending && !jobs.some((x) => x.id === pending.id) ? [pending, ...jobs] : jobs;
  const shown = all.filter((j) => !dismissed.includes(j.id));
  if (!shown.length) return null;
  const j = shown[0];
  const working = j.status === "queued" || j.status === "running";
  const label = `${text(j, fresh === j.id)}${shown.length > 1 ? ` +${shown.length - 1} more` : ""}`;
  const inner = (
    <>
      {working ? <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden /> : <Check className="size-4 shrink-0" />}
      <span className="truncate">{label}</span>
    </>
  );
  return (
    <div role="status" aria-label="In the background" className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-full items-center gap-1 rounded-full bg-ink py-1.5 pl-4 pr-1.5 text-sm font-semibold text-white shadow-lg">
        {j.kind === "import-improve" ? (
          <a href={`#/recipes/improving/${j.id}`} className="flex min-w-0 items-center gap-2 py-0.5 pr-2 hover:underline">
            {inner}
          </a>
        ) : (
          <span className="flex min-w-0 items-center gap-2 py-0.5 pr-2">{inner}</span>
        )}
        {!working && (
          <button type="button" aria-label="Dismiss" title="Dismiss" onClick={() => setDismissed((d) => [...d, j.id])} className="flex size-7 items-center justify-center rounded-full hover:bg-white/15">
            <CloseIcon className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
