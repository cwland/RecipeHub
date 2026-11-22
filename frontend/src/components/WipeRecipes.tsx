import { useState, type FormEvent } from "react";
import { api, setToken } from "../api";

// Settings › Data (owner): Delete data, two choices. Delete all recipes (for starting imports over)
// or Reset the entire app (back to a fresh install). Both make a backup first, so Restore brings it back.
export function DeleteData({ onReset = () => window.location.assign("/") }: { onReset?: () => void }) {
  return (
    <section aria-label="Delete data" className="rounded-2xl border border-error/30 bg-container p-6">
      <h2 className="text-lg font-semibold text-error">Delete data</h2>
      <p className="mt-1 text-sm text-subtle">Both make a backup first, so you can restore it from Backups above.</p>
      <div className="mt-5 flex flex-col gap-6 divide-y divide-line">
        <Confirmed
          title="Delete all recipes"
          word="DELETE"
          busyText="Deleting…"
          text="Removes every recipe with everything tied to it (versions, ratings, notes, photos, substitutions, meal plan entries for them and the import history), plus all tags and collections. Your categories, grocery list, pantry and settings stay. Handy for testing imports from scratch."
          run={async () => {
            const r = await api<{ recipes: number; backup: string }>("POST", "/api/wipe/recipes", { confirm: "DELETE" });
            return `Deleted ${r.recipes} recipe${r.recipes === 1 ? "" : "s"}. A backup was made first (${r.backup}): restore it above to bring them back.`;
          }}
        />
        <Confirmed
          title="Reset the entire app"
          word="RESET"
          busyText="Resetting…"
          className="pt-6"
          text="Back to a fresh install: every recipe and photo, the people, passkeys and sign-ins, all settings (AI, email, feeds, API keys), the grocery list, pantry, meal plan, Discover and the logs. Everyone is signed out, and the next visit starts with creating the owner account and the setup wizard. A backup is made first, and your backups are kept. Restoring it after you set up again brings back the recipes, lists and settings, but not the other people's accounts or passkeys (backups don't hold sign-ins), so add them again in Household."
          run={async () => {
            await api("POST", "/api/wipe/all", { confirm: "RESET" });
            setToken(null);
            onReset();
            return "Reset. Taking you to the start…";
          }}
        />
      </div>
    </section>
  );
}

// One choice: what it does, type the word to confirm, then the button
function Confirmed({ title, word, busyText, text, run, className = "" }: { title: string; word: string; busyText: string; text: string; run: () => Promise<string>; className?: string }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (typed !== word) return;
    setBusy(true);
    setDone("");
    setError("");
    try {
      setDone(await run());
      setTyped("");
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };
  const label = `Type ${word} to confirm`;
  return (
    <section aria-label={title} className={className}>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-subtle">{text}</p>
      <form onSubmit={go} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold text-subtle">
          {label}
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="mt-1 block w-40 rounded-lg border border-line bg-page px-3 py-2 font-normal text-ink outline-none focus:border-error" />
        </label>
        <button type="submit" disabled={busy || typed !== word} className="rounded bg-error px-4 py-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-40">
          {busy ? busyText : title}
        </button>
      </form>
      {done && (
        <p role="status" className="mt-3 rounded-lg bg-success-subtle px-3 py-2 text-sm text-success">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-error-subtle px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}
    </section>
  );
}
