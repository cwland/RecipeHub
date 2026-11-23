import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { parseDay, today, type PlanEntry, type PlannerSettings } from "../../plan";
import { Popup } from "../Popup";
import MiniCalendar from "./MiniCalendar";

// From a recipe: pick a day on a small calendar and a meal, and put the recipe on the meal plan.
// servings: the recipe's scaled servings, when it's been scaled on the page.
export default function AddToPlanDialog({ recipeId, servings, onClose }: { recipeId: number; servings?: number; onClose: () => void }) {
  const [settings, setSettings] = useState<PlannerSettings | null>(null);
  const [date, setDate] = useState(today());
  const [slot, setSlot] = useState("");
  const [planned, setPlanned] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");

  useEffect(() => {
    api<PlannerSettings>("GET", "/api/plan/settings")
      .then(setSettings)
      .catch((e) => setError((e as Error).message));
  }, []);
  // Only the month on screen sets the dots: a slow answer for a month already moved past is dropped
  const shown = useRef("");
  const loadMonth = useCallback((from: string, to: string) => {
    const range = `from=${from}&to=${to}`;
    shown.current = range;
    api<PlanEntry[]>("GET", `/api/plan?${range}`)
      .then((entries) => shown.current === range && setPlanned(new Set(entries.map((e) => e.date))))
      .catch(() => shown.current === range && setPlanned(new Set())); // the dots are a nicety; adding still works
  }, []);

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      await api("POST", "/api/plan", { date, slot, recipeId, ...(servings ? { servings } : {}) });
      const day = parseDay(date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      setAdded(`Added to ${day} · ${settings?.slots.find((s) => s.id === slot)?.name ?? slot}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popup title="Add to meal plan" onClose={onClose}>
      {added ? (
        <div className="flex flex-col gap-4 p-5">
          <p className="text-center text-lg font-semibold">{added}</p>
          <div className="flex gap-2">
            <a href={`#/plan?week=${date}`} onClick={onClose} className="flex-1 rounded-lg border border-line px-3 py-2.5 text-center font-semibold hover:bg-pressed">
              Open planner
            </a>
            <button type="button" onClick={onClose} className="flex-1 rounded-lg bg-primary px-3 py-2.5 font-semibold text-white">
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 p-5">
          {settings && (
            <>
              <MiniCalendar value={date} onChange={setDate} weekStart={settings.weekStart} marked={planned} onMonthChange={loadMonth} />
              <div role="radiogroup" aria-label="Meal" className="flex flex-wrap justify-center gap-2">
                {settings.slots.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={slot === s.id}
                    onClick={() => setSlot(s.id)}
                    className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${slot === s.id ? "border-primary bg-primary text-white" : "border-line hover:bg-pressed"}`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="text-error">
              {error}
            </p>
          )}
          <button type="button" disabled={!slot || busy} onClick={() => void add()} className="rounded-lg bg-primary px-5 py-2.5 font-semibold text-white disabled:opacity-50">
            Add
          </button>
        </div>
      )}
    </Popup>
  );
}
