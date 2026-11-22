import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../../api";
import { useLive } from "../../live";
import { AISLE_NAMES, AISLE_ORDER, formatMinutes, itemAmount, type PantryItem } from "../../recipes";
import { PlusIcon, Trash } from "../Icons";
import { Popup } from "../Popup";
import { RecipeImage } from "../recipes/RecipeList";
import IdeasDialog from "../plan/IdeasDialog";
import { useAiStatus } from "../../ai";

interface Cookable {
  id: number;
  title: string;
  imageUrl: string | null;
  totalMinutes: number | null;
  have: number;
  of: number;
  missing: string[];
}

const daysUntil = (d: string) => Math.round((new Date(`${d}T12:00:00`).getTime() - Date.now()) / 86400000);

// What's at home. Grocery lists skip what's here (and staples, which you always have), and recipes
// you can make from it show at the top.
export default function PantryPage() {
  const [items, setItems] = useState<PantryItem[] | null>(null);
  const [cookable, setCookable] = useState<Cookable[]>([]);
  const [text, setText] = useState("");
  const [staple, setStaple] = useState(false);
  const [editing, setEditing] = useState<PantryItem | null>(null);
  const [error, setError] = useState("");
  const [ideas, setIdeas] = useState(false);
  const ai = useAiStatus();

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([api<PantryItem[]>("GET", "/api/pantry"), api<Cookable[]>("GET", "/api/recipes/cookable")]);
      setItems(p);
      setCookable(c);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);
  useLive(["pantry"], () => void load());

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const t = text;
    setText("");
    try {
      await api("POST", "/api/pantry", { text: t, ...(staple ? { staple: true } : {}) });
    } catch (err) {
      setError((err as Error).message);
    }
    void load();
  };
  const remove = async (i: PantryItem) => {
    setItems((list) => list?.filter((x) => x.id !== i.id) ?? null);
    await api("DELETE", `/api/pantry/${i.id}`).catch(() => {});
    void load();
  };

  const groups = AISLE_ORDER.map((a) => ({ aisle: a, list: (items ?? []).filter((i) => i.aisle === a) })).filter((g) => g.list.length);
  return (
    <div className="mx-auto max-w-[1100px] px-3 pb-24 pt-4 sm:px-6">
      <h1 className="text-2xl font-semibold">Pantry</h1>
      <p className="mt-1 text-subtle">What you have at home. When you add a recipe to the grocery list, these are left off (you can still add them).</p>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <form onSubmit={add} className="flex flex-col gap-2 rounded-2xl bg-container p-3">
            <div className="flex gap-2">
              <input aria-label="Add to the pantry" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add: 2 lb rice, eggs, olive oil…" className="min-w-0 flex-1 rounded-xl border border-line bg-page px-4 py-3 outline-none focus:border-action focus:ring-2 focus:ring-action/15" />
              <button type="submit" disabled={!text.trim()} aria-label="Add" title="Add" className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-white disabled:opacity-50">
                <PlusIcon />
              </button>
            </div>
            <label className="flex items-center gap-2 px-1 text-sm text-subtle">
              <input type="checkbox" checked={staple} onChange={(e) => setStaple(e.target.checked)} className="size-4 accent-action" />
              Staples I always have (salt, oil, spices…): never added to lists
            </label>
          </form>
          {error && <p role="alert" className="mt-3 rounded-lg bg-error-subtle px-4 py-3 text-error">{error}</p>}
          {items?.length === 0 && <p className="mt-6 rounded-2xl bg-container px-6 py-10 text-center text-subtle">Nothing here yet. Add what you have, or tick “put them in the pantry” when you finish shopping.</p>}
          {groups.map((g) => (
            <section key={g.aisle} aria-label={AISLE_NAMES[g.aisle]} className="mt-5">
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{AISLE_NAMES[g.aisle]}</h2>
              <ul className="mt-1.5 overflow-hidden rounded-2xl bg-container">
                {g.list.map((i) => {
                  const left = i.expiresOn ? daysUntil(i.expiresOn) : null;
                  return (
                    <li key={i.id} className="flex items-center gap-2 border-b border-line px-4 py-2.5 last:border-0">
                      <button type="button" onClick={() => setEditing(i)} className="min-w-0 flex-1 text-left">
                        <span className="block">
                          {itemAmount(i) && <strong className="font-semibold">{itemAmount(i)} </strong>}
                          {i.name}
                          {i.staple && <span className="ml-2 rounded-full bg-page px-2 py-0.5 text-xs font-semibold text-subtle">Staple</span>}
                        </span>
                        {left !== null && <span className={`text-xs ${left < 0 ? "font-semibold text-error" : left <= 3 ? "font-semibold text-warning" : "text-muted"}`}>{left < 0 ? `Expired ${-left} day${left === -1 ? "" : "s"} ago` : left === 0 ? "Use today" : `Use within ${left} day${left === 1 ? "" : "s"}`}</span>}
                      </button>
                      <button type="button" onClick={() => void remove(i)} aria-label={`Used up: ${i.name}`} title="Used up" className="rounded-lg p-2 text-muted hover:bg-error-subtle hover:text-error">
                        <Trash />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <aside aria-label="Cook with what you have" className="self-start rounded-2xl bg-container p-5 lg:sticky lg:top-4">
          <h2 className="text-lg font-bold">Cook with what you have</h2>
          <p className="mt-1 text-sm text-subtle">Your recipes, by how much of them is in the pantry.</p>
          {ai.ready && (
            <button type="button" onClick={() => setIdeas(true)} className="mt-3 rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:bg-pressed">
              Get meal ideas with AI
            </button>
          )}
          {cookable.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{items?.length ? "No recipe is half covered yet. Add more of what you have." : "Add what you have to see what you can make."}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {cookable.map((r) => (
                <li key={r.id}>
                  <a href={`#/recipes/${r.id}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-pressed">
                    <RecipeImage src={r.imageUrl} title={r.title} className="size-14 shrink-0 rounded-lg [&>svg]:size-6" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.title}</span>
                      <span className="block text-xs text-subtle">
                        {r.have === r.of ? "You have everything" : `Have ${r.have} of ${r.of} · need ${r.missing.join(", ")}`}
                        {r.totalMinutes ? ` · ${formatMinutes(r.totalMinutes)}` : ""}
                      </span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-page">
                        <span className="block h-full rounded-full bg-action" style={{ width: `${(r.have / r.of) * 100}%` }} />
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
      {ideas && <IdeasDialog onClose={() => setIdeas(false)} />}
      {editing && <EditPantry i={editing} onClose={() => setEditing(null)} onDone={() => (setEditing(null), void load())} />}
    </div>
  );
}

function EditPantry({ i, onClose, onDone }: { i: PantryItem; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: i.name, quantity: i.quantity === null ? "" : String(i.quantity), unit: i.unit ?? "", staple: i.staple, expiresOn: i.expiresOn ?? "", note: i.note ?? "" });
  const [error, setError] = useState("");
  const field = "mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action";
  const save = async () => {
    try {
      await api("PATCH", `/api/pantry/${i.id}`, { name: form.name, quantity: form.quantity.trim() ? Number(form.quantity) : null, unit: form.unit.trim() || null, staple: form.staple, expiresOn: form.expiresOn || null, note: form.note.trim() || null });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Popup title={i.name} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 p-5">
        <label className="col-span-2 text-sm font-semibold text-subtle">
          Item
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
        </label>
        <label className="text-sm font-semibold text-subtle">
          Amount
          <input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} inputMode="decimal" className={field} placeholder="some" />
        </label>
        <label className="text-sm font-semibold text-subtle">
          Unit
          <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={field} />
        </label>
        <label className="text-sm font-semibold text-subtle">
          Use by
          <input type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} className={field} />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-subtle">
          <input type="checkbox" checked={form.staple} onChange={(e) => setForm({ ...form, staple: e.target.checked })} className="size-4 accent-action" />
          Staple (always have)
        </label>
        <label className="col-span-2 text-sm font-semibold text-subtle">
          Note
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={field} placeholder="in the garage freezer" />
        </label>
        {error && <p role="alert" className="col-span-2 text-error">{error}</p>}
        <button type="button" onClick={() => void save()} className="col-span-2 justify-self-start rounded-lg bg-primary px-5 py-2.5 font-semibold text-white">
          Save
        </button>
      </div>
    </Popup>
  );
}
