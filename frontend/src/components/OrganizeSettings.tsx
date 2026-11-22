import { useEffect, useMemo, useState, type FormEvent } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PlannerSettings } from "../plan";
import { api } from "../api";
import type { CollectionInfo, TagInfo } from "../recipes";
import { ChevronDown, ChevronUp, Trash } from "./Icons";
import { InlineText } from "./inputs";
import { Card } from "./settingsUi";
import { Popup } from "./Popup";

// Settings › Recipes: the household's categories, collections, tags and meal plan rows, one at a
// time. Each list is a set of chips (tap one to rename it, see its recipes or delete it);
// categories and collections sort A–Z, Z–A, or by hand (Manual: drag them, or Move earlier/later).
type Tab = "categories" | "collections" | "tags" | "meal";
const TABS: [Tab, string][] = [
  ["categories", "Categories"],
  ["collections", "Collections"],
  ["tags", "Tags"],
  ["meal", "Meal plan"],
];

export default function OrganizeSettings() {
  const [tab, setTab] = useState<Tab>("categories");
  return (
    <Card title="Organize" description="How recipes are grouped: categories (meal types or courses), your own collections, tags, and the meal plan's rows.">
      <div role="tablist" aria-label="Organize" className="mb-4 flex flex-wrap gap-1 rounded-lg bg-page p-1">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold ${tab === id ? "bg-container text-ink shadow-sm" : "text-subtle hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </div>
      <div>
        {tab === "categories" && <ChipList title="Categories" path="/api/categories" what="category" sortKey="categories" hint="Each recipe can be in several." />}
        {tab === "collections" && <ChipList title="Collections" path="/api/collections" what="collection" sortKey="collections" withDescription hint="Your own hand-picked lists, like Quick Meals. Add recipes to them from a recipe's Organize button." />}
        {tab === "tags" && <ChipList title="Tags" path="/api/tags" what="tag" noAdd searchable hint="Tags are added on each recipe. Rename one here to fix it everywhere; renaming it to another tag's name merges the two." />}
        {tab === "meal" && <MealSlots />}
      </div>
    </Card>
  );
}

type Item = TagInfo & Partial<Pick<CollectionInfo, "description">>;
type Sort = "az" | "za" | "manual";

function ChipList({ title, path, what, sortKey, withDescription, noAdd, searchable, hint }: { title: string; path: string; what: string; sortKey?: "categories" | "collections"; withDescription?: boolean; noAdd?: boolean; searchable?: boolean; hint: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [sort, setSort] = useState<Sort>("manual");
  const [find, setFind] = useState("");
  const [name, setName] = useState("");
  const [open, setOpen] = useState<Item | null>(null);
  const [error, setError] = useState("");

  const load = () =>
    void api<Item[]>("GET", path)
      .then(setItems)
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    load();
    if (sortKey)
      void api<Record<string, Sort>>("GET", "/api/organize/sort")
        .then((s) => setSort(s[sortKey] ?? "manual"))
        .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
    load();
  };
  const changeSort = (s: Sort) => {
    setSort(s);
    void run(() => api("PUT", "/api/organize/sort", { [sortKey!]: s }));
  };
  const reorder = (next: Item[]) => {
    setItems(next);
    void run(() => api("PUT", `${path}/order`, { ids: next.map((n) => n.id) }));
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api("POST", path, { name });
      setName("");
    });
  };
  const manual = !!sortKey && sort === "manual";
  const shown = useMemo(() => (items ?? []).filter((i) => !find.trim() || i.name.toLowerCase().includes(find.trim().toLowerCase())), [items, find]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const dragged = (e: DragEndEvent) => {
    if (!items || !e.over || e.active.id === e.over.id) return;
    reorder(arrayMove(items, items.findIndex((i) => i.id === e.active.id), items.findIndex((i) => i.id === e.over!.id)));
  };
  const plural = what === "category" ? "categories" : `${what}s`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-subtle">{hint}</p>
        {searchable && <input type="search" aria-label={`Find a ${what}`} placeholder={`Find a ${what}`} value={find} onChange={(e) => setFind(e.target.value)} className="w-40 rounded-lg border border-line bg-page px-3 py-1.5 text-sm" />}
        {sortKey && (
          <select aria-label={`Sort ${plural}`} value={sort} onChange={(e) => changeSort(e.target.value as Sort)} className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm">
            <option value="az">A–Z</option>
            <option value="za">Z–A</option>
            <option value="manual">Manual</option>
          </select>
        )}
      </div>
      {manual && items && items.length > 1 && <p className="text-xs text-muted">Drag the chips into the order you want.</p>}
      {items && !items.length && <p className="text-subtle">{noAdd ? "No tags yet. Add them on a recipe." : `No ${plural} yet.`}</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragged}>
        <SortableContext items={shown.map((i) => i.id)} strategy={rectSortingStrategy}>
          <ul aria-label={title} className="flex flex-wrap gap-2">
            {shown.map((it) => (
              <Chip key={it.id} item={it} draggable={manual} onOpen={() => setOpen(it)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {!noAdd && (
        <form onSubmit={add} className="flex gap-2">
          <input aria-label={`New ${what}`} placeholder={`New ${what}`} value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-action" />
          <button type="submit" disabled={!name.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Add
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {open && (
        <ChipEditor
          item={open}
          what={what}
          withDescription={withDescription}
          place={manual && items ? { at: items.findIndex((i) => i.id === open.id), of: items.length } : null}
          onMove={(by) => {
            const at = items!.findIndex((i) => i.id === open.id);
            reorder(arrayMove(items!, at, at + by));
          }}
          onSave={(change) => run(() => api("PATCH", `${path}/${open.id}`, change)).then(() => setOpen(null))}
          onDelete={() => run(() => api("DELETE", `${path}/${open.id}`)).then(() => setOpen(null))}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function Chip({ item, draggable, onOpen }: { item: Item; draggable: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !draggable });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? "z-10 opacity-80" : ""}>
      <button
        type="button"
        onClick={onOpen}
        {...(draggable ? { ...attributes, ...listeners } : {})}
        aria-label={`${item.name}, ${item.count} recipe${item.count === 1 ? "" : "s"}`}
        className={`flex items-center gap-2 rounded-full border border-line bg-page py-1 pl-3 pr-1.5 text-sm hover:border-action ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        <span className="font-medium">{item.name}</span>
        <span className="rounded-full bg-container px-1.5 text-xs text-subtle">{item.count}</span>
      </button>
    </li>
  );
}

// A chip, opened: rename it (and describe it, for collections), its recipes, move it, delete it
function ChipEditor({ item, what, withDescription, place, onMove, onSave, onDelete, onClose }: { item: Item; what: string; withDescription?: boolean; place: { at: number; of: number } | null; onMove: (by: number) => void; onSave: (change: Record<string, string | null>) => void; onDelete: () => void; onClose: () => void }) {
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? "");
  const [asking, setAsking] = useState(false);
  const save = (e: FormEvent) => {
    e.preventDefault();
    const change: Record<string, string | null> = {};
    if (name.trim() && name.trim() !== item.name) change.name = name.trim();
    if (withDescription && description.trim() !== (item.description ?? "")) change.description = description.trim() || null;
    if (!Object.keys(change).length) return onClose();
    onSave(change);
  };
  const field = "mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 font-normal text-ink outline-none focus:border-action";
  const href = `#/recipes?${what}=${what === "tag" ? encodeURIComponent(item.name) : item.id}`;
  return (
    <Popup title={item.name} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-3 p-5">
        <label className="text-sm font-semibold text-subtle">
          Name
          <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={field} />
        </label>
        {withDescription && (
          <label className="text-sm font-semibold text-subtle">
            Description
            <input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} className={field} />
          </label>
        )}
        <a href={href} onClick={onClose} className="self-start text-sm font-semibold text-link hover:underline">
          {item.count} recipe{item.count === 1 ? "" : "s"}
        </a>
        {place && (
          <div className="flex gap-2">
            <button type="button" disabled={place.at === 0} onClick={() => onMove(-1)} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-pressed disabled:opacity-40">
              Move earlier
            </button>
            <button type="button" disabled={place.at === place.of - 1} onClick={() => onMove(1)} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-pressed disabled:opacity-40">
              Move later
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-line pt-3">
          {!asking ? (
            <button type="button" onClick={() => setAsking(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-error hover:bg-error-subtle">
              <Trash /> Delete
            </button>
          ) : (
            <button type="button" onClick={onDelete} className="rounded-lg bg-error px-3 py-2 text-sm font-semibold text-white">
              Delete {item.name}
            </button>
          )}
          <span className="ml-auto" />
          <button type="submit" className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-pressed">
            Save
          </button>
        </div>
        {asking && <p className="text-xs text-subtle">The recipes stay; they're just no longer in this {what}.</p>}
      </form>
    </Popup>
  );
}

// The meal plan's rows (Breakfast, Lunch, Dinner, Snack) and the first day of the week
function MealSlots() {
  const [s, setS] = useState<PlannerSettings | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  useEffect(
    () =>
      void api<PlannerSettings>("GET", "/api/plan/settings")
        .then(setS)
        .catch((e) => setError((e as Error).message)),
    [],
  );
  const save = async (change: Partial<PlannerSettings>) => {
    setError("");
    try {
      setS(await api<PlannerSettings>("PUT", "/api/plan/settings", change));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!s)
    return error ? (
      <p role="alert" className="text-sm text-error">
        Meal plan rows couldn't load: {error}
      </p>
    ) : null;
  const move = (i: number, to: number) => {
    if (to < 0 || to >= s.slots.length) return;
    const next = [...s.slots];
    const [x] = next.splice(i, 1);
    next.splice(to, 0, x);
    void save({ slots: next });
  };
  return (
    <Card title="Meal plan" description="The meals on the plan, in order, and the day your week starts.">
      <ul className="divide-y divide-line">
        {s.slots.map((slot, i) => (
          <li key={slot.id} className="flex items-center gap-2 py-2">
            <span className="flex flex-col">
              <button type="button" aria-label={`Move ${slot.name} up`} title={`Move ${slot.name} up`} disabled={i === 0} onClick={() => move(i, i - 1)} className="text-muted hover:text-ink disabled:opacity-30">
                <ChevronUp />
              </button>
              <button type="button" aria-label={`Move ${slot.name} down`} title={`Move ${slot.name} down`} disabled={i === s.slots.length - 1} onClick={() => move(i, i + 1)} className="text-muted hover:text-ink disabled:opacity-30">
                <ChevronDown />
              </button>
            </span>
            <InlineText value={slot.name} ariaLabel={`Rename ${slot.name}`} onSave={(v) => void save({ slots: s.slots.map((x) => (x.id === slot.id ? { ...x, name: v } : x)) })} className="w-full flex-1 font-medium" />
            <button type="button" aria-label={`Remove ${slot.name}`} title={`Remove ${slot.name}`} disabled={s.slots.length === 1} onClick={() => void save({ slots: s.slots.filter((x) => x.id !== slot.id) })} className="rounded px-2 py-1.5 text-muted hover:bg-error-subtle hover:text-error disabled:opacity-30">
              <Trash />
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void save({ slots: [...s.slots, { id: "", name: name.trim() }] }).then(() => setName(""));
        }}
        className="mt-3 flex gap-2"
      >
        <input aria-label="New meal" placeholder="New meal (Brunch, Dessert…)" value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 rounded border border-muted/50 bg-container px-3 py-2 outline-none focus:border-action" />
        <button type="submit" disabled={!name.trim()} className="rounded bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">
          Add
        </button>
      </form>
      <label className="mt-4 flex items-center gap-3 text-sm font-semibold text-subtle">
        Weeks start on
        <select value={s.weekStart} onChange={(e) => void save({ weekStart: Number(e.target.value) as 0 | 1 })} className="rounded border border-line bg-container px-2 py-1.5">
          <option value={1}>Monday</option>
          <option value={0}>Sunday</option>
        </select>
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
    </Card>
  );
}
