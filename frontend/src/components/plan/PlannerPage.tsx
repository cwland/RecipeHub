import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { api } from "../../api";
import { addDays, dayName, parseDay, today, weekLabel, weekOf, type PlanEntry, type PlannerSettings } from "../../plan";
import { formatMinutes, type RecipeSummary } from "../../recipes";
import { ChevronLeft, ChevronRight, ClockIcon, PlusIcon, SearchIcon } from "../Icons";
import { Popup } from "../Popup";
import { RecipeImage } from "../recipes/RecipeList";
import AddToListDialog from "../grocery/AddToListDialog";
import IdeasDialog from "./IdeasDialog";
import { useAiStatus } from "../../ai";
import { useLive } from "../../live";

// The meal plan: a week of days and meal slots. Drag recipes in from the list on the right (or use +),
// drag dishes between days, and tap one to open it, change servings or move it.

const cellId = (date: string, slot: string) => `cell|${date}|${slot}`;

// Where the pointer is (not how much the dragged card overlaps, which a wide card does with
// several days); over a dish means "put it before this one"
const whereThePointerIs: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (!hits.length) return rectIntersection(args);
  return [...hits].sort((a, b) => Number(String(b.id).startsWith("before|")) - Number(String(a.id).startsWith("before|")));
};

export default function PlannerPage() {
  const [settings, setSettings] = useState<PlannerSettings | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<{ date: string; slot: string } | null>(null);
  const [open, setOpen] = useState<PlanEntry | null>(null);
  const [dragging, setDragging] = useState<{ title: string; imageUrl: string | null } | null>(null);
  const [menu, setMenu] = useState(false);
  const [shopping, setShopping] = useState(false);
  const [ideas, setIdeas] = useState(false);
  const ai = useAiStatus();

  useEffect(() => {
    void api<PlannerSettings>("GET", "/api/plan/settings").then((s) => {
      setSettings(s);
      const fromHash = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("week");
      setStart(weekOf(fromHash && /^\d{4}-\d{2}-\d{2}$/.test(fromHash) ? fromHash : today(), s.weekStart));
    });
  }, []);

  const days = useMemo(() => (start ? Array.from({ length: 7 }, (_, i) => addDays(start, i)) : []), [start]);
  const load = useCallback(() => {
    if (!start) return;
    history.replaceState(null, "", `#/plan?week=${start}`);
    api<PlanEntry[]>("GET", `/api/plan?from=${start}&to=${addDays(start, 6)}`)
      .then((e) => (setEntries(e), setError("")))
      .catch((e) => setError((e as Error).message));
  }, [start]);
  useEffect(load, [load]);
  useLive(["plan"], () => load());

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
    load();
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }));
  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current as { title: string; imageUrl: string | null }) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const over = e.over?.data.current as { date: string; slot: string; position?: number } | undefined;
    const what = e.active.data.current as { kind: "entry" | "recipe"; id: number } | undefined;
    if (!over || !what) return;
    if (what.kind === "recipe") {
      void run(() => api("POST", "/api/plan", { date: over.date, slot: over.slot, recipeId: what.id }));
      return;
    }
    const entry = entries.find((x) => x.id === what.id);
    if (!entry) return;
    if (entry.date === over.date && entry.slot === over.slot && over.position === undefined) return;
    // show the move right away; the server confirms
    setEntries((list) => list.map((x) => (x.id === entry.id ? { ...x, date: over.date, slot: over.slot, position: over.position ?? 999 } : x)));
    void run(() => api("PATCH", `/api/plan/${entry.id}`, { date: over.date, slot: over.slot, ...(over.position !== undefined ? { position: over.position } : {}) }));
  };

  if (!settings || !start) return <div className="p-6" />;
  const cell = (date: string, slot: string) => entries.filter((e) => e.date === date && e.slot === slot).sort((a, b) => a.position - b.position);
  const isToday = (d: string) => d === today();

  return (
    <DndContext sensors={sensors} collisionDetection={whereThePointerIs} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="mx-auto flex max-w-[1500px] gap-6 px-3 pb-16 pt-4 sm:px-6">
        <div className="min-w-0 flex-1">
          {/* Header: the week, and what you can do with it */}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="mr-auto text-2xl font-semibold">Meal plan</h1>
            <div className="flex items-center gap-1 rounded-lg bg-container p-1">
              <button type="button" aria-label="Previous week" title="Previous week" onClick={() => setStart(addDays(start, -7))} className="rounded-md p-2 hover:bg-pressed">
                <ChevronLeft />
              </button>
              <span className="min-w-44 text-center font-semibold" aria-live="polite">
                {weekLabel(start)}
              </span>
              <button type="button" aria-label="Next week" title="Next week" onClick={() => setStart(addDays(start, 7))} className="rounded-md p-2 hover:bg-pressed">
                <ChevronRight />
              </button>
            </div>
            {start !== weekOf(today(), settings.weekStart) && (
              <button type="button" onClick={() => setStart(weekOf(today(), settings.weekStart))} className="rounded-lg border border-line bg-container px-3 py-2 text-sm font-semibold">
                This week
              </button>
            )}
            <div className="relative">
              <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} className="rounded-lg border border-line bg-container px-3 py-2 text-sm font-semibold">
                Week ▾
              </button>
              {menu && (
                <div role="menu" className="absolute right-0 z-30 mt-1 w-60 overflow-hidden rounded-xl bg-container py-1 shadow-[0_8px_28px_rgba(0,0,0,0.16)]" onMouseLeave={() => setMenu(false)}>
                  {ai.ready && (
                    <button role="menuitem" type="button" className="block w-full px-4 py-2.5 text-left hover:bg-pressed" onClick={() => (setMenu(false), setIdeas(true))}>
                      Meal ideas
                    </button>
                  )}
                  <button role="menuitem" type="button" className="block w-full px-4 py-2.5 text-left hover:bg-pressed" onClick={() => (setMenu(false), setShopping(true))}>
                    Add this week to the grocery list
                  </button>
                  <button role="menuitem" type="button" className="block w-full px-4 py-2.5 text-left hover:bg-pressed" onClick={() => (setMenu(false), void run(() => api("POST", "/api/plan/copy", { from: addDays(start, -7), to: start })))}>
                    Copy last week into this one
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    className="block w-full px-4 py-2.5 text-left text-error hover:bg-error-subtle"
                    onClick={() => {
                      setMenu(false);
                      if (entries.length && window.confirm(`Clear all ${entries.length} meals planned for ${weekLabel(start)}?`)) void run(() => api("DELETE", `/api/plan?from=${start}&to=${addDays(start, 6)}`));
                    }}
                  >
                    Clear this week
                  </button>
                </div>
              )}
            </div>
          </div>
          {error && <p role="alert" className="mt-3 rounded-lg bg-error-subtle px-4 py-3 text-error">{error}</p>}

          {/* Computers and tablets: a grid of meals by days */}
          <div className="mt-4 hidden overflow-x-auto rounded-2xl bg-container md:block">
            <table className="w-full min-w-[48rem] table-fixed border-collapse">
              <thead>
                <tr>
                  <th className="w-24" />
                  {days.map((d) => (
                    <th key={d} scope="col" className={`border-b border-line px-2 py-3 text-left ${isToday(d) ? "text-action" : ""}`}>
                      <span className="block text-xs font-semibold uppercase tracking-wide text-muted">{dayName(d)}</span>
                      <span className={`mt-0.5 inline-flex size-8 items-center justify-center rounded-full text-lg font-bold ${isToday(d) ? "bg-action text-white" : ""}`}>{parseDay(d).getDate()}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {settings.slots.map((s) => (
                  <tr key={s.id} className="align-top">
                    <th scope="row" className="border-b border-line px-3 py-3 text-left text-sm font-semibold text-subtle">
                      {s.name}
                    </th>
                    {days.map((d) => (
                      <Cell key={d} date={d} slot={s.id} today={isToday(d)} onAdd={() => setAdding({ date: d, slot: s.id })}>
                        {cell(d, s.id).map((e, i) => (
                          <EntryCard key={e.id} e={e} index={i} onOpen={() => setOpen(e)} />
                        ))}
                      </Cell>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: day after day */}
          <div className="mt-4 flex flex-col gap-3 md:hidden">
            {days.map((d) => (
              <section key={d} aria-label={dayName(d, "long")} className={`rounded-2xl bg-container p-4 ${isToday(d) ? "ring-2 ring-action" : ""}`}>
                <h2 className="font-semibold">
                  {dayName(d, "long")} <span className="font-normal text-muted">{parseDay(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  {isToday(d) && <span className="ml-2 rounded-full bg-action px-2 py-0.5 text-xs text-white">Today</span>}
                </h2>
                <div className="mt-2 flex flex-col">
                  {settings.slots.map((s) => {
                    const list = cell(d, s.id);
                    return (
                      <div key={s.id} className="flex items-start gap-3 border-t border-line py-2 first:border-0">
                        <span className="w-20 shrink-0 pt-2 text-sm font-semibold text-subtle">{s.name}</span>
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          {list.map((e, i) => (
                            <EntryCard key={e.id} e={e} index={i} onOpen={() => setOpen(e)} compact />
                          ))}
                          <button type="button" onClick={() => setAdding({ date: d, slot: s.id })} aria-label={`Add to ${dayName(d, "long")} ${s.name}`} title={`Add to ${dayName(d, "long")} ${s.name}`} className="self-start rounded-lg px-2 py-1.5 text-sm font-semibold text-link">
                            + Add
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>

        <RecipePicker />
      </div>

      <DragOverlay dropAnimation={null}>{dragging && <div className="w-48 rotate-2 rounded-xl bg-container p-2 text-sm font-semibold shadow-[0_12px_30px_rgba(0,0,0,0.25)]">{dragging.title}</div>}</DragOverlay>

      {adding && <AddDialog settings={settings} at={adding} onClose={() => setAdding(null)} onAdded={() => (setAdding(null), load())} />}
      {ideas && start && settings && (
        <IdeasDialog
          onClose={() => setIdeas(false)}
          onPlan={(i) => {
            // the first open dinner this week, from today on
            const slot = settings.slots.find((x) => x.id === "dinner")?.id ?? settings.slots[settings.slots.length - 1].id;
            const from = today() > start ? today() : start;
            const day = days.find((d) => d >= from && !entries.some((e) => e.date === d && e.slot === slot)) ?? days.find((d) => d >= from) ?? start;
            setIdeas(false);
            void run(() => api("POST", "/api/plan", { date: day, slot, ...(i.recipeId ? { recipeId: i.recipeId } : { title: i.title }) }));
          }}
        />
      )}
      {shopping && start && <AddToListDialog title={weekLabel(start)} source={{ from: start, to: addDays(start, 6) }} onClose={() => setShopping(false)} />}
      {open && <EntryDialog e={open} settings={settings} onClose={() => setOpen(null)} onChanged={() => (setOpen(null), load())} />}
    </DndContext>
  );
}

function Cell({ date, slot, today: isToday, onAdd, children }: { date: string; slot: string; today: boolean; onAdd: () => void; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: cellId(date, slot), data: { date, slot } });
  return (
    <td ref={setNodeRef} className={`group h-24 border-b border-l border-line p-1.5 transition ${isOver ? "bg-active" : isToday ? "bg-pressed/50" : ""}`}>
      <div className="flex flex-col gap-1.5">
        {children}
        <button type="button" onClick={onAdd} aria-label="Add a meal" title="Add a meal" className="flex h-7 items-center justify-center rounded-lg text-muted opacity-0 transition hover:bg-pressed hover:text-action focus:opacity-100 group-hover:opacity-100">
          <PlusIcon className="size-4" />
        </button>
      </div>
    </td>
  );
}

function EntryCard({ e, index, onOpen, compact }: { e: PlanEntry; index: number; onOpen: () => void; compact?: boolean }) {
  const drag = useDraggable({ id: `entry|${e.id}`, data: { kind: "entry", id: e.id, title: e.title, imageUrl: e.imageUrl } });
  // dropping another dish on this one puts it here
  const drop = useDroppable({ id: `before|${e.id}`, data: { date: e.date, slot: e.slot, position: index } });
  return (
    <div ref={drop.setNodeRef} className={drop.isOver ? "border-t-2 border-action pt-1" : ""}>
      <button
        ref={drag.setNodeRef}
        type="button"
        {...drag.attributes}
        {...drag.listeners}
        onClick={onOpen}
        className={`flex w-full touch-manipulation items-center gap-2 rounded-xl border border-line bg-container p-1.5 text-left text-sm shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:border-action/50 ${drag.isDragging ? "opacity-40" : ""}`}
      >
        {e.recipeId ? <RecipeImage src={e.imageUrl} title={e.title} className={`${compact ? "size-9" : "size-8"} shrink-0 rounded-lg [&>svg]:size-4`} /> : <span className="size-2 shrink-0 rounded-full bg-strong" />}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 font-semibold leading-tight">{e.title}</span>
          {(e.servings || e.note) && <span className="block truncate text-xs text-muted">{[e.servings && `${e.servings} servings`, e.note].filter(Boolean).join(" · ")}</span>}
        </span>
      </button>
    </div>
  );
}

// Your recipes, to drag onto the week (wide screens)
function RecipePicker() {
  const [q, setQ] = useState("");
  const [list, setList] = useState<RecipeSummary[]>([]);
  useEffect(() => {
    const t = setTimeout(() => void api<{ recipes: RecipeSummary[] }>("GET", `/api/recipes?limit=40${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`).then((r) => setList(r.recipes)), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <aside aria-label="Recipes to plan" className="sticky top-4 hidden max-h-[calc(100vh-2rem)] w-72 shrink-0 flex-col rounded-2xl bg-container p-4 xl:flex">
      <h2 className="font-semibold">Drag a recipe onto a day</h2>
      <label className="relative mt-3 block">
        <span className="sr-only">Search recipes</span>
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipes" className="w-full rounded-lg border border-line bg-page py-2 pl-9 pr-3 outline-none focus:border-action" />
      </label>
      <ul className="mt-3 flex min-h-0 flex-col gap-1.5 overflow-y-auto">
        {list.map((r) => (
          <PickerItem key={r.id} r={r} />
        ))}
      </ul>
    </aside>
  );
}

function PickerItem({ r }: { r: RecipeSummary }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `recipe|${r.id}`, data: { kind: "recipe", id: r.id, title: r.title, imageUrl: r.imageUrl } });
  return (
    <li ref={setNodeRef} {...attributes} {...listeners} className={`flex cursor-grab items-center gap-2 rounded-xl p-1.5 hover:bg-pressed ${isDragging ? "opacity-40" : ""}`}>
      <RecipeImage src={r.imageUrl} title={r.title} className="size-10 shrink-0 rounded-lg [&>svg]:size-5" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-semibold leading-tight">{r.title}</span>
        {r.totalMinutes && <span className="text-xs text-muted">{formatMinutes(r.totalMinutes)}</span>}
      </span>
    </li>
  );
}

// + on a day: pick a recipe, or type what's for that meal
function AddDialog({ settings, at, onClose, onAdded }: { settings: PlannerSettings; at: { date: string; slot: string }; onClose: () => void; onAdded: () => void }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<RecipeSummary[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const t = setTimeout(() => void api<{ recipes: RecipeSummary[] }>("GET", `/api/recipes?limit=30${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`).then((r) => setList(r.recipes)), 150);
    return () => clearTimeout(t);
  }, [q]);
  const add = async (body: object) => {
    try {
      await api("POST", "/api/plan", { ...at, ...body });
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const slotName = settings.slots.find((s) => s.id === at.slot)?.name ?? at.slot;
  return (
    <Popup title={`${dayName(at.date, "long")} ${slotName}`} onClose={onClose}>
      <div className="flex flex-col gap-3 p-5">
        <label className="relative block">
          <span className="sr-only">Search your recipes</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your recipes" className="w-full rounded-lg border border-line bg-page py-2.5 pl-9 pr-3 outline-none focus:border-action" />
        </label>
        <ul className="flex max-h-72 flex-col overflow-y-auto">
          {list.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => void add({ recipeId: r.id })} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-pressed">
                <RecipeImage src={r.imageUrl} title={r.title} className="size-11 shrink-0 rounded-lg [&>svg]:size-5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.title}</span>
                  {r.totalMinutes && (
                    <span className="flex items-center gap-1 text-xs text-muted">
                      <ClockIcon className="size-3" /> {formatMinutes(r.totalMinutes)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="p-2 text-subtle">No recipes match.</li>}
        </ul>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (note.trim()) void add({ title: note.trim() });
          }}
          className="flex gap-2 border-t border-line pt-3"
        >
          <input aria-label="Or just a note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Or just a note: Leftovers, Eat out…" className="min-w-0 flex-1 rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action" />
          <button type="submit" disabled={!note.trim()} className="rounded-lg bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">
            Add
          </button>
        </form>
        {error && <p role="alert" className="text-error">{error}</p>}
      </div>
    </Popup>
  );
}

// Tap a planned dish: open it, cook it, change servings or the note, move it, or take it off
function EntryDialog({ e, settings, onClose, onChanged }: { e: PlanEntry; settings: PlannerSettings; onClose: () => void; onChanged: () => void }) {
  const [date, setDate] = useState(e.date);
  const [slot, setSlot] = useState(e.slot);
  const [servings, setServings] = useState(e.servings ?? e.recipeServings ?? null);
  const [note, setNote] = useState(e.note ?? "");
  const [error, setError] = useState("");
  const save = async () => {
    try {
      await api("PATCH", `/api/plan/${e.id}`, {
        ...(date !== e.date ? { date } : {}),
        ...(slot !== e.slot ? { slot } : {}),
        servings: servings && servings !== e.recipeServings ? servings : null,
        note: note.trim() || null,
      });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const remove = async () => {
    await api("DELETE", `/api/plan/${e.id}`);
    onChanged();
  };
  const field = "mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action";
  return (
    <Popup title={e.title} onClose={onClose}>
      <div className="flex flex-col gap-4 p-5">
        {e.recipeId && (
          <div className="flex gap-2">
            <a href={`#/recipes/${e.recipeId}`} className="flex-1 rounded-lg border border-line px-3 py-2 text-center font-semibold hover:bg-pressed">
              Open recipe
            </a>
            <a href={`#/recipes/${e.recipeId}/cook`} className="flex-1 rounded-lg bg-primary px-3 py-2 text-center font-semibold text-white">
              Start cooking
            </a>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-semibold text-subtle">
            Day
            <input type="date" value={date} onChange={(x) => setDate(x.target.value)} className={field} />
          </label>
          <label className="text-sm font-semibold text-subtle">
            Meal
            <select value={slot} onChange={(x) => setSlot(x.target.value)} className={field}>
              {settings.slots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {e.recipeId && (
            <label className="text-sm font-semibold text-subtle">
              Servings
              <input type="number" min={1} value={servings ?? ""} placeholder={e.recipeServings ? String(e.recipeServings) : "as written"} onChange={(x) => setServings(x.target.value ? Number(x.target.value) : null)} className={field} />
            </label>
          )}
          <label className={`text-sm font-semibold text-subtle ${e.recipeId ? "" : "col-span-2"}`}>
            Note
            <input value={note} onChange={(x) => setNote(x.target.value)} placeholder="Thaw the chicken…" className={field} />
          </label>
        </div>
        {error && <p role="alert" className="text-error">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => void save()} className="rounded-lg bg-primary px-5 py-2.5 font-semibold text-white">
            Save
          </button>
          <button type="button" onClick={() => void remove()} className="ml-auto rounded-lg px-3 py-2.5 font-semibold text-error hover:bg-error-subtle">
            Take off the plan
          </button>
        </div>
      </div>
    </Popup>
  );
}
