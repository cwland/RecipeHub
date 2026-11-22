import { useEffect, useState } from "react";
import { api, postWithProgress } from "../../api";
import { WorkingPopup } from "../WorkingPopup";
import { useAiStatus } from "../../ai";
import { pointsEstimate, type Nutrition, type Recipe } from "../../recipes";
import { Popup } from "../Popup";
import { EditIcon, WandIcon } from "../Icons";

const aiButton = "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60";

const iconButton = "flex size-9 items-center justify-center rounded-lg text-subtle hover:bg-pressed hover:text-ink disabled:opacity-60";

// Daily values used on US nutrition labels
const ROWS: { key: keyof Nutrition; label: string; unit: string; dv?: number; indent?: boolean }[] = [
  { key: "fat", label: "Total fat", unit: "g", dv: 78 },
  { key: "saturatedFat", label: "Saturated fat", unit: "g", dv: 20, indent: true },
  { key: "sodium", label: "Sodium", unit: "mg", dv: 2300 },
  { key: "carbs", label: "Total carbohydrate", unit: "g", dv: 275 },
  { key: "fiber", label: "Dietary fiber", unit: "g", dv: 28, indent: true },
  { key: "sugar", label: "Total sugars", unit: "g", indent: true },
  { key: "addedSugar", label: "Added sugars", unit: "g", dv: 50, indent: true },
  { key: "protein", label: "Protein", unit: "g", dv: 50 },
];
const SOURCE = { site: "From the recipe's site", ai: "Estimated by AI", you: "Entered by you" };
const fmt = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

// onRecipe: the recipe after its servings were saved here (a recipe with none is asked for them first)
export function NutritionCard({ recipeId, servings, yieldText, value, updating, onChange, onRecipe }: { recipeId: number; servings: number | null; yieldText?: string | null; value: Nutrition | null; updating?: boolean; onChange: (n: Nutrition | null) => void; onRecipe?: (r: Recipe) => void }) {
  const ai = useAiStatus();
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const calculate = async (servingSize?: string) => {
    setBusy(true);
    setError("");
    try {
      setLine("Starting…");
      onChange(await postWithProgress<Nutrition>(`/api/recipes/${recipeId}/nutrition`, "nutrition", setLine, undefined, servingSize ? { servingSize } : undefined));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  // No servings on the recipe: ask how many it makes first (per serving means nothing without it)
  const estimate = () => (servings ? calculate() : setAsking(true));
  const points = value ? pointsEstimate(value) : null;
  const stale = value?.servings && servings && value.servings !== servings;

  return (
    <section aria-label="Nutrition" className="@container rounded-2xl bg-container p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-bold">Nutrition</h2>
        {value && <span className="mr-auto text-sm text-subtle">per serving</span>}
        {value && (
          <div role="toolbar" aria-label="Nutrition actions" className="ml-auto flex items-center gap-1">
            {ai.ready && (
              <button type="button" onClick={() => void estimate()} disabled={busy} className={aiButton}>
                <WandIcon className="size-4" />
                Re-calculate nutrition
              </button>
            )}
            <button type="button" aria-label="Edit nutrition" title="Edit nutrition" onClick={() => setEditing(true)} className={iconButton}>
              <EditIcon />
            </button>
          </div>
        )}
      </div>
      {busy && <WorkingPopup title="Calculating nutrition" line={line} />}
      {asking && (
        <ServingsPrompt
          recipeId={recipeId}
          yieldText={yieldText ?? null}
          onClose={() => setAsking(false)}
          onSaved={(r, servingSize) => {
            setAsking(false);
            onRecipe?.(r);
            void calculate(servingSize);
          }}
        />
      )}
      {updating && (
        <p role="status" className="mt-2 text-sm font-semibold text-action">
          Updating nutrition…
        </p>
      )}
      {!value ? (
        updating ? null : (
        <>
          <p className="mt-2 text-subtle">No nutrition facts yet.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {ai.ready && (
              <button type="button" onClick={() => void estimate()} disabled={busy} className={aiButton}>
                <WandIcon className="size-4" />
                Calculate nutrition
              </button>
            )}
            <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-pressed">
              Type it in
            </button>
          </div>
        </>
        )
      ) : (
        <>
          {value.outdated && (
            <p role="note" className="mt-3 rounded-lg bg-warning/15 px-3 py-2 text-sm">
              <strong className="font-semibold">This recipe has been updated since nutrition was {value.source === "you" ? "entered" : "calculated"}, so it may be out of date.</strong>{" "}
              {ai.ready ? "Re-calculate nutrition to update it, or edit the numbers (the pencil)." : "Edit the numbers to match (the pencil), or turn on AI in Settings › AI to calculate them."}
            </p>
          )}
          {/* the label, with each ingredient's calories beside it when there's room (stacked on phones) */}
          <div className={!value.outdated && value.perIngredient?.length ? "grid gap-x-8 gap-y-5 @2xl:grid-cols-2" : ""}>
            <div>
              <NutritionFacts value={value} />
              <p className="mt-3 text-xs text-muted">
                {SOURCE[value.source]}
                {value.servings ? `, for ${value.servings} servings` : ""}. {value.note}
                {stale ? ` The recipe now makes ${servings}: estimate again.` : ""}
              </p>
            </div>
            {!value.outdated && <CaloriesByIngredient value={value} className="@2xl:mt-3" />}
          </div>
        </>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-error">{error}</p>}
      {editing && (
        <EditNutrition
          value={value}
          onClose={() => setEditing(false)}
          onSave={async (n) => {
            await api("PUT", `/api/recipes/${recipeId}/nutrition`, n);
            onChange(n && { ...n, source: "you", servings: n.servings ?? servings });
            setEditing(false);
          }}
        />
      )}
    </section>
  );
}

type Portion = { servings: number; servingSize: string; yieldText: string | null };
const field = "mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action";

// How many servings? The AI's suggestions from the ingredients (24 cookies at 40 g…), or your own.
// Saving puts the servings (and Makes) on the recipe; onSaved then calculates with that serving size.
function ServingsPrompt({ recipeId, yieldText, onClose, onSaved }: { recipeId: number; yieldText: string | null; onClose: () => void; onSaved: (r: Recipe, servingSize?: string) => void }) {
  return (
    <Popup title="How many servings?" onClose={onClose}>
      <div className="p-6">
        <ServingsChooser recipeId={recipeId} yieldText={yieldText} onCancel={onClose} onSaved={onSaved} saveLabel="Save and calculate" />
      </div>
    </Popup>
  );
}

// The choices themselves (also the first step of Improve with AI for a recipe with no servings)
export function ServingsChooser({ recipeId, yieldText, onCancel, onSaved, saveLabel }: { recipeId: number; yieldText: string | null; onCancel: () => void; onSaved: (r: Recipe, servingSize?: string) => void; saveLabel: string }) {
  const [ideas, setIdeas] = useState<{ totalGrams: number | null; options: Portion[] } | null>(null);
  const [ideasError, setIdeasError] = useState("");
  const [pick, setPick] = useState<number | "own" | null>(null);
  const [own, setOwn] = useState({ servings: "", servingSize: "", yieldText: yieldText ?? "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api<{ totalGrams: number | null; options: Portion[] }>("POST", `/api/recipes/${recipeId}/portions`)
      .then((d) => live && setIdeas(d))
      .catch(() => {
        if (!live) return;
        setIdeasError("The AI couldn't suggest portions this time. Type in how many it makes.");
        setPick("own");
      });
    return () => {
      live = false;
    };
  }, [recipeId]);
  const ownServings = Number(own.servings.trim());
  const ownOk = Number.isInteger(ownServings) && ownServings >= 1 && ownServings <= 1000;
  const chosen: Portion | null = pick === "own" ? (ownOk ? { servings: ownServings, servingSize: own.servingSize.trim(), yieldText: own.yieldText.trim() || null } : null) : pick !== null && ideas ? ideas.options[pick] : null;
  const save = async () => {
    if (!chosen) return;
    setSaving(true);
    setError("");
    try {
      const r = await api<Recipe>("PATCH", `/api/recipes/${recipeId}`, { servings: chosen.servings, ...(chosen.yieldText ? { yieldText: chosen.yieldText } : {}) });
      onSaved(r, chosen.servingSize || undefined);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };
  const option = "flex cursor-pointer items-start gap-3 rounded-xl border p-3 has-[:checked]:border-action has-[:checked]:bg-brand-subtle";
  return (
      <div className="flex flex-col gap-3">
        <p>This recipe doesn't say how many it makes. Nutrition is per serving, so pick one first.</p>
        {!ideas && !ideasError && (
          <p role="status" className="flex items-center gap-2 text-sm text-subtle">
            <span className="size-3 animate-spin rounded-full border-2 border-action border-t-transparent" aria-hidden /> Working out some sensible portions from the ingredients…
          </p>
        )}
        {ideasError && <p className="rounded-lg bg-page p-3 text-sm">{ideasError}</p>}
        {/* the choices come once the AI's suggestions are in (or it couldn't make any) */}
        {(ideas || ideasError) && (
          <>
        {ideas?.totalGrams && <p className="text-sm text-subtle">The whole recipe comes to about {ideas.totalGrams.toLocaleString()} g.</p>}
        <div role="radiogroup" aria-label="Portions" className="flex flex-col gap-2">
          {ideas?.options.map((o, i) => (
            <label key={i} className={`${option} border-line`}>
              <input type="radio" name="portion" checked={pick === i} onChange={() => setPick(i)} className="mt-1 accent-[var(--color-action)]" aria-label={`${o.yieldText ?? `${o.servings} servings`}, ${o.servingSize}`} />
              <span>
                <span className="block font-semibold">{o.yieldText ?? `${o.servings} servings`}</span>
                <span className="text-sm text-subtle">{o.servingSize} each</span>
              </span>
            </label>
          ))}
          <label className={`${option} border-line`}>
            <input type="radio" name="portion" checked={pick === "own"} onChange={() => setPick("own")} className="mt-1 accent-[var(--color-action)]" aria-label="Something else" />
            <span className="font-semibold">Something else</span>
          </label>
        </div>
        {pick === "own" && (
          <div className="grid grid-cols-2 gap-3 text-sm font-semibold text-subtle">
            <label>
              Servings
              <input aria-label="Servings" inputMode="numeric" value={own.servings} onChange={(e) => setOwn({ ...own, servings: e.target.value })} placeholder="12" className={field} />
            </label>
            <label>
              Serving size
              <input aria-label="Serving size" value={own.servingSize} maxLength={100} onChange={(e) => setOwn({ ...own, servingSize: e.target.value })} placeholder="1 cookie (40 g)" className={field} />
            </label>
            <label className="col-span-2">
              Makes
              <input aria-label="Makes" value={own.yieldText} maxLength={100} onChange={(e) => setOwn({ ...own, yieldText: e.target.value })} placeholder="24 cookies" className={field} />
            </label>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        <div className="mt-2 grid grid-cols-2 gap-3">
          <button type="button" onClick={onCancel} className="rounded-lg border border-line px-4 py-2.5 font-semibold hover:bg-pressed">
            Cancel
          </button>
          <button type="button" disabled={!chosen || saving} onClick={() => void save()} className="rounded-lg bg-primary px-4 py-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : saveLabel}
          </button>
        </div>
          </>
        )}
      </div>
  );
}

function EditNutrition({ value, onClose, onSave }: { value: Nutrition | null; onClose: () => void; onSave: (n: Nutrition | null) => Promise<void> }) {
  const keys = ["calories", ...ROWS.map((r) => r.key)] as (keyof Nutrition)[];
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries([...keys, "servingSize" as const].map((k) => [k, value?.[k] == null ? "" : String(value[k])])));
  const [error, setError] = useState("");
  const save = async (clear = false) => {
    try {
      if (clear) return await onSave(null);
      const n = Object.fromEntries(keys.map((k) => [k, form[k].trim() === "" ? null : Number(form[k])])) as unknown as Nutrition;
      await onSave({ ...n, servingSize: form.servingSize.trim() || null, source: "you" });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const label = (k: keyof Nutrition) => (k === "calories" ? "Calories" : ROWS.find((r) => r.key === k)!.label) + (k === "sodium" ? " (mg)" : k === "calories" ? "" : " (g)");
  return (
    <Popup title="Nutrition per serving" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 p-5">
        <label className="col-span-2 text-sm font-semibold text-subtle">
          Serving size
          <input value={form.servingSize} onChange={(e) => setForm({ ...form, servingSize: e.target.value })} maxLength={100} placeholder="About 1½ cups (340 g)" className="mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action" />
        </label>
        {keys.map((k) => (
          <label key={k} className="text-sm font-semibold text-subtle">
            {label(k)}
            <input inputMode="decimal" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action" />
          </label>
        ))}
        {error && <p role="alert" className="col-span-2 text-error">{error}</p>}
        <div className="col-span-2 flex items-center gap-3">
          <button type="button" onClick={() => void save()} className="rounded-lg bg-primary px-5 py-2.5 font-semibold text-white">
            Save
          </button>
          {value && (
            <button type="button" onClick={() => void save(true)} className="ml-auto text-sm font-semibold text-error hover:underline">
              Remove nutrition facts
            </button>
          )}
        </div>
      </div>
    </Popup>
  );
}

// The label itself (read-only): serving size, calories, the nutrients with % Daily Value, points.
// The recipe page's card and the public share page both show it.
export function NutritionFacts({ value }: { value: Nutrition }) {
  const points = pointsEstimate(value);
  return (
    <>
      {value.servingSize && (
        <p className="mt-3 flex justify-between gap-3 font-semibold">
          <span>Serving size</span>
          <span>{value.servingSize}</span>
        </p>
      )}
      <div className="mt-3 border-y-[6px] border-ink py-2">
        <div className="flex items-end justify-between">
          <span className="text-lg font-black">Calories</span>
          <span className="text-3xl font-black">{value.calories === null ? "–" : Math.round(value.calories)}</span>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="sr-only">Nutrient</th>
            <th className="py-1 text-right text-xs font-semibold text-muted">% Daily Value</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => {
            const v = (value[r.key] ?? null) as number | null;
            // Like a US label: "Includes 10 g added sugars", under total sugars (only when known)
            if (r.key === "addedSugar") {
              if (v === null) return null;
              return (
                <tr key={r.key} className="border-t border-line">
                  <td className="py-1.5 pl-8">Includes {fmt(v)} g added sugars</td>
                  <td className="py-1.5 text-right font-semibold">{Math.round((v / 50) * 100)}%</td>
                </tr>
              );
            }
            return (
              <tr key={r.key} className="border-t border-line">
                <td className={`py-1.5 ${r.indent ? "pl-4" : "font-semibold"}`}>
                  {r.label} <span className="font-normal">{v === null ? "–" : `${fmt(v)} ${r.unit}`}</span>
                </td>
                <td className="py-1.5 text-right font-semibold">{v !== null && r.dv ? `${Math.round((v / r.dv) * 100)}%` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {points !== null && (
        <p className="mt-3 flex items-center justify-between rounded-lg bg-page px-3 py-2 text-sm">
          <span title="Worked out from calories, saturated fat, sugar (only added sugar, when it's known) and protein, the way points-based diet plans do. Approximate, not any program's official number.">
            Points <span className="text-subtle">(estimate)</span>
          </span>
          <strong className="text-lg">{points}</strong>
        </p>
      )}
    </>
  );
}

// Each ingredient's calories (the whole amount), when nutrition was worked out one ingredient at a
// time: the recipe page and Discover's recipe preview both show it
export function CaloriesByIngredient({ value, className = "" }: { value: Nutrition; className?: string }) {
  if (!value.perIngredient?.length) return null;
  return (
    <div className={className}>
      <h3 className="font-semibold">Calories by ingredient</h3>
      <p className="text-xs text-subtle">The whole amount of each, worked out one at a time and added up.</p>
      <ul aria-label="Calories by ingredient" className="mt-2 text-sm">
        {value.perIngredient.map((x) => (
          <li key={x.line} className="flex justify-between gap-3 border-t border-line py-1.5">
            <span>{x.line}</span>
            <span className="shrink-0 font-semibold">{Math.round(x.calories).toLocaleString()} kcal</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
