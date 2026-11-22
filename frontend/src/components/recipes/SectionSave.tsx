import { useState, type ReactNode } from "react";
import { api, ApiError } from "../../api";
import type { Recipe } from "../../recipes";
import { Popup } from "../Popup";

// Saving one section edited in place on the recipe page (details, ingredients, steps, notes).
// With recipe versioning on, it first asks: save to the current version, or as a new one?
// save(body, done): done runs once the recipe is saved (it closes the section).
export function useSectionSave(recipe: Recipe | null, onSaved: (r: Recipe) => void) {
  const [asking, setAsking] = useState<{ body: Record<string, unknown>; done: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const send = async (body: Record<string, unknown>, done: () => void, version?: "new" | "current") => {
    if (!recipe) return;
    setAsking(null);
    setBusy(true);
    setError("");
    setFieldErrors({});
    try {
      onSaved(await api<Recipe>("PATCH", `/api/recipes/${recipe.id}`, version ? { ...body, version } : body));
      done();
    } catch (e) {
      if (e instanceof ApiError && e.details) setFieldErrors(Object.fromEntries(e.details.map((d) => [d.path, d.message])));
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = (body: Record<string, unknown>, done: () => void) => {
    setError("");
    if (recipe?.versioning) setAsking({ body, done });
    else void send(body, done);
  };
  const clear = () => {
    setError("");
    setFieldErrors({});
  };

  const askPopup: ReactNode = asking && <VersionChoice onCurrent={() => void send(asking.body, asking.done, "current")} onNew={() => void send(asking.body, asking.done, "new")} onCancel={() => setAsking(null)} />;

  return { save, busy, error, fieldErrors, clear, askPopup };
}

// Save / Cancel under a section being edited
export function SectionButtons({ busy, error, onCancel }: { busy: boolean; error?: string; onCancel: () => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="submit" disabled={busy} className="rounded bg-primary px-5 py-2 font-semibold text-white hover:bg-primary-pressed disabled:opacity-60">
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={onCancel} className="px-2 py-2 font-semibold text-subtle hover:underline">
        Cancel
      </button>
      {error && (
        <span role="alert" className="text-sm text-error">
          {error}
        </span>
      )}
    </div>
  );
}

// Save to the current version (Update), or as a new one? Three small buttons of the same size in
// a row across the bottom; New version is filled in as the usual choice.
export function VersionChoice({ onCurrent, onNew, onCancel }: { onCurrent: () => void; onNew: () => void; onCancel: () => void }) {
  const shape = "min-w-[6.5rem] rounded-lg border px-3 py-1.5 text-sm font-semibold";
  return (
    <Popup title="Save your changes" onClose={onCancel}>
      <div className="p-6 pb-5">
        <p>Update the current version, or save your changes as a new version?</p>
        <p className="mt-2 text-sm text-subtle">A new version keeps the recipe as it was in Version history, so you can go back to it.</p>
      </div>
      <div role="group" aria-label="Save choices" className="flex flex-wrap justify-end gap-2 border-t border-line bg-page px-6 py-3">
        <button type="button" onClick={onCurrent} className={`${shape} border-line bg-container text-ink hover:bg-pressed`}>
          Update
        </button>
        <button type="button" onClick={onNew} className={`${shape} border-primary bg-primary text-white hover:bg-primary-pressed`}>
          New version
        </button>
        <button type="button" onClick={onCancel} className={`${shape} border-line bg-container text-ink hover:bg-pressed`}>
          Cancel
        </button>
      </div>
    </Popup>
  );
}
