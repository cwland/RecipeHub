import { useEffect, useState } from "react";
import { api } from "../../api";
import { AISLE_NAMES, AISLE_ORDER, itemAmount, type GroceryList, type PreviewLine } from "../../recipes";
import { Popup } from "../Popup";

type Source = { recipes: { recipeId: number; servings?: number; scale?: number }[] } | { from: string; to: string };

// "Add to grocery list": what the recipe(s) need, added up. Things in the pantry start unticked
// (staples always), so you only buy what you don't have.
export default function AddToListDialog({ source, title, onClose }: { source: Source; title: string; onClose: () => void }) {
  const [lines, setLines] = useState<PreviewLine[] | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [lists, setLists] = useState<GroceryList[]>([]);
  const [listId, setListId] = useState<number | "new" | null>(null);
  const [newName, setNewName] = useState("");
  const [doneName, setDoneName] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ added: number; merged: number } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [p, l, week] = await Promise.all([
          api<{ lines: PreviewLine[] }>("POST", "/api/grocery/preview", source),
          api<GroceryList[]>("GET", "/api/grocery/lists"),
          api<{ name: string; listId: number | null }>("GET", "/api/grocery/this-week"),
        ]);
        setLines(p.lines);
        setKeep(new Set(p.lines.filter((x) => !x.pantry).map((x) => x.key)));
        setLists(l);
        // This week's list if there is one; no lists at all: start "Week of <Monday>"
        setListId(week.listId ?? l[0]?.id ?? "new");
        if (!week.listId) setNewName(week.name);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async () => {
    if (!lines || !listId) return;
    try {
      const items = lines.filter((x) => keep.has(x.key)).map(({ name, quantity, unit, sources }) => ({ name, quantity, unit, sources }));
      let id: number;
      if (listId === "new") {
        const made = await api<GroceryList>("POST", "/api/grocery/lists", { name: newName.trim() });
        id = made.id;
        setLists((l) => [...l, made]);
        setListId(id);
        setDoneName(made.name);
      } else {
        id = listId;
        setDoneName(lists.find((l) => l.id === id)?.name ?? "the list");
      }
      setDone(await api("POST", `/api/grocery/lists/${id}/items`, { items }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const flip = (k: string) => setKeep((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  if (done)
    return (
      <Popup title="Added" onClose={onClose}>
        <div className="p-5">
          <p className="text-lg">
            {done.added + done.merged} item{done.added + done.merged === 1 ? "" : "s"} on {doneName}
            {done.merged > 0 && <span className="text-subtle"> ({done.merged} added to what was already there)</span>}.
          </p>
          <div className="mt-4 flex gap-3">
            <a href={`#/grocery?list=${listId}`} onClick={onClose} className="rounded-lg bg-primary px-5 py-2.5 font-semibold text-white">
              Open the list
            </a>
            <button type="button" onClick={onClose} className="rounded-lg border border-line px-5 py-2.5 font-semibold">
              Done
            </button>
          </div>
        </div>
      </Popup>
    );

  const groups = AISLE_ORDER.map((a) => ({ aisle: a, list: (lines ?? []).filter((l) => l.aisle === a) })).filter((g) => g.list.length);
  return (
    <Popup title={`Add to grocery list: ${title}`} onClose={onClose} wide>
      <div className="flex flex-col gap-4 p-5">
        {error && <p role="alert" className="rounded-lg bg-error-subtle px-4 py-3 text-error">{error}</p>}
        {lines === null && !error && <p className="text-subtle">Adding it up…</p>}
        {lines?.length === 0 && <p className="text-subtle">There are no ingredients to add{"from" in source ? " for this week. Plan some recipes first." : "."}</p>}
        {groups.map((g) => (
          <section key={g.aisle} aria-label={AISLE_NAMES[g.aisle]}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{AISLE_NAMES[g.aisle]}</h3>
            <ul className="mt-1">
              {g.list.map((l) => (
                <li key={l.key}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-pressed">
                    <input type="checkbox" checked={keep.has(l.key)} onChange={() => flip(l.key)} className="mt-1 size-4 shrink-0 accent-action" />
                    <span className="min-w-0">
                      <span className={keep.has(l.key) ? "" : "text-muted"}>
                        {itemAmount(l) && <strong className="font-semibold">{itemAmount(l)} </strong>}
                        {l.name}
                      </span>
                      <span className="block text-xs text-muted">
                        {l.pantry && <span className="font-semibold text-action">{l.pantry.staple ? "Staple, always have it" : `In the pantry${itemAmount(l.pantry) ? `: ${itemAmount(l.pantry)}` : ""}`}</span>}
                        {l.pantry && l.sources.length > 1 && " · "}
                        {l.sources.length > 1 && `for ${l.sources.map((s) => s.title).join(", ")}`}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {lines && lines.length > 0 && (
          <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap items-center gap-3 border-t border-line bg-container px-5 py-4">
            <label className="text-sm font-semibold text-subtle">
              List{" "}
              <select aria-label="List" value={listId ?? ""} onChange={(e) => setListId(e.target.value === "new" ? "new" : Number(e.target.value))} className="ml-1 rounded-lg border border-line bg-page px-2 py-1.5">
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
                <option value="new">New list…</option>
              </select>
            </label>
            {listId === "new" && <input aria-label="New list name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="List name" className="min-w-0 basis-full rounded-lg sm:flex-1 sm:basis-auto border border-line bg-page px-2 py-1.5" />}
            <span className="text-sm text-subtle">{keep.size} of {lines.length}</span>
            <button type="button" disabled={!keep.size || (listId === "new" && !newName.trim())} onClick={() => void add()} className="ml-auto rounded-lg bg-primary px-5 py-2.5 font-semibold text-white disabled:opacity-50">
              Add {keep.size} item{keep.size === 1 ? "" : "s"}
            </button>
          </div>
        )}
      </div>
    </Popup>
  );
}
