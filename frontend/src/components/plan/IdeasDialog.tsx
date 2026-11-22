import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../api";
import { Popup } from "../Popup";

interface Idea {
  title: string;
  why: string;
  recipeId: number | null;
  uses: string[];
}

// "What should we eat?": AI looks at the pantry (what expires first), your recipes and what you've
// eaten lately. Your recipes open; new ideas can be searched for.
export default function IdeasDialog({ onClose, onPlan }: { onClose: () => void; onPlan?: (idea: Idea) => void }) {
  const [ask, setAsk] = useState("");
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      setIdeas((await api<{ ideas: Idea[] }>("POST", "/api/ai/ideas", ask.trim() ? { ask: ask.trim() } : {})).ideas);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };
  useEffect(() => void run(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Popup title="Meal ideas" onClose={onClose} wide>
      <div className="flex flex-col gap-4 p-5">
        <form onSubmit={run} className="flex gap-2">
          <input aria-label="What are you in the mood for?" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Anything in mind? “quick”, “vegetarian”, “something with the chicken”" className="min-w-0 flex-1 rounded-lg border border-line bg-page px-3 py-2.5 outline-none focus:border-action" />
          <button type="submit" disabled={busy} className="shrink-0 rounded-lg bg-primary px-4 py-2.5 font-semibold text-white disabled:opacity-60">
            {busy ? "Thinking…" : ideas ? "More ideas" : "Ask"}
          </button>
        </form>
        {error && <p role="alert" className="rounded-lg bg-error-subtle px-4 py-3 text-error">{error}</p>}
        {busy && !ideas && <p role="status" className="text-subtle">Looking at your pantry and recipes…</p>}
        {ideas?.length === 0 && <p className="text-subtle">No ideas came back. Try asking for something.</p>}
        {ideas && ideas.length > 0 && (
          <ul className={`flex flex-col gap-2 ${busy ? "opacity-50" : ""}`}>
            {ideas.map((i, n) => (
              <li key={n} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <strong className="mr-auto">{i.title}</strong>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${i.recipeId ? "bg-pressed text-action" : "bg-page text-subtle"}`}>{i.recipeId ? "Your recipe" : "New idea"}</span>
                </div>
                {i.why && <p className="mt-1 text-sm text-subtle">{i.why}</p>}
                {i.uses.length > 0 && <p className="mt-1 text-xs text-muted">Uses {i.uses.join(", ")}</p>}
                <div className="mt-2 flex flex-wrap gap-3 text-sm font-semibold">
                  {i.recipeId ? (
                    <a href={`#/recipes/${i.recipeId}`} onClick={onClose} className="text-link hover:underline">
                      Open the recipe
                    </a>
                  ) : (
                    <a href={`https://www.google.com/search?q=${encodeURIComponent(`${i.title} recipe`)}`} target="_blank" rel="noreferrer" className="text-link hover:underline">
                      Find a recipe
                    </a>
                  )}
                  {onPlan && (
                    <button type="button" onClick={() => onPlan(i)} className="text-link hover:underline">
                      Put it on the plan
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">Ideas come from your AI service, using your pantry, your recipes and the last 4 weeks of the meal plan.</p>
      </div>
    </Popup>
  );
}
