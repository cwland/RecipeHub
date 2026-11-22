import { useEffect, useState } from "react";
import { api } from "../../api";
import { AISLE_NAMES, AISLE_ORDER, itemAmount, type GroceryItem, type GroceryList } from "../../recipes";
import { Popup } from "../Popup";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// Archived lists: kept as they were (checked and unchecked). Open one to look at it, then bring
// the items you still want onto a current list or a new one.
export default function ArchivedLists({ active, onClose, onBrought }: { active: GroceryList[]; onClose: () => void; onBrought: (listId: number) => void }) {
  const [lists, setLists] = useState<GroceryList[] | null>(null);
  const [open, setOpen] = useState<GroceryList | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<GroceryList[]>("GET", "/api/grocery/lists?archived=1")
      .then(setLists)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (open) return <ArchivedList list={open} active={active} onBack={() => setOpen(null)} onClose={onClose} onBrought={onBrought} />;
  return (
    <Popup title="Archived lists" onClose={onClose}>
      <div className="p-5">
        {error && <p role="alert" className="text-error">{error}</p>}
        {lists === null && !error && <p className="text-subtle">Loading…</p>}
        {lists?.length === 0 && <p className="text-subtle">No archived lists yet. Use “Archive this list” at the bottom of a list to keep it here.</p>}
        <ul className="flex flex-col gap-2">
          {lists?.map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => setOpen(l)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 text-left hover:bg-pressed">
                <span className="font-semibold">{l.name}</span>
                <span className="shrink-0 text-sm text-subtle">
                  {l.archivedAt && `Archived ${shortDate(l.archivedAt)} · `}
                  {l.open + l.done} item{l.open + l.done === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Popup>
  );
}

function ArchivedList({ list, active, onBack, onClose, onBrought }: { list: GroceryList; active: GroceryList[]; onBack: () => void; onClose: () => void; onBrought: (listId: number) => void }) {
  const [items, setItems] = useState<GroceryItem[] | null>(null);
  const [keep, setKeep] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState<string>(active[0] ? String(active[0].id) : "new");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ listId: number; count: number; to: string } | null>(null);

  useEffect(() => {
    api<GroceryItem[]>("GET", `/api/grocery/lists/${list.id}/items`)
      .then((i) => (setItems(i), setKeep(new Set(i.map((x) => x.id)))))
      .catch((e: Error) => setError(e.message));
    api<{ name: string; listId: number | null }>("GET", "/api/grocery/this-week")
      .then((w) => setName((n) => n || (w.listId ? "" : w.name)))
      .catch(() => {});
  }, [list.id]);

  const flip = (id: number) =>
    setKeep((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const bring = async () => {
    setBusy(true);
    setError("");
    try {
      const to = target === "new" ? { name: name.trim() } : { listId: Number(target) };
      const r = await api<{ listId: number; added: number; merged: number }>("POST", `/api/grocery/lists/${list.id}/bring-forward`, { itemIds: [...keep], ...to });
      setDone({ listId: r.listId, count: keep.size, to: target === "new" ? name.trim() : (active.find((l) => l.id === Number(target))?.name ?? "the list") });
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  const groups = AISLE_ORDER.map((a) => ({ aisle: a, list: (items ?? []).filter((i) => i.aisle === a) })).filter((g) => g.list.length);
  const field = "rounded-lg border border-line bg-page px-2 py-1.5";
  return (
    <Popup title={list.name} onClose={onClose} wide>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="rounded-lg px-2 py-1 text-sm font-semibold text-action hover:bg-pressed">
            ← Archived lists
          </button>
          <span className="text-sm text-subtle">Read-only{list.archivedAt && ` · archived ${shortDate(list.archivedAt)}`}. Tick what you want on a list again.</span>
        </div>
        {items === null && !error && <p className="text-subtle">Loading…</p>}
        {groups.map((g) => (
          <section key={g.aisle} aria-label={AISLE_NAMES[g.aisle]}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{AISLE_NAMES[g.aisle]}</h3>
            <ul className="mt-1">
              {g.list.map((i) => (
                <li key={i.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-pressed">
                    <input type="checkbox" checked={keep.has(i.id)} onChange={() => flip(i.id)} disabled={!!done} className="mt-1 size-4 shrink-0 accent-action" />
                    <span className={i.checked ? "text-muted line-through" : ""}>
                      {itemAmount(i) && <strong className="font-semibold">{itemAmount(i)} </strong>}
                      {i.name}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {error && <p role="alert" className="rounded-lg bg-error-subtle px-4 py-3 text-error">{error}</p>}
        {done ? (
          <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap items-center gap-3 border-t border-line bg-container px-5 py-4">
            <p role="status" className="mr-auto">
              Added {done.count} item{done.count === 1 ? "" : "s"} to {done.to}.
            </p>
            <button type="button" onClick={() => onBrought(done.listId)} className="rounded-lg bg-primary px-5 py-2.5 font-semibold text-white">
              Open the list
            </button>
          </div>
        ) : (
          items &&
          items.length > 0 && (
            <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap items-center gap-3 border-t border-line bg-container px-5 py-4">
              <label className="text-sm font-semibold text-subtle">
                Add to{" "}
                <select aria-label="Add to" value={target} onChange={(e) => setTarget(e.target.value)} className={`ml-1 ${field}`}>
                  {active.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                  <option value="new">New list…</option>
                </select>
              </label>
              {target === "new" && <input aria-label="New list name" value={name} onChange={(e) => setName(e.target.value)} placeholder="List name" className={`min-w-0 basis-full sm:basis-auto sm:flex-1 ${field}`} />}
              <button type="button" disabled={busy || !keep.size || (target === "new" && !name.trim())} onClick={() => void bring()} className="ml-auto rounded-lg bg-primary px-5 py-2.5 font-semibold text-white disabled:opacity-50">
                Add {keep.size} item{keep.size === 1 ? "" : "s"}
              </button>
            </div>
          )
        )}
      </div>
    </Popup>
  );
}
