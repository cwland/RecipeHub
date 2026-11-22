import { useEffect, useState } from "react";
import { api } from "../../api";
import type { Recipe } from "../../recipes";
import { Popup } from "../Popup";

// One version as GET /api/recipes/:id/versions lists it (newest first)
export interface VersionInfo {
  number: number;
  source: "import" | "created" | "ai" | "edit";
  summary: string;
  active: boolean;
  createdAt: string;
  by: string | null;
}

const SOURCE: Record<VersionInfo["source"], string> = { import: "Import", created: "Added", ai: "AI", edit: "Edit" };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

// The Version history tab: every saved version of the recipe and what changed in each
// (Set active and Delete for every version but the active one)
export function VersionHistory({ recipeId, reloadKey, onActivated }: { recipeId: number; reloadKey?: unknown; onActivated: (r: Recipe) => void }) {
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const load = () =>
    api<VersionInfo[]>("GET", `/api/recipes/${recipeId}/versions`)
      .then(setVersions)
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId, reloadKey]);

  const act = async (number: number, what: () => Promise<void>) => {
    setBusy(number);
    setError("");
    try {
      await what();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  };
  const activate = (number: number) => act(number, async () => onActivated(await api<Recipe>("POST", `/api/recipes/${recipeId}/versions/${number}/activate`)));
  const remove = (number: number) => {
    setDeleting(null);
    return act(number, async () => void (await api("DELETE", `/api/recipes/${recipeId}/versions/${number}`)));
  };

  return (
    <section aria-label="Version history" className="rounded-2xl bg-container p-5 sm:p-6">
      <h2 className="text-xl font-bold">Version history</h2>
      <p className="mt-1 text-sm text-subtle">Every change to the recipe's ingredients, steps and details is kept here. Tags, categories and the photo aren't part of versions.</p>
      {error && (
        <p role="alert" className="mt-3 text-error">
          {error}
        </p>
      )}
      {!versions && !error && <p className="mt-3 text-subtle">Loading…</p>}
      {versions && (
        <ul aria-label="Versions" className="mt-4 flex flex-col gap-2">
          {versions.map((v) => (
            <li key={v.number} className={`rounded-xl border px-4 py-3 ${v.active ? "border-action bg-brand-subtle" : "border-line"}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <strong className="text-lg">v{v.number}</strong>
                <span className="rounded-full bg-page px-2.5 py-0.5 text-xs font-semibold text-subtle">{SOURCE[v.source]}</span>
                {v.active && <span className="rounded-full bg-action px-2.5 py-0.5 text-xs font-semibold text-white">Active</span>}
                <span className="ml-auto text-sm text-muted">
                  {when(v.createdAt)}
                  {v.by ? ` · ${v.by}` : ""}
                </span>
              </div>
              <p className="mt-1">{v.summary}</p>
              {!v.active && (
                <div className="mt-2 flex gap-4 text-sm">
                  <button type="button" disabled={busy !== null} onClick={() => void activate(v.number)} className="font-semibold text-link hover:underline disabled:opacity-60">
                    {busy === v.number ? "Working…" : "Set active"}
                  </button>
                  <button type="button" disabled={busy !== null} onClick={() => setDeleting(v.number)} className="font-semibold text-error hover:underline disabled:opacity-60">
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {deleting !== null && (
        <Popup title={`Delete v${deleting}?`} onClose={() => setDeleting(null)}>
          <div className="p-6">
            <p>This version of the recipe will be gone for everyone in your household. The recipe itself stays as it is.</p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => void remove(deleting)} className="rounded bg-error px-5 py-2.5 font-semibold text-white hover:opacity-90">
                Delete v{deleting}
              </button>
              <button type="button" onClick={() => setDeleting(null)} className="px-2 py-2.5 font-semibold text-subtle hover:underline">
                Cancel
              </button>
            </div>
          </div>
        </Popup>
      )}
    </section>
  );
}
