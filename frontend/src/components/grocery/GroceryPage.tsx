import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../api";
import { useLive } from "../../live";
import { AISLE_NAMES, AISLE_ORDER, itemAmount, type GroceryItem, type GroceryList } from "../../recipes";
import { Check, MailIcon, PlusIcon, Trash } from "../Icons";
import { Popup } from "../Popup";
import { useSession } from "../../session";
import ArchivedLists from "./ArchivedLists";

// The grocery list, by store aisle. Tap to put it in the cart. Everyone in the household sees changes
// as they happen, so two people can shop from one list.
export default function GroceryPage() {
  const [lists, setLists] = useState<GroceryList[]>([]);
  const [listsLoaded, setListsLoaded] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [thisWeek, setThisWeek] = useState("");
  const [listId, setListId] = useState<number | null>(() => Number(new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("list")) || null);
  const [items, setItems] = useState<GroceryItem[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<GroceryItem | null>(null);
  const [newList, setNewList] = useState(false);
  const [emailing, setEmailing] = useState(false);
  // Edit mode: pick several items and take them off at once (not the same as checking them off)
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadLists = useCallback(async () => {
    const l = await api<GroceryList[]>("GET", "/api/grocery/lists");
    setLists(l);
    setListsLoaded(true);
    if (!l.length) void api<{ name: string }>("GET", "/api/grocery/this-week").then((w) => setThisWeek(w.name), () => {});
    setListId((id) => (id && l.some((x) => x.id === id) ? id : l[0]?.id ?? null));
  }, []);
  // The list on screen now: a slow answer for a list you've since left (or archived) is dropped
  const showing = useRef(listId);
  showing.current = listId;
  const loadItems = useCallback(async () => {
    if (!listId) return setItems(null); // no list (the last one was archived or deleted): nothing to show
    history.replaceState(null, "", `#/grocery?list=${listId}`);
    try {
      const got = await api<GroceryItem[]>("GET", `/api/grocery/lists/${listId}/items`);
      if (showing.current !== listId) return;
      setItems(got);
      setPicked((p) => (p.size ? new Set([...p].filter((id) => got.some((i) => i.id === id))) : p)); // picks that are gone (someone else took them off)
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [listId]);
  useEffect(() => void loadLists(), [loadLists]);
  useEffect(() => void loadItems(), [loadItems]);
  useLive(["grocery"], () => void Promise.all([loadLists(), loadItems()]));

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
    void loadItems();
    void loadLists();
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !listId) return;
    const t = text;
    setText("");
    void run(() => api("POST", `/api/grocery/lists/${listId}/items`, { text: t }));
  };
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
    setConfirmDelete(false);
  };
  const pick = (id: number) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const deletePicked = () => {
    const ids = [...picked];
    setItems((list) => list?.filter((x) => !picked.has(x.id)) ?? null);
    stopSelecting();
    void run(() => api("POST", "/api/grocery/items/delete", { ids }));
  };
  useEffect(stopSelecting, [listId]); // another list: start over
  const toggle = (i: GroceryItem) => {
    setItems((list) => list?.map((x) => (x.id === i.id ? { ...x, checked: !x.checked } : x)) ?? null); // right away
    void run(() => api("PATCH", `/api/grocery/items/${i.id}`, { checked: !i.checked }));
  };

  const open = items?.filter((i) => !i.checked) ?? [];
  const done = items?.filter((i) => i.checked) ?? [];
  const byAisle = AISLE_ORDER.map((a) => ({ aisle: a, list: open.filter((i) => i.aisle === a) })).filter((g) => g.list.length);
  const current = lists.find((l) => l.id === listId);

  return (
    <div className="mx-auto max-w-[760px] px-3 pb-24 pt-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">Grocery list</h1>
        {open.length > 0 && <span className="text-sm text-subtle">{open.length} to get</span>}
        {!!items?.length && !selecting && (
          <button type="button" onClick={() => setSelecting(true)} aria-label="Select items to delete" title="Select items to delete" className="flex items-center gap-1.5 rounded-lg border border-line bg-container px-3 py-1.5 text-sm font-semibold hover:bg-pressed">
            <Trash /> Edit
          </button>
        )}
        <button type="button" onClick={() => setShowArchived(true)} aria-label="Archived lists" title="Archived lists" className="rounded-lg border border-line bg-container px-3 py-1.5 text-sm font-semibold hover:bg-pressed">
          Archived
        </button>
        {open.length > 0 && (
          <button type="button" onClick={() => setEmailing(true)} className="flex items-center gap-1.5 rounded-lg border border-line bg-container px-3 py-1.5 text-sm font-semibold hover:bg-pressed">
            <MailIcon /> Email
          </button>
        )}
      </div>

      {/* Lists */}
      <nav aria-label="Lists" className="no-scrollbar -mx-3 mt-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {lists.map((l) => (
          <button key={l.id} type="button" aria-current={l.id === listId} onClick={() => setListId(l.id)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${l.id === listId ? "bg-primary text-white" : "bg-container text-subtle hover:text-ink"}`}>
            {l.name}
            {l.open > 0 && (
              <>
                {" "}
                <span className={`ml-1 rounded-full px-1.5 py-0.5 text-xs font-bold ${l.id === listId ? "bg-white/25 text-white" : "bg-primary/10 text-primary"}`}>({l.open})</span>
              </>
            )}
          </button>
        ))}
        <button type="button" onClick={() => setNewList(true)} className="shrink-0 rounded-full border border-dashed border-strong px-4 py-2 text-sm font-semibold text-subtle hover:text-ink">
          + List
        </button>
      </nav>

      {listsLoaded && lists.length === 0 && (
        <section className="mt-6 rounded-2xl bg-container px-6 py-12 text-center">
          <p className="text-lg">No grocery lists right now.</p>
          <p className="mt-1 text-subtle">Start this week's list, or bring items back from an archived one.</p>
          {thisWeek && (
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  setListId((await api<GroceryList>("POST", "/api/grocery/lists", { name: thisWeek })).id);
                })
              }
              className="mt-4 rounded-lg bg-primary px-5 py-2.5 font-semibold text-white"
            >
              Start {thisWeek}
            </button>
          )}
        </section>
      )}

      {/* Add: type or paste, one per line or "eggs, milk, bread" */}
      {listId && <form onSubmit={add} className="sticky top-0 z-10 -mx-3 mt-4 bg-page/95 px-3 py-2 backdrop-blur sm:mx-0 sm:px-0">
        <div className="flex gap-2">
          <input
            aria-label="Add items"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add items: eggs, 2 lb chicken thighs, milk…"
            className="min-w-0 flex-1 rounded-xl border border-line bg-container px-4 py-3 text-lg outline-none focus:border-action focus:ring-2 focus:ring-action/15"
          />
          <button type="submit" disabled={!text.trim()} aria-label="Add" title="Add" className="flex size-[3.25rem] shrink-0 items-center justify-center rounded-xl bg-primary text-white disabled:opacity-50">
            <PlusIcon />
          </button>
        </div>
      </form>}
      {selecting && (
        <div role="toolbar" aria-label="Delete items" className="sticky top-[4.5rem] z-10 mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-container px-3 py-2 shadow-sm">
          {confirmDelete ? (
            <>
              <span className="mr-auto font-semibold">
                Delete {picked.size} item{picked.size === 1 ? "" : "s"}?
              </span>
              <button type="button" onClick={deletePicked} className="rounded-lg bg-error px-3 py-1.5 text-sm font-semibold text-white">
                Delete
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold">
                Keep them
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setPicked(new Set((items ?? []).map((i) => i.id)))} className="rounded-lg px-2 py-1.5 text-sm font-semibold text-action hover:bg-pressed">
                Select all
              </button>
              <button type="button" onClick={stopSelecting} className="mr-auto rounded-lg px-2 py-1.5 text-sm font-semibold text-subtle hover:bg-pressed">
                Cancel
              </button>
              <button type="button" disabled={!picked.size} onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 rounded-lg bg-error px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                <Trash /> Delete {picked.size} item{picked.size === 1 ? "" : "s"}
              </button>
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-lg bg-error-subtle px-4 py-3 text-error">{error}</p>}

      {items && open.length === 0 && done.length === 0 && (
        <section className="mt-6 rounded-2xl bg-container px-6 py-12 text-center">
          <p className="text-lg">{current?.name ?? "This list"} is empty.</p>
          <p className="mt-1 text-subtle">Type above, or use “Add to grocery list” on a recipe or on this week's meal plan.</p>
        </section>
      )}

      {byAisle.map((g) => (
        <section key={g.aisle} aria-label={AISLE_NAMES[g.aisle]} className="mt-5">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{AISLE_NAMES[g.aisle]}</h2>
          <ul className="mt-1.5 overflow-hidden rounded-2xl bg-container">
            {g.list.map((i) => (
              <ItemRow key={i.id} i={i} onToggle={() => toggle(i)} onEdit={() => setEditing(i)} selecting={selecting} selected={picked.has(i.id)} onSelect={() => pick(i.id)} />
            ))}
          </ul>
        </section>
      ))}

      {done.length > 0 && (
        <section aria-label="In the cart" className="mt-8">
          <div className="flex flex-wrap items-center gap-2 px-1">
            <h2 className="mr-auto text-xs font-semibold uppercase tracking-wide text-muted">In the cart ({done.length})</h2>
            {!selecting && (
              <>
                <button type="button" onClick={() => void run(() => api("POST", `/api/grocery/lists/${listId}/clear-checked`, { toPantry: true }))} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white">
                  Done: put them in the pantry
                </button>
                <button type="button" onClick={() => void run(() => api("POST", `/api/grocery/lists/${listId}/clear-checked`, {}))} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold">
                  Clear
                </button>
              </>
            )}
          </div>
          <ul className="mt-1.5 overflow-hidden rounded-2xl bg-container opacity-70">
            {done.map((i) => (
              <ItemRow key={i.id} i={i} onToggle={() => toggle(i)} onEdit={() => setEditing(i)} selecting={selecting} selected={picked.has(i.id)} onSelect={() => pick(i.id)} />
            ))}
          </ul>
        </section>
      )}

      {editing && <EditItem i={editing} lists={lists} onClose={() => setEditing(null)} onDone={() => (setEditing(null), void loadItems(), void loadLists())} />}
      {emailing && listId && <EmailList listId={listId} onClose={() => setEmailing(false)} />}
      {newList && (
        <NewList
          onClose={() => setNewList(false)}
          onMade={(id) => {
            setNewList(false);
            setListId(id);
            void loadLists();
          }}
        />
      )}
      {current && <ListActions list={current} onChanged={(keep) => (keep || setListId(null), void loadLists())} />}
      {showArchived && (
        <ArchivedLists
          active={lists}
          onClose={() => setShowArchived(false)}
          onBrought={(id) => {
            setShowArchived(false);
            setListId(id);
            void loadLists();
          }}
        />
      )}
    </div>
  );
}

// selecting: edit mode, where a tap picks the item to delete instead of checking it off
function ItemRow({ i, onToggle, onEdit, selecting, selected, onSelect }: { i: GroceryItem; onToggle: () => void; onEdit: () => void; selecting: boolean; selected: boolean; onSelect: () => void }) {
  const amount = itemAmount(i);
  return (
    <li className={`flex items-center border-b border-line last:border-0 ${selecting && selected ? "bg-error-subtle" : ""}`}>
      <button type="button" role="checkbox" aria-checked={selecting ? selected : i.checked} aria-label={selecting ? `Select ${i.name}` : undefined} onClick={selecting ? onSelect : onToggle} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
        {selecting ? (
          <span className={`flex size-6 shrink-0 items-center justify-center rounded-md border-2 transition ${selected ? "border-error bg-error text-white" : "border-strong"}`}>{selected && <Check className="size-4" />}</span>
        ) : (
          <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition ${i.checked ? "border-action bg-action text-white" : "border-strong"}`}>{i.checked && <Check className="size-4" />}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className={`block ${i.checked ? "text-muted line-through" : ""}`}>
            {amount && <strong className="font-semibold">{amount} </strong>}
            {i.name}
          </span>
          {(i.note || i.sources.length > 0) && <span className="block truncate text-xs text-muted">{[i.note, i.sources.length ? `for ${i.sources.map((s) => s.title).join(", ")}` : ""].filter(Boolean).join(" · ")}</span>}
        </span>
      </button>
      {!selecting && (
        <button type="button" onClick={onEdit} aria-label={`Edit ${i.name}`} title={`Edit ${i.name}`} className="self-stretch px-4 text-muted hover:text-ink">
          ⋯
        </button>
      )}
    </li>
  );
}

function EditItem({ i, lists, onClose, onDone }: { i: GroceryItem; lists: GroceryList[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(i.name);
  const [quantity, setQuantity] = useState(i.quantity === null ? "" : String(i.quantity));
  const [unit, setUnit] = useState(i.unit ?? "");
  const [note, setNote] = useState(i.note ?? "");
  const [aisle, setAisle] = useState(i.aisle);
  const [listId, setListId] = useState(i.listId);
  const [error, setError] = useState("");
  const save = async () => {
    try {
      await api("PATCH", `/api/grocery/items/${i.id}`, {
        name,
        quantity: quantity.trim() ? Number(quantity) : null,
        unit: unit.trim() || null,
        note: note.trim() || null,
        ...(aisle !== i.aisle ? { aisle } : {}),
        ...(listId !== i.listId ? { listId } : {}),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const field = "mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action";
  return (
    <Popup title="Edit item" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 p-5">
        <label className="col-span-2 text-sm font-semibold text-subtle">
          Item
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </label>
        <label className="text-sm font-semibold text-subtle">
          Amount
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" className={field} placeholder="some" />
        </label>
        <label className="text-sm font-semibold text-subtle">
          Unit
          <input value={unit} onChange={(e) => setUnit(e.target.value)} className={field} placeholder="lb, cup, can…" />
        </label>
        <label className="text-sm font-semibold text-subtle">
          Aisle
          <select value={aisle} onChange={(e) => setAisle(e.target.value)} className={field}>
            {AISLE_ORDER.map((a) => (
              <option key={a} value={a}>
                {AISLE_NAMES[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-subtle">
          List
          <select value={listId} onChange={(e) => setListId(Number(e.target.value))} className={field}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 text-sm font-semibold text-subtle">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} className={field} placeholder="the big bag" />
        </label>
        {i.sources.length > 0 && <p className="col-span-2 text-sm text-subtle">For {i.sources.map((s) => s.title).join(", ")}</p>}
        {error && <p role="alert" className="col-span-2 text-error">{error}</p>}
        <div className="col-span-2 flex items-center gap-3">
          <button type="button" onClick={() => void save()} className="rounded-lg bg-primary px-5 py-2.5 font-semibold text-white">
            Save
          </button>
          <button
            type="button"
            onClick={async () => {
              await api("DELETE", `/api/grocery/items/${i.id}`);
              onDone();
            }}
            className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2.5 font-semibold text-error hover:bg-error-subtle"
          >
            <Trash /> Remove
          </button>
        </div>
      </div>
    </Popup>
  );
}

function NewList({ onClose, onMade }: { onClose: () => void; onMade: (id: number) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return (
    <Popup title="New list" onClose={onClose}>
      <form
        className="flex gap-2 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            onMade((await api<GroceryList>("POST", "/api/grocery/lists", { name })).id);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <input autoFocus aria-label="List name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Costco, Farmers market…" className="min-w-0 flex-1 rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action" />
        <button type="submit" disabled={!name.trim()} className="rounded-lg bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">
          Make it
        </button>
      </form>
      {error && <p role="alert" className="px-5 pb-5 text-error">{error}</p>}
    </Popup>
  );
}

// Bottom of a list: rename it, archive it (kept read-only under Archived lists), or delete it
function ListActions({ list, onChanged }: { list: GroceryList; onChanged: (keepSelected?: boolean) => void }) {
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState("");
  const act = async (what: "archive" | "delete") => {
    if (confirm !== what) return setConfirm(what);
    try {
      await api(what === "archive" ? "POST" : "DELETE", what === "archive" ? `/api/grocery/lists/${list.id}/archive` : `/api/grocery/lists/${list.id}`);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const btn = "rounded-lg px-3 py-2 text-sm font-semibold";
  return (
    <div className="mt-10 flex flex-wrap justify-center gap-2">
      <button type="button" onClick={() => setRenaming(true)} aria-label="Rename this list" className={`${btn} text-subtle hover:bg-pressed`}>
        Rename
      </button>
      <button type="button" onClick={() => void act("archive")} onBlur={() => setConfirm(null)} className={`${btn} ${confirm === "archive" ? "bg-primary text-white" : "text-action hover:bg-pressed"}`}>
        {confirm === "archive" ? `Archive "${list.name}"? It moves to Archived lists.` : "Archive this list"}
      </button>
      <button type="button" onClick={() => void act("delete")} onBlur={() => setConfirm(null)} className={`${btn} ${confirm === "delete" ? "bg-error text-white" : "text-error hover:bg-error-subtle"}`}>
        {confirm === "delete" ? `Delete "${list.name}" and everything on it?` : `Delete the "${list.name}" list`}
      </button>
      {error && <p role="alert" className="w-full text-center text-error">{error}</p>}
      {renaming && <RenameList list={list} onClose={() => setRenaming(false)} onDone={() => (setRenaming(false), onChanged(true))} />}
    </div>
  );
}

function RenameList({ list, onClose, onDone }: { list: GroceryList; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(list.name);
  const [error, setError] = useState("");
  return (
    <Popup title="Rename list" onClose={onClose}>
      <form
        className="flex gap-2 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("PATCH", `/api/grocery/lists/${list.id}`, { name });
            onDone();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <input autoFocus aria-label="List name" value={name} onChange={(e) => (setName(e.target.value), setError(""))} className="min-w-0 flex-1 rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action" />
        <button type="submit" disabled={!name.trim()} className="rounded-lg bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">
          Save
        </button>
      </form>
      {error && <p role="alert" className="px-5 pb-5 text-error">{error}</p>}
    </Popup>
  );
}

function EmailList({ listId, onClose }: { listId: number; onClose: () => void }) {
  const { user } = useSession();
  const [to, setTo] = useState(user.email ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("POST", `/api/grocery/lists/${listId}/email`, to.trim() ? { to } : {});
      setMsg({ ok: true, text: `Sent to ${to.trim()}. It has what's left to get, by aisle.` });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
    setBusy(false);
  };
  return (
    <Popup title="Email the list" onClose={onClose}>
      <form onSubmit={send} className="flex flex-col gap-3 p-5">
        <label className="text-sm font-semibold text-subtle">
          To
          <input type="text" inputMode="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com (commas for more)" className="mt-1 w-full rounded-lg border border-line bg-page px-3 py-2.5 outline-none focus:border-action" />
        </label>
        <button type="submit" disabled={busy || !to.trim()} className="self-start rounded-lg bg-primary px-5 py-2.5 font-semibold text-white disabled:opacity-60">
          {busy ? "Sending…" : "Send"}
        </button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-success" : "text-error"}>{msg.text}</p>}
      </form>
    </Popup>
  );
}
