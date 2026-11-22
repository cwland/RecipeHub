import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../api";
import { recipesChanged } from "../../recipes";
import { uploadFile, uploadFiles, useAiStatus } from "../../ai";
import { Popup } from "../Popup";
import { startedInBackground } from "../BackgroundPill";

export interface ImportJob {
  id: number;
  kind: "import-url" | "import-text" | "import-photo" | "import-file";
  status: "queued" | "running" | "done" | "failed";
  source: string;
  result: {
    recipeId?: number;
    title?: string;
    duplicateOf?: number;
    fromFeed?: boolean; // Discovery: read from the feed's copy of the post
    how?: "schema.org" | "ai" | "text" | "photo" | "file";
    warnings?: string[];
    // a file from another app
    format?: string;
    imported?: number;
    recipeIds?: number[]; // a file: the recipes added
    skipped?: number;
    problems?: { name: string; reason: string }[];
    choices?: { n: number; title: string; already: boolean }[]; // a file read first: its recipes, A–Z
    chosen?: number;
    // a link the site kept from us, and the saved copies (web archives) tried
    blocked?: { reason: BlockReason; by?: string; url: string };
    trying?: string;
    savedCopy?: { from: string; url: string; date?: string };
    savedCopies?: { from: string; outcome: "none" | "captcha" | "failed" | "no-recipe"; link?: string }[];
  } | null;
  error: string | null;
  createdAt: string;
}

type BlockReason = "captcha" | "paywall" | "refused" | "rate-limited" | "unavailable";
const WHY: Record<BlockReason, string> = {
  captcha: "it asked for a security check",
  paywall: "it's behind a paywall or sign-in",
  refused: "it turned RecipeHub away",
  "rate-limited": "it's limiting requests right now",
  unavailable: "it's unavailable right now",
};
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

type Then = "review" | "auto" | "none";

// A file with several recipes, read first: tick the ones to import (A–Z; ones you already have are
// marked and start unticked), and say what happens after
function PickList({ choices, canImprove, onAccept }: { choices: { n: number; title: string; already: boolean }[]; canImprove: boolean; onAccept: (keep: number[], then: Then) => void }) {
  const [keep, setKeep] = useState(() => new Set(choices.filter((c) => !c.already).map((c) => c.n)));
  const [then, setThenChoice] = useState<Then>(canImprove ? "review" : "none");
  const [busy, setBusy] = useState(false);
  const flip = (n: number) => setKeep((k) => (k.has(n) ? new Set([...k].filter((x) => x !== n)) : new Set([...k, n])));
  const all = keep.size === choices.length;
  const radio = (value: Then, label: string, hint: string) => (
    <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-pressed">
      <input type="radio" name="then" checked={then === value} onChange={() => setThenChoice(value)} className="mt-1 size-4 accent-[var(--color-action)]" />
      <span>
        <span className="font-semibold">{label}</span>
        <span className="block text-sm text-subtle">{hint}</span>
      </span>
    </label>
  );
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-lg bg-container p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">
          {choices.length} recipes in the file · {keep.size} to import
        </p>
        <button type="button" onClick={() => setKeep(all ? new Set() : new Set(choices.map((c) => c.n)))} className="text-sm font-semibold text-link hover:underline">
          {all ? "Untick all" : "Tick all"}
        </button>
      </div>
      <div role="group" aria-label="Recipes in the file" className="max-h-[40vh] overflow-y-auto rounded-lg border border-line bg-page">
        {choices.map((c) => (
          <label key={c.n} className="flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 last:border-b-0 hover:bg-pressed">
            <input type="checkbox" checked={keep.has(c.n)} onChange={() => flip(c.n)} className="size-4 shrink-0 accent-[var(--color-action)]" />
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            {c.already && <span className="shrink-0 text-xs text-muted">already in your recipes</span>}
          </label>
        ))}
      </div>
      {canImprove && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold text-subtle">Then</legend>
          {radio("review", "Review each with AI", "One at a time: accept or reject each change")}
          {radio("auto", "Improve all automatically", "In the background; the originals stay in each recipe's Version history")}
          {radio("none", "Just import them", "You can improve any of them later")}
        </fieldset>
      )}
      <button type="button" disabled={!keep.size || busy} onClick={() => (setBusy(true), onAccept([...keep].sort((a, b) => a - b), then))} className="self-start rounded bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-pressed disabled:opacity-60">
        {busy ? "Importing…" : "Accept"}
      </button>
    </div>
  );
}

// "Check this out https://site.com/recipe" (shared from a phone) -> the link
export const firstLink = (s: string) => s.match(/https?:\/\/[^\s"'<>]+/)?.[0] ?? null;

// Add a recipe from a link or pasted text. The import runs on the server; this shows its progress
// and opens the recipe when it's in.
// page: sent from your browser (Send to RecipeHub), imported straight away
// onImported: the recipe is in (the inbox marks its item done)
export default function ImportDialog({ initial, page, onClose, onImported }: { initial?: string; page?: { url: string; html: string }; onClose: () => void; onImported?: (recipeId: number) => void }) {
  const startLink = page ? null : initial ? firstLink(initial) : null;
  const [tab, setTab] = useState<"link" | "text" | "photo" | "file">(initial && !startLink ? "text" : "link");
  const ai = useAiStatus();
  const [files, setFiles] = useState<File[]>([]);
  const [recipeFile, setRecipeFile] = useState<File | null>(null);
  const [url, setUrl] = useState(page?.url ?? startLink ?? "");
  const [text, setText] = useState(initial && !startLink ? initial : "");
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<string | null>(null); // the file being sent, before the import starts
  const misses = useRef(0); // checks on the import in a row that got no answer
  const progress = useRef<HTMLElement>(null);
  const started = useRef(false);
  const importedRef = useRef(onImported);
  importedRef.current = onImported;
  // After picking from a file: review them with AI (when the import is done), or just import them
  const [then, setThen] = useState<Then | null>(null);
  const pick = async (keep: number[], next: Then) => {
    setError("");
    try {
      // Improve all automatically: it all happens in the background (the server starts the AI batch
      // when the import is done), so the window closes and the pill at the top follows it
      if (next === "auto") {
        startedInBackground((await api<ImportJob>("POST", `/api/imports/${job!.id}/choose`, { keep, improve: true })) as never);
        onClose();
        return;
      }
      setThen(next);
      setJob(await api<ImportJob>("POST", `/api/imports/${job!.id}/choose`, { keep }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (!then || job?.status !== "done" || !job.result?.recipeIds?.length) return;
    if (then === "review") {
      onClose();
      window.location.hash = `#/recipes/review/${job.id}`;
    }
  }, [job, then, onClose]);

  // Follow the import until it's done
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    const t = setTimeout(
      () =>
        void api<ImportJob>("GET", `/api/imports/${job.id}`)
          .then((j) => {
            misses.current = 0;
            setJob(j);
          })
          .catch((e) => {
            // A blip is tried again; a few in a row and it says so, instead of going quiet
            if (++misses.current < 3) return setJob({ ...job });
            misses.current = 0;
            setJob(null);
            setError(`Lost touch with RecipeHub while checking on the import (${(e as Error).message}). It may still finish: watch the bar at the top, or look in your recipes in a minute.`);
          }),
      900,
    );
    return () => clearTimeout(t);
  }, [job]);
  // Whatever it says now is in view (the dialog can be scrolled down on a phone)
  useEffect(() => {
    progress.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); // (newer browsers give back a promise: never return it to React)
  }, [uploading, job?.status, error]);
  // Recipes came in: the recipe list behind this window reloads
  useEffect(() => {
    const r = job?.result;
    if (job?.status === "done" && r && (r.recipeId || r.recipeIds?.length || (r.imported ?? 0) > 0)) recipesChanged();
  }, [job]);
  useEffect(() => {
    // One recipe (a link, a photo, or a file of any kind with just one recipe in it): open it, and
    // its AI check runs like after a link. Picked from a file's list: what you chose there happens.
    const one = job?.result?.recipeId ?? (job?.kind === "import-file" && !then && job.result?.recipeIds?.length === 1 ? job.result.recipeIds[0] : null);
    if (job?.status === "done" && one) {
      importedRef.current?.(one);
      onClose();
      const copy = job.result?.savedCopy; // read from a web archive's copy: the recipe page says so
      const from = copy ? `&copy=${encodeURIComponent(copy.from)}${copy.date ? `&copied=${copy.date}` : ""}` : "";
      window.location.hash = `#/recipes/${one}${job.result?.warnings?.length ? "?imported=warn" : "?imported=1"}${from}`;
    }
  }, [job, then, onClose]);

  const start = async (body: object) => {
    setError("");
    setJob(null);
    try {
      setJob(followable(await api<ImportJob>("POST", "/api/recipes/import", body)));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    // A file, or a PDF chosen on the photo tab (PDFs are read like files: one recipe or many)
    const pdf = tab === "photo" ? files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) : undefined;
    if (tab === "file" || pdf) {
      const file = pdf ?? recipeFile!;
      setError("");
      setJob(null);
      setUploading(file.name);
      try {
        setJob(followable(await uploadFile<ImportJob>("/api/recipes/import/file?choose=1", file)));
      } catch (err) {
        setError((err as Error).message);
      }
      setUploading(null);
      return;
    }
    if (tab !== "photo") return void start(tab === "link" ? { url: url.trim() } : { text });
    setError("");
    setJob(null);
    setUploading(files.length === 1 ? files[0].name : `${files.length} photos`);
    try {
      setJob(followable(await uploadFiles<ImportJob>("/api/recipes/import/photos", files)));
    } catch (err) {
      setError((err as Error).message);
    }
    setUploading(null);
  };
  // Shared from another app: start right away
  useEffect(() => {
    if ((startLink || page) && !started.current) {
      started.current = true;
      void start(page ? { url: page.url, html: page.html } : { url: startLink });
    }
  }, [startLink, page]);

  const busy = !!uploading || (!!job && (job.status === "queued" || job.status === "running"));
  const tabClass = (on: boolean) => `-mb-px flex-1 border-b-[3px] px-4 py-2.5 text-sm font-semibold ${on ? "border-primary text-ink" : "border-transparent text-subtle hover:text-ink"}`;

  return (
    <Popup title="Add a recipe" onClose={onClose} wide>
      <div className="p-5 sm:p-6">
        <div role="tablist" className="flex border-b border-line">
          <button type="button" role="tab" aria-selected={tab === "link"} onClick={() => setTab("link")} className={tabClass(tab === "link")}>
            From a link
          </button>
          <button type="button" role="tab" aria-selected={tab === "text"} onClick={() => setTab("text")} className={tabClass(tab === "text")}>
            Paste the recipe
          </button>
          <button type="button" role="tab" aria-selected={tab === "file"} onClick={() => setTab("file")} className={tabClass(tab === "file")}>
            From a file
          </button>
          {ai.photos && (
            <button type="button" role="tab" aria-selected={tab === "photo"} onClick={() => setTab("photo")} className={tabClass(tab === "photo")}>
              From a photo
            </button>
          )}
        </div>

        <form onSubmit={submit} className="mt-5">
          {tab === "file" ? (
            <>
              <p className="text-sm font-semibold text-subtle">A collection exported from another recipe app, or a PDF (one recipe or a whole cookbook)</p>
              <label key="file-drop" className="mt-2 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-strong bg-page px-4 py-8 text-center hover:border-action">
                <span className="font-semibold">{recipeFile ? recipeFile.name : "Choose the export file"}</span>
                <span className="text-sm text-subtle">{recipeFile ? `${Math.max(1, Math.round(recipeFile.size / 1024))} KB` : "Paprika (.paprikarecipes) or PDF"}</span>
                <input key="recipe-file" type="file" accept=".paprikarecipes,.paprikarecipe,.pdf,application/pdf" className="sr-only" aria-label="Recipe file" onClick={(e) => (e.currentTarget.value = "")} onChange={(e) => setRecipeFile(e.target.files?.[0] ?? null)} />
              </label>
              <p className="mt-2 text-sm text-subtle">
                In Paprika: select the recipes (or all), then File › Export, and choose Paprika Recipe Format. Photos, categories, ratings and notes come too. A PDF is read by your AI service, scanned pages included. Recipes you already have are skipped.
              </p>
            </>
          ) : tab === "photo" ? (
            <>
              <p className="text-sm font-semibold text-subtle">A recipe card, a cookbook page or a screenshot (up to 4 photos of one recipe, in order), or a PDF</p>
              <label key="photo-drop" className="mt-2 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-strong bg-page px-4 py-8 text-center hover:border-action">
                <span className="font-semibold">{files.length ? `${files.length} ${files.some((f) => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) ? "file" : "photo"}${files.length === 1 ? "" : "s"} chosen` : "Take a photo or choose some"}</span>
                <span className="text-sm text-subtle">{files.length ? files.map((f) => f.name).join(", ") : "Handwriting is fine. Good light and a straight-on shot read best."}</span>
                <input
                  key="recipe-photos"
                  type="file"
                  onClick={(e) => (e.currentTarget.value = "")}
                  accept="image/*,application/pdf"
                  multiple
                  className="sr-only"
                  aria-label="Recipe photos"
                  onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 4))}
                />
              </label>
              <p className="mt-2 text-sm text-subtle">Read by your AI service. If one of the photos shows the finished dish, it becomes the recipe's picture.</p>
            </>
          ) : tab === "link" ? (
            <>
              <label htmlFor="import-url" className="text-sm font-semibold text-subtle">
                Recipe page, blog post or video
              </label>
              <input
                id="import-url"
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onPaste={(e) => {
                  const link = firstLink(e.clipboardData.getData("text"));
                  if (link) {
                    e.preventDefault();
                    setUrl(link);
                  }
                }}
                inputMode="url"
                placeholder="https://www.seriouseats.com/…"
                className="mt-1 w-full rounded-lg border border-line bg-page px-3 py-3 text-lg outline-none focus:border-action focus:ring-2 focus:ring-action/15"
              />
              <p className="mt-2 text-sm text-subtle">Most recipe sites import as they are. Other pages, and TikTok, Instagram or YouTube videos, are read by your AI service (Settings › AI).</p>
            </>
          ) : (
            <>
              <label htmlFor="import-text" className="text-sm font-semibold text-subtle">
                The whole recipe: name, ingredients and steps
              </label>
              <textarea
                id="import-text"
                autoFocus
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"Grandma's Pancakes\nServes 4\n\nIngredients\n1 1/2 cups flour\n2 eggs\n\nInstructions\nWhisk everything.\nCook on a hot griddle."}
                className="mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 text-sm leading-relaxed outline-none focus:border-action focus:ring-2 focus:ring-action/15"
              />
              <p className="mt-2 text-sm text-subtle">With “Ingredients” and “Instructions” headings it's read straight away; anything else goes to your AI service.</p>
            </>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || (tab === "link" ? !url.trim() : tab === "photo" ? !files.length : tab === "file" ? !recipeFile : text.trim().length < 20)} className="rounded bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-pressed disabled:opacity-60">
              {uploading ? `Uploading ${uploading}…` : busy ? "Importing…" : "Import"}
            </button>
            <a href="#/recipes/new" onClick={onClose} className="px-2 py-2.5 font-semibold text-subtle hover:underline">
              Type it in instead
            </a>
          </div>
        </form>

        <section ref={progress} aria-label="Import progress" aria-live="polite">
        {uploading ? (
          <p role="status" className="mt-4 flex items-center gap-3 rounded-lg bg-pressed px-4 py-3">
            <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-action border-t-transparent" aria-hidden />
            Uploading {uploading}…
          </p>
        ) : job?.status === "done" && job.result?.choices && !job.result.chosen ? <PickList choices={job.result.choices} canImprove={ai.enhance} onAccept={(keep, next) => void pick(keep, next)} /> : <Status job={job} error={error} onTab={setTab} canPhoto={ai.photos} onRetry={() => job && void api<ImportJob>("POST", `/api/imports/${job.id}/retry`, {}).then(setJob)} onForce={() => job && void api<ImportJob>("POST", `/api/imports/${job.id}/retry`, { force: true }).then(setJob)} onClose={onClose} canReview={ai.enhance && then !== "none"} />}
        </section>
      </div>
    </Popup>
  );
}

// The answer to starting an import must be the import to follow; anything else is said, not ignored
function followable(j: ImportJob): ImportJob {
  if (!j || typeof j !== "object" || j.id == null || !j.status) throw new Error("RecipeHub didn't say the import started. Try again; if it keeps happening, Settings › Logs may say why.");
  return j;
}

// After a file brought in several recipes: go through them one by one, or let the AI improve them
// all in the background (it says how many AI requests that takes before it starts)
function ImproveChoice({ job, count, onClose }: { job: ImportJob; count: number; onClose: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      // it runs in the background: the pill at the top says "Import started", then how far along
      startedInBackground((await api<ImportJob>("POST", `/api/imports/${job.id}/improve`)) as never);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const button = "rounded-lg px-4 py-2 text-sm font-semibold";
  return (
    <div className="mt-3 rounded-lg bg-container p-3">
      <p className="font-semibold">Improve them with AI?</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <a href={`#/recipes/review/${job.id}`} onClick={onClose} className={`${button} bg-action text-white hover:opacity-90`}>
          Review one by one
        </a>
        <button type="button" onClick={() => setAsking(true)} className={`${button} border border-line hover:bg-pressed`}>
          Improve all automatically
        </button>
      </div>
      {asking && (
        <div className="mt-3 rounded-lg border border-line p-3 text-sm">
          <p>
            This asks your AI {count} times, once per recipe. On an AI at home that can take a while; on a paid service each request costs a little. It runs in the background, and you can stop it.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => void start()} className={`${button} bg-action text-white hover:opacity-90 disabled:opacity-60`}>
              {busy ? "Starting…" : "Start"}
            </button>
            <button type="button" onClick={() => setAsking(false)} className={`${button} hover:bg-pressed`}>
              Cancel
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-error">
              {error}
            </p>
          )}
        </div>
      )}
      <p className="mt-2 text-sm text-subtle">Each recipe's original is kept as v1 in its Version history.</p>
    </div>
  );
}

// canReview: Improve with AI is on, so a file's recipes can be reviewed one by one
function Status({ job, error, onRetry, onForce, onClose, canReview, onTab, canPhoto }: { job: ImportJob | null; error: string; onRetry: () => void; onForce: () => void; onClose: () => void; canReview?: boolean; onTab?: (t: "text" | "photo") => void; canPhoto?: boolean }) {
  if (error) return <p role="alert" className="mt-4 rounded-lg bg-error-subtle px-4 py-3 text-error">{error}</p>;
  if (!job) return null;
  // Blocked, now looking for a saved copy
  if ((job.status === "queued" || job.status === "running") && job.result?.blocked && job.result.trying)
    return (
      <p role="status" className="mt-4 flex items-center gap-3 rounded-lg bg-pressed px-4 py-3">
        <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-action border-t-transparent" aria-hidden />
        <span>
          Couldn't get the recipe from {hostOf(job.result.blocked.url)}: {WHY[job.result.blocked.reason]}. Trying a saved copy on {job.result.trying === "Wayback Machine" ? "the Wayback Machine" : job.result.trying}…
        </span>
      </p>
    );
  if (job.status === "queued" || job.status === "running")
    return (
      <p role="status" className="mt-4 flex items-center gap-3 rounded-lg bg-pressed px-4 py-3">
        <span className="size-4 animate-spin rounded-full border-2 border-action border-t-transparent" aria-hidden />
        {job.kind === "import-url" ? "Reading the page…" : job.kind === "import-photo" ? "Reading the photo…" : job.kind === "import-file" ? (/\.pdf$/i.test(job.source ?? "") ? `Reading ${job.source} with your AI. This can take a minute or two for a long PDF…` : "Importing your recipes… a big collection can take a few minutes.") : "Reading the recipe…"} This can take a little while when AI is used.
      </p>
    );
  if (job.status === "done" && job.kind === "import-file" && job.result) {
    const { imported = 0, skipped = 0, problems = [], format } = job.result;
    return (
      <div role="status" aria-label="Import finished" className="mt-4 rounded-lg bg-success-subtle px-4 py-3">
        <p className="font-semibold">
          Added {imported} recipe{imported === 1 ? "" : "s"}
          {format ? ` from ${format}` : ""}.
        </p>
        {skipped > 0 && <p className="mt-1">{skipped} {skipped === 1 ? "was" : "were"} already in your recipes, so {skipped === 1 ? "it was" : "they were"} skipped.</p>}
        {problems.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer font-semibold text-error">{problems.length} couldn't be imported</summary>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {problems.map((p, i) => (
                <li key={i}>
                  {p.name}: {p.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        {canReview && (job.result.recipeIds?.length ?? 0) > 1 && <ImproveChoice job={job} count={job.result.recipeIds!.length} onClose={onClose} />}
        <a href="#/recipes" onClick={onClose} className="mt-2 inline-block font-semibold text-link hover:underline">
          See your recipes
        </a>
      </div>
    );
  }
  if (job.status === "done" && job.result?.duplicateOf)
    return (
      <div role="status" className="mt-4 rounded-lg bg-pressed px-4 py-3">
        <p>That page is already in your recipes.</p>
        <div className="mt-2 flex flex-wrap gap-3">
          <a href={`#/recipes/${job.result.duplicateOf}`} onClick={onClose} className="font-semibold text-link hover:underline">
            Open it
          </a>
          <button type="button" onClick={onForce} className="font-semibold text-subtle hover:underline">
            Import another copy
          </button>
        </div>
      </div>
    );
  if (job.status === "failed" && job.result?.blocked) return <Blocked job={job} onRetry={onRetry} onClose={onClose} onTab={onTab} canPhoto={canPhoto} />;
  if (job.status === "failed")
    return (
      <div role="alert" className="mt-4 rounded-lg bg-error-subtle px-4 py-3 text-error">
        <p>{job.error}</p>
        <button type="button" onClick={onRetry} className="mt-2 font-semibold underline">
          Try again
        </button>
      </div>
    );
  return null;
}

// The site kept the recipe from us, and no saved copy could be read: what you can do instead
function Blocked({ job, onRetry, onClose, onTab, canPhoto }: { job: ImportJob; onRetry: () => void; onClose: () => void; onTab?: (t: "text" | "photo") => void; canPhoto?: boolean }) {
  const { blocked, savedCopies = [] } = job.result!;
  const check = savedCopies.find((c) => c.outcome === "captcha" && c.link);
  const passing = blocked!.reason === "rate-limited" || blocked!.reason === "unavailable"; // may clear up by itself
  const button = "rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-pressed";
  const link = "font-semibold text-link hover:underline";
  return (
    <div role="alert" aria-label="Couldn't import" className="mt-4 rounded-lg bg-error-subtle px-4 py-3">
      <p className="font-semibold text-error">We were unable to automatically import the recipe.</p>
      <p className="mt-1 text-sm text-error">{job.error}</p>
      <ul className="mt-3 flex flex-col gap-1.5 text-sm text-ink">
        {check && (
          <li>
            <a href={check.link} target="_blank" rel="noreferrer noopener" className={link}>
              Open the saved copy on {check.from} ↗
            </a>{" "}
            and complete its security check, then copy the recipe and paste it here.
          </li>
        )}
        <li>
          <a href={blocked!.url} target="_blank" rel="noreferrer noopener" className={link}>
            Open the recipe's page ↗
          </a>{" "}
          in your browser. If you can see the recipe there (signed in, or after its check), copy it and paste it here, or take a screenshot.
        </li>
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => onTab?.("text")} className={button}>
          Paste the recipe
        </button>
        {canPhoto && (
          <button type="button" onClick={() => onTab?.("photo")} className={button}>
            From a photo
          </button>
        )}
        <a href={`#/recipes/new?source=${encodeURIComponent(blocked!.url)}`} onClick={onClose} className={button}>
          Blank recipe
        </a>
        {passing && (
          <button type="button" onClick={onRetry} className={button}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
