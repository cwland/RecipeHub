import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../api";
import type { CollectionInfo, Recipe, TagInfo } from "../../recipes";
import { Popup } from "../Popup";

// Organize (recipe page): its categories, collections and tags in one place, saved together on
// Done. None of these are part of versions, so nothing asks about one.
export function OrganizeDialog({ recipe, onClose, onSaved }: { recipe: Recipe; onClose: () => void; onSaved: (r: Recipe) => void }) {
  const [categories, setCategories] = useState<number[]>(recipe.categories.map((c) => c.id));
  const [collections, setCollections] = useState<number[]>(recipe.collections.map((c) => c.id));
  const [tags, setTags] = useState<string[]>(recipe.tags);
  const [allCategories, setAllCategories] = useState<TagInfo[]>([]);
  const [allCollections, setAllCollections] = useState<CollectionInfo[]>([]);
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const [tagText, setTagText] = useState("");
  const [newCollection, setNewCollection] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<TagInfo[]>("GET", "/api/categories").then(setAllCategories).catch(() => {});
    void api<CollectionInfo[]>("GET", "/api/collections").then(setAllCollections).catch(() => {});
    void api<TagInfo[]>("GET", "/api/tags").then(setAllTags).catch(() => {});
  }, []);

  const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const addTag = (t: string) => {
    const tag = t.trim().toLowerCase();
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
  };
  // A new collection is made right away (it's empty until Done puts this recipe in it)
  const makeCollection = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const c = await api<CollectionInfo>("POST", "/api/collections", { name: newCollection.trim() });
      setAllCollections((a) => [...a, c]);
      setCollections((x) => [...x, c.id]);
      setNewCollection("");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const same = (a: (number | string)[], b: (number | string)[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const done = async () => {
    const changed = !same(categories, recipe.categories.map((c) => c.id)) || !same(collections, recipe.collections.map((c) => c.id)) || JSON.stringify(tags) !== JSON.stringify(recipe.tags);
    if (!changed) return onClose();
    setBusy(true);
    setError("");
    try {
      onSaved(await api<Recipe>("PATCH", `/api/recipes/${recipe.id}`, { categories, collections, tags }));
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const heading = "text-sm font-semibold uppercase tracking-wide text-muted";
  const check = "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-pressed";
  const otherTags = allTags.filter((t) => !tags.includes(t.name));

  return (
    <Popup title="Organize" onClose={onClose}>
      <div className="flex flex-col gap-5 p-5">
        <section aria-label="Categories">
          <h3 className={heading}>Categories</h3>
          <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
            {allCategories.map((c) => (
              <label key={c.id} className={check}>
                <input type="checkbox" checked={categories.includes(c.id)} onChange={() => setCategories(flip(categories, c.id))} className="size-4 accent-action" />
                {c.name}
              </label>
            ))}
          </div>
        </section>

        <section aria-label="Collections">
          <h3 className={heading}>Collections</h3>
          {allCollections.length === 0 && <p className="mt-2 text-sm text-subtle">No collections yet. Make one below.</p>}
          <div className="mt-2 grid grid-cols-2 gap-1">
            {allCollections.map((c) => (
              <label key={c.id} className={check}>
                <input type="checkbox" checked={collections.includes(c.id)} onChange={() => setCollections(flip(collections, c.id))} className="size-4 accent-action" />
                {c.name}
              </label>
            ))}
          </div>
          <form onSubmit={makeCollection} className="mt-2 flex gap-2">
            <input aria-label="New collection" placeholder="New collection" value={newCollection} onChange={(e) => setNewCollection(e.target.value)} maxLength={100} className="min-w-0 flex-1 rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action" />
            <button type="submit" disabled={!newCollection.trim()} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-pressed disabled:opacity-50">
              Add
            </button>
          </form>
        </section>

        <section aria-label="Tags">
          <h3 className={heading}>Tags</h3>
          <ul aria-label="On this recipe" className="mt-2 flex flex-wrap gap-2">
            {tags.length === 0 && <li className="text-sm text-subtle">No tags yet.</li>}
            {tags.map((t) => (
              <li key={t} className="flex items-center gap-1 rounded-full bg-brand-subtle py-1 pl-3 pr-1 text-sm font-semibold text-action">
                #{t}
                <button type="button" aria-label={`Remove ${t}`} title={`Remove ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))} className="flex size-5 items-center justify-center rounded-full hover:bg-action/15">
                  ×
                </button>
              </li>
            ))}
          </ul>
          <label className="mt-3 block text-sm font-semibold text-subtle">
            New tag
            <input
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag(tagText);
                  setTagText("");
                }
              }}
              placeholder="weeknight, grill, vegetarian…"
              maxLength={60}
              className="mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 font-normal text-ink outline-none focus:border-action"
            />
          </label>
          {otherTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {otherTags.map((t) => (
                <button key={t.id} type="button" onClick={() => addTag(t.name)} className="rounded-full border border-line px-3 py-1 text-sm hover:bg-pressed">
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </section>

        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        <div>
          <button type="button" disabled={busy} onClick={() => void done()} className="rounded bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-pressed disabled:opacity-60">
            {busy ? "Saving…" : "Done"}
          </button>
        </div>
      </div>
    </Popup>
  );
}
