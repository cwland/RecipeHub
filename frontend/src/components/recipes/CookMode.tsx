import { useCallback, useEffect, useMemo, useRef, useState, useContext } from "react";
import { SessionContext } from "../../session";
import { api } from "../../api";
import { aiWeights, ingredientLine, recipeUnits, stepUses } from "../../cooking";
import { ingredientOrder, type Recipe } from "../../recipes";
import { useLockBodyScroll } from "../../scrollLock";
import { ChevronLeft, ChevronRight, CloseIcon, RecipesIcon } from "../Icons";
import { ScaleControls, useCookPrefs } from "./ScaleControls";
import { StepText } from "./StepText";
import { useAiStatus } from "../../ai";
import RecipeChat from "../../chat/RecipeChat";

// Cook Mode: one step at a time, big, with the screen kept awake. Ingredients are a checklist
// (beside the step on wide screens, a drawer on phones) and the ones this step uses are lit up.
// Where you are and what you've ticked are remembered for a few hours (a reload doesn't lose them).

interface Progress {
  step: number;
  checked: number[];
  at: number;
}
const PROGRESS_KEY = "recipehub-cook-progress";
const readProgress = (id: number): Progress | null => {
  try {
    const p = (JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "{}") as Record<string, Progress>)[id];
    return p && Date.now() - p.at < 12 * 3600 * 1000 ? p : null;
  } catch {
    return null;
  }
};
const writeProgress = (id: number, p: Omit<Progress, "at">) => {
  try {
    const all = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "{}") as Record<string, Progress>;
    all[id] = { ...p, at: Date.now() };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    /* private window */
  }
};

// Keep the screen on while cooking (browsers allow it on https:// and localhost), unless you've
// switched that off (Settings › Recipes, or the setup wizard)
function useWakeLock(wanted: boolean) {
  const [state, setState] = useState<"on" | "off" | "unsupported" | "declined">("off");
  useEffect(() => {
    if (!wanted) {
      setState("declined");
      return;
    }
    if (!("wakeLock" in navigator) || !window.isSecureContext) {
      setState("unsupported");
      return;
    }
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    const take = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
        if (!alive) return void lock.release();
        setState("on");
        lock.addEventListener("release", () => alive && setState("off"));
      } catch {
        setState("off");
      }
    };
    void take();
    // The lock is dropped when the tab is hidden; take it again when you come back
    const onVisible = () => document.visibilityState === "visible" && void take();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [wanted]);
  return state;
}

export default function CookMode({ id }: { id: number }) {
  const ai = useAiStatus();
  const [r, setR] = useState<Recipe | null>(null);
  const [error, setError] = useState("");
  const saved = useMemo(() => readProgress(id), [id]);
  const [step, setStep] = useState(saved?.step ?? 0);
  const [checked, setChecked] = useState<Set<number>>(new Set(saved?.checked ?? []));
  const [drawer, setDrawer] = useState(false);
  const prefs = useCookPrefs(id);
  const session = useContext(SessionContext);
  const wake = useWakeLock(session?.user.keepAwake ?? true);
  const order = session?.user.ingredientOrder ?? "entered";
  useLockBodyScroll();

  useEffect(() => {
    api<Recipe>("GET", `/api/recipes/${id}`)
      .then(setR)
      .catch((e) => setError((e as Error).message));
  }, [id]);

  // The steps to walk through (headings become each step's label)
  const steps = useMemo(() => {
    const list: { text: string; section: string | null; n: number }[] = [];
    let section: string | null = null;
    for (const s of r?.steps ?? []) {
      if (s.section) section = s.section;
      else list.push({ text: s.text, section, n: list.length + 1 });
    }
    return list;
  }, [r]);
  const done = step >= steps.length && steps.length > 0;
  const current = steps[Math.min(step, steps.length - 1)];

  // Finished: the next time starts fresh at step 1
  useEffect(() => writeProgress(id, done ? { step: 0, checked: [] } : { step, checked: [...checked] }), [id, step, checked, done]);

  const go = useCallback((to: number) => setStep(Math.max(0, Math.min(to, steps.length))), [steps.length]);
  const exit = useCallback(() => {
    window.location.hash = `#/recipes/${id}`;
  }, [id]);

  // Keys: → / space next, ← back, Esc closes the drawer, then Cook Mode
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && !(e.target as HTMLElement).closest("button"))) {
        e.preventDefault();
        go(step + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(step - 1);
      } else if (e.key === "Escape") {
        if (drawer) setDrawer(false);
        else exit();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [step, go, drawer, exit]);

  // Swipe left / right on the step
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onTouchEnd = (e: React.TouchEvent) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dx = e.changedTouches[0].clientX - t.x;
    const dy = e.changedTouches[0].clientY - t.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(step + (dx < 0 ? 1 : -1));
  };

  const toggle = (i: number) =>
    setChecked((c) => {
      const next = new Set(c);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  if (error || !r)
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-page p-6">
        {error ? <p role="alert" className="text-error">{error}</p> : <span className="size-8 animate-spin rounded-full border-4 border-action border-t-transparent" aria-label="Loading" />}
      </div>
    );

  const weights = aiWeights(r.nutrition);
  const usedNow = new Set(done || !current ? [] : r.ingredients.map((ing, i) => (stepUses(current.text, ing) ? i : -1)).filter((i) => i >= 0));
  const checklist = (
    <div className="flex flex-col">
      <div className="px-1 pb-3">
        <ScaleControls servings={r.servings} factor={prefs.factor} setFactor={prefs.setFactor} units={prefs.units} setUnits={prefs.setUnits} leans={recipeUnits(r.ingredients)} />
      </div>
      <ul aria-label="Ingredients checklist" className="flex flex-col gap-1">
        {ingredientOrder(r.ingredients, order).map((i) => {
          const ing = r.ingredients[i];
          const line = ingredientLine(ing, prefs.factor, prefs.units, weights.get(ing.raw.trim().toLowerCase()));
          if (ing.section)
            return (
              <li key={i} className="mt-3 px-2 text-xs font-semibold uppercase tracking-wide text-muted first:mt-0">
                {ing.section}
              </li>
            );
          const isUsed = usedNow.has(i);
          const isChecked = checked.has(i);
          return (
            <li key={i}>
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 transition ${isUsed ? "bg-brand-subtle ring-2 ring-action/40" : "hover:bg-pressed"} ${isChecked ? "opacity-50" : ""}`}>
                <input type="checkbox" checked={isChecked} onChange={() => toggle(i)} className="mt-1 size-5 shrink-0 accent-action" />
                <span className={isChecked ? "line-through decoration-muted" : ""}>
                  {line.plain ? (
                    line.name
                  ) : (
                    <>
                      <strong className="font-semibold">{line.amount}</strong> {line.name}
                      {line.note && <span className="text-subtle">, {line.note}</span>}
                      {line.dried && <span className="text-subtle"> ({line.dried})</span>}
                      {line.was && <span className="text-subtle" title={line.estimate === "ai" ? "Weight estimated by AI (with the nutrition)" : "Approximate weight"}> ({line.was})</span>}
                    </>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label={`Cooking ${r.title}`} className="fixed inset-0 z-[60] flex flex-col bg-page pt-[env(safe-area-inset-top)]">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-container px-2 sm:px-4">
        <button type="button" onClick={exit} aria-label="Leave Cook Mode" title="Leave Cook Mode" className="rounded-lg p-2 text-subtle hover:bg-pressed hover:text-ink">
          <CloseIcon className="size-6" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{r.title}</h1>
        <span
          className={`hidden rounded-full px-3 py-1 text-xs font-semibold sm:inline ${wake === "on" ? "bg-success-subtle text-success" : "bg-page text-muted"}`}
          title={wake === "unsupported" ? "Browsers only keep the screen on for https:// addresses (and localhost)" : wake === "declined" ? "Switched off in Settings › Recipes" : undefined}
        >
          {wake === "on" ? "Screen stays on" : wake === "unsupported" ? "Screen may sleep (needs https)" : wake === "declined" ? "Screen may sleep (your choice)" : "Screen may sleep"}
        </span>
        <button type="button" onClick={() => setDrawer(true)} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-semibold lg:hidden">
          <RecipesIcon className="size-4" /> Ingredients
          {usedNow.size > 0 && <span className="rounded-full bg-action px-1.5 text-xs text-white">{usedNow.size}</span>}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Ingredients beside the step on wide screens */}
        <aside aria-label="Ingredients" className="hidden w-[24rem] shrink-0 overflow-y-auto border-r border-line bg-container p-4 lg:block">
          <h2 className="mb-3 px-1 text-xl font-bold">Ingredients</h2>
          {checklist}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-8 sm:px-10">
            {done ? (
              <div className="text-center">
                <p className="text-5xl" aria-hidden>
                  🍽️
                </p>
                <h2 className="mt-4 text-3xl font-bold">All done. Enjoy!</h2>
                <p className="mt-2 text-subtle">{r.title}</p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <button type="button" onClick={() => (go(0), setChecked(new Set()))} className="rounded-lg border border-line bg-container px-4 py-2.5 font-semibold">
                    Start over
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      writeProgress(id, { step: 0, checked: [] });
                      exit();
                    }}
                    className="rounded-lg bg-primary px-5 py-2.5 font-semibold text-white"
                  >
                    Back to the recipe
                  </button>
                </div>
              </div>
            ) : current ? (
              <>
                <p className="text-sm font-semibold uppercase tracking-wide text-action" aria-live="polite">
                  Step {current.n} of {steps.length}
                  {current.section && <span className="text-muted"> · {current.section}</span>}
                </p>
                <p className="mt-4 text-2xl leading-snug sm:text-3xl sm:leading-snug">
                  <StepText key={current.n} text={current.text} units={prefs.units} recipe={r} stepNumber={current.n} big scaling={{ ingredients: r.ingredients, factor: prefs.factor }} />
                </p>
                {usedNow.size > 0 && (
                  <div className="mt-8">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">In this step</p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {[...usedNow].map((i) => {
                        const line = ingredientLine(r.ingredients[i], prefs.factor, prefs.units, weights.get(r.ingredients[i].raw.trim().toLowerCase()));
                        return (
                          <li key={i}>
                            <button type="button" onClick={() => toggle(i)} aria-pressed={checked.has(i)} className={`rounded-full border px-3 py-1.5 text-left ${checked.has(i) ? "border-line text-muted line-through" : "border-action/40 bg-container"}`}>
                              {line.amount && <strong className="font-semibold">{line.amount} </strong>}
                              {line.name}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="text-center text-subtle">This recipe has no steps yet.</p>
            )}
          </div>
        </main>
      </div>

      {/* Progress and the big buttons */}
      <footer className="shrink-0 border-t border-line bg-container px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button type="button" onClick={() => go(step - 1)} disabled={step === 0} className="flex h-14 items-center gap-1 rounded-xl border border-line px-4 font-semibold disabled:opacity-30 sm:px-6">
            <ChevronLeft className="size-5" /> Back
          </button>
          <div className="flex min-w-0 flex-1 justify-center gap-1.5" aria-hidden>
            {steps.map((s, i) => (
              <button key={i} type="button" tabIndex={-1} onClick={() => go(i)} className={`h-2 min-w-1 max-w-8 flex-1 rounded-full transition ${i < step ? "bg-action/50" : i === step ? "bg-action" : "bg-strong"}`} />
            ))}
          </div>
          <button type="button" onClick={() => go(step + 1)} disabled={done} className="flex h-14 items-center gap-1 rounded-xl bg-primary px-5 font-semibold text-white disabled:opacity-30 sm:px-8">
            {step === steps.length - 1 ? "Done" : "Next"} <ChevronRight className="size-5" />
          </button>
        </div>
      </footer>

      {ai.recipeChat && <RecipeChat recipe={r} factor={prefs.factor} units={prefs.units} cook />}

      {/* Phones: ingredients slide up */}
      {drawer && (
        <div className="fixed inset-0 z-[65] flex flex-col justify-end bg-ink/40 lg:hidden" onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
          <div role="dialog" aria-label="Ingredients" className="max-h-[85vh] overflow-y-auto rounded-t-2xl bg-container p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-bold">Ingredients</h2>
              <button type="button" onClick={() => setDrawer(false)} aria-label="Close ingredients" title="Close ingredients" className="rounded-lg p-2 hover:bg-pressed">
                <CloseIcon className="size-5" />
              </button>
            </div>
            {checklist}
          </div>
        </div>
      )}
    </div>
  );
}
