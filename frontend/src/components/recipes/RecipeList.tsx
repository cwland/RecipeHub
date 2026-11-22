import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { formatMinutes, recipesChanged, rememberList, type CollectionInfo, type RecipeSummary, type TagInfo } from "../../recipes";
import { ChefIcon, ClockIcon, FilterIcon, GridViewIcon, ListViewIcon, PinIcon, PlusIcon, SearchIcon, StarIcon } from "../Icons";
import { gridClass, loadView, saveView, type RecipeView } from "./recipeView";
import { TilesAcross, tileButton } from "../TilesAcross";
import { Popup } from "../Popup";
import ImportDialog from "./ImportDialog";

// tag: every tag that's on (recipes must have all of them); "none" = recipes with no tags
type Filters = { q: string; tag: string[]; category: string; collection: string; favorite: string; sort: string };
// Open the import dialog from anywhere (the empty state, the menu)
export const openImport = () => window.dispatchEvent(new Event("recipehub:import"));
export { recipesChanged };
// After the setup wizard: Add recipe glows, with a tip, until it's clicked or the tip is closed
let hintPending = false;
export const hintAddRecipe = () => {
  hintPending = true;
  window.dispatchEvent(new Event("recipehub:hint-add"));
};
const KEYS = ["q", "category", "collection", "favorite", "sort"] as const;
const fromParams = (p: URLSearchParams): Filters => ({ ...(Object.fromEntries(KEYS.map((k) => [k, p.get(k) ?? ""])) as Omit<Filters, "tag">), tag: p.getAll("tag") });
const toParams = (f: Filters) => {
  const qs = new URLSearchParams(KEYS.filter((k) => f[k]).map((k) => [k, f[k]]));
  f.tag.forEach((t) => qs.append("tag", t));
  return qs;
};

const SORTS = [
  { id: "", label: "Recently changed" },
  { id: "newest", label: "Newest" },
  { id: "title", label: "A to Z" },
  { id: "rating", label: "Your rating" },
];

// The list as you left it: how far down it was scrolled (by its address) and the recipes it showed,
// so coming back from a recipe puts you where you were without waiting for the list to load again
type ListData = { total: number; recipes: RecipeSummary[] };
let keptScroll: { hash: string; y: number } | null = null;
let keptData: { query: string; data: ListData } | null = null;
const onList = () => window.location.hash === "" || window.location.hash === "#/" || (window.location.hash.startsWith("#/recipes") && !/^#\/recipes\/./.test(window.location.hash));
const listQuery = (f: Filters) => {
  const q = toParams(f);
  q.set("limit", "200");
  return q.toString();
};

// restore: you're coming back from a recipe (its page, editing or Cook mode), so go back to where the list was
export default function RecipeList({ params, restore }: { params: URLSearchParams; restore?: boolean }) {
  const [f, setF] = useState<Filters>(() => fromParams(params));
  const [search, setSearch] = useState(f.q);
  const [data, setData] = useState<ListData | null>(() => (restore && keptData?.query === listQuery(f) ? keptData.data : null));
  const [error, setError] = useState("");
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [categories, setCategories] = useState<TagInfo[]>([]);
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [noCategory, setNoCategory] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setViewState] = useState<RecipeView>(loadView);
  const setView = (v: RecipeView) => {
    setViewState(v);
    saveView(v);
  };
  // ?import=<link or text>: shared from another app (Android share sheet), or a bookmarklet
  const [importing, setImporting] = useState<{ initial?: string } | null>(() => (params.get("import") ? { initial: params.get("import")! } : null));
  useEffect(() => {
    const open = () => setImporting({});
    window.addEventListener("recipehub:import", open);
    return () => window.removeEventListener("recipehub:import", open);
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);
  // an import added recipes: load the list (and the sidebar's counts) again
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const again = () => setReload((n) => n + 1);
    window.addEventListener("recipehub:recipes-changed", again);
    return () => window.removeEventListener("recipehub:recipes-changed", again);
  }, []);
  const [hint, setHint] = useState(hintPending);
  useEffect(() => {
    const on = () => setHint(true);
    window.addEventListener("recipehub:hint-add", on);
    return () => window.removeEventListener("recipehub:hint-add", on);
  }, []);
  const endHint = () => {
    hintPending = false;
    setHint(false);
  };

  useEffect(() => {
    void Promise.all([api<TagInfo[]>("GET", "/api/tags"), api<TagInfo[]>("GET", "/api/categories"), api<CollectionInfo[]>("GET", "/api/collections")]).then(([t, c, col]) => {
      setTags(t);
      setCategories(c);
      setCollections(col);
    }).catch(() => {}); // the filters are extras: the recipes still list without them
    void api<{ total: number }>("GET", "/api/recipes?category=none&limit=1").then((d) => setNoCategory(d.total)).catch(() => {});
  }, [reload]);

  // The filters live in the address (#/recipes?tag=grill), so Back returns to the same list
  useEffect(() => {
    const qs = toParams(f).toString();
    const hash = `#/recipes${qs ? `?${qs}` : ""}`;
    // (only while still on the list, including RecipeHub opened at its plain address: never rewrite
    // the address of a page you're going to)
    if (onList()) {
      history.replaceState(null, "", hash);
      rememberList(hash);
    }
    const query = listQuery(f);
    let live = true;
    api<ListData>("GET", `/api/recipes?${query}`)
      .then((d) => {
        if (!live) return;
        setData(d);
        setError("");
        keptData = { query, data: d };
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [f, reload]);

  // Remember how far down the list is scrolled (only while the list is what's showing)
  useEffect(() => {
    const note = () => {
      if (onList()) keptScroll = { hash: window.location.hash, y: window.scrollY };
    };
    window.addEventListener("scroll", note, { passive: true });
    return () => window.removeEventListener("scroll", note);
  }, []);
  // Coming back from a recipe: once the recipes are showing, scroll to where you were (else the top)
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (placed.current || (restore && !data)) return;
    placed.current = true;
    const y = restore && keptScroll && keptScroll.hash === window.location.hash ? keptScroll.y : 0;
    window.scrollTo(0, y);
  }, [data, restore]);

  // Search as you type (a moment after you stop)
  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.q === search.trim() ? x : { ...x, q: search.trim() })), 250);
    return () => clearTimeout(t);
  }, [search]);

  // "/" jumps to the search box
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target as HTMLElement).closest("input, textarea, select")) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  // One place at a time (a collection, a category, or favorites); clicking the one you're in leaves it.
  // Tags narrow wherever you are, and stay on until you click them off (or All recipes).
  const browse = (change: Partial<Filters>) => {
    setF((x) => {
      const [key, value] = Object.entries(change)[0] ?? [];
      if (!key) return { ...x, tag: [], category: "", collection: "", favorite: "" };
      const leaving = x[key as keyof Filters] === value;
      return { ...x, category: "", collection: "", favorite: "", [key]: leaving ? "" : value };
    });
    setFiltersOpen(false);
  };
  const toggleTag = (name: string) =>
    setF((x) => {
      const on = x.tag.includes(name);
      // "No tags" and real tags can't both be on
      const others = x.tag.filter((t) => t !== name && (name === "none" ? false : t !== "none"));
      return { ...x, tag: on ? x.tag.filter((t) => t !== name) : [...others, name] };
    });
  const heading = useMemo(() => {
    if (f.favorite) return "Favorites";
    if (f.collection) return collections.find((c) => String(c.id) === f.collection)?.name ?? "Collection";
    if (f.category === "none") return "No category";
    if (f.category) return categories.find((c) => String(c.id) === f.category)?.name ?? "Category";
    if (f.tag.includes("none")) return "No tags";
    if (f.tag.length) return f.tag.map((t) => `#${t}`).join(" ");
    return "All recipes";
  }, [f, collections, categories]);
  const collection = f.collection ? collections.find((c) => String(c.id) === f.collection) : undefined;

  const sidebar = (
    <BrowseList
      f={f}
      browse={browse}
      toggleTag={toggleTag}
      noCategory={noCategory}
      tags={tags}
      categories={categories}
      collections={collections}
      onNewCollection={(c) => (setCollections((l) => [...l, c]), browse({ collection: String(c.id) }))}
    />
  );

  return (
    <div className="mx-auto flex max-w-[1240px] gap-8 px-3 pb-16 pt-4 sm:px-6">
      <aside aria-label="Browse recipes" className="sticky top-4 hidden max-h-[calc(100vh-2rem)] w-56 shrink-0 overflow-y-auto lg:block">
        {sidebar}
      </aside>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-2xl font-semibold">{heading}</h1>
          <div className="relative">
            <button type="button" data-hint={hint || undefined} onClick={() => (endHint(), setImporting({}))} className={`flex items-center gap-1.5 rounded bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-pressed ${hint ? "hint-glow" : ""}`}>
              <PlusIcon className="size-4" /> Add recipe
            </button>
            {hint && (
              <div role="status" aria-label="Tip" className="hint-pop absolute right-0 top-full z-30 mt-3 w-72 rounded-2xl bg-primary p-4 text-sm text-white shadow-[0_12px_32px_rgba(16,24,32,0.3)]">
                <span aria-hidden className="absolute -top-1.5 right-8 size-3 rotate-45 bg-primary" />
                <p>
                  <span aria-hidden>👆 </span>To import your first recipe by hand or from a link, click <strong>Add recipe</strong> any time.
                </p>
                <button type="button" onClick={endHint} className="mt-3 rounded-lg bg-white/15 px-3 py-1.5 font-semibold hover:bg-white/25">
                  Got it
                </button>
              </div>
            )}
          </div>
        </div>
        {collection?.description && <p className="mt-1 text-subtle">{collection.description}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 basis-64">
            <span className="sr-only">Search recipes</span>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search titles, ingredients, tags, notes…"
              className="w-full rounded-lg border border-line bg-container py-2.5 pl-9 pr-3 outline-none focus:border-action focus:ring-2 focus:ring-action/15"
            />
          </label>
          <button type="button" onClick={() => setFiltersOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-line bg-container px-3 py-2.5 text-sm font-semibold lg:hidden">
            <FilterIcon /> Browse
          </button>
          <select aria-label="Sort" value={f.sort} onChange={(e) => setF((x) => ({ ...x, sort: e.target.value }))} className="rounded-lg border border-line bg-container px-3 py-2.5 text-sm">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {f.q && !s.id ? "Best match" : s.label}
              </option>
            ))}
            {f.collection && <option value="collection">Collection order</option>}
          </select>
          <ViewControls view={view} onChange={setView} />
        </div>

        {error && <p role="alert" className="mt-4 rounded-lg bg-error-subtle px-4 py-3 text-error">{error}</p>}
        {data && (
          <p className="mt-3 text-sm text-subtle" aria-live="polite">
            {data.total} recipe{data.total === 1 ? "" : "s"}
            {f.q && <> for “{f.q}”</>}
            {data.total === 0 && f.q && (f.tag.length || f.category || f.collection || f.favorite) && (
              <>
                {" · "}
                <button type="button" onClick={() => browse({})} className="font-semibold text-action hover:underline">
                  Search all
                </button>
              </>
            )}
          </p>
        )}

        {data && data.recipes.length > 0 && (
          <ul
            aria-label="Recipes"
            data-view={view.mode}
            data-across={view.mode === "cards" ? view.across : undefined}
            className={view.mode === "list" ? "mt-3 flex flex-col gap-2" : `mt-3 grid gap-3 sm:gap-4 ${gridClass(view.across)}`}
          >
            {data.recipes.map((r) => (
              <li key={r.id}>{view.mode === "list" ? <RecipeRow r={r} /> : <RecipeCard r={r} />}</li>
            ))}
          </ul>
        )}
        {data && data.recipes.length === 0 && <Empty searching={!!(f.q || f.tag.length || f.category || f.collection || f.favorite)} />}
      </div>

      {importing && <ImportDialog initial={importing.initial} onClose={() => setImporting(null)} />}
      {filtersOpen && (
        <Popup title="Browse" onClose={() => setFiltersOpen(false)}>
          <div className="p-5">{sidebar}</div>
        </Popup>
      )}
    </div>
  );
}

// (defined out here: one made inside BrowseList would be new on every render, resetting what's in it)
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-5">
    <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
    <div className="mt-1 flex flex-col">{children}</div>
  </section>
);

function BrowseList({ f, browse, toggleTag, noCategory, tags, categories, collections, onNewCollection }: { f: Filters; browse: (c: Partial<Filters>) => void; toggleTag: (t: string) => void; noCategory: number; tags: TagInfo[]; categories: TagInfo[]; collections: CollectionInfo[]; onNewCollection: (c: CollectionInfo) => void }) {
  const item = (active: boolean) => `flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left ${active ? "bg-pressed font-semibold text-action" : "hover:bg-container"}`;
  const none = !f.tag.length && !f.category && !f.collection && !f.favorite;
  const topTags = [...tags].filter((t) => t.count).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 20);
  return (
    <nav className="text-[15px]">
      <button type="button" className={item(none)} onClick={() => browse({})}>
        All recipes
      </button>
      <button type="button" className={item(!!f.favorite)} onClick={() => browse({ favorite: "true" })}>
        <span className="flex items-center gap-2">
          <StarIcon filled className="size-4 text-warning" /> Favorites
        </span>
      </button>
      <Section title="Collections">
        {collections.map((c) => (
          <button key={c.id} type="button" className={item(f.collection === String(c.id))} onClick={() => browse({ collection: String(c.id) })}>
            <span className="truncate">{c.name}</span>
            <span className="text-xs text-muted">{c.count}</span>
          </button>
        ))}
        <NewCollection onCreated={onNewCollection} />
        {collections.length > 0 && (
          <a href="#/settings/recipes" className="px-3 py-1 text-sm text-subtle hover:text-link hover:underline">
            Manage collections…
          </a>
        )}
      </Section>
      <Section title="Categories">
        {categories.map((c) => (
          <button key={c.id} type="button" aria-pressed={f.category === String(c.id)} className={item(f.category === String(c.id))} onClick={() => browse({ category: String(c.id) })}>
            <span className="truncate">{c.name}</span>
            <span className="text-xs text-muted">{c.count}</span>
          </button>
        ))}
        {noCategory > 0 && (
          <button type="button" aria-pressed={f.category === "none"} className={item(f.category === "none")} onClick={() => browse({ category: "none" })}>
            <span className="truncate italic">No category</span>
            <span className="text-xs text-muted">{noCategory}</span>
          </button>
        )}
      </Section>
      {topTags.length > 0 && (
        <Section title="Tags">
          <div className="flex flex-wrap gap-1.5 px-2 pt-1">
            {[...topTags.map((t) => ({ key: String(t.id), name: t.name, label: t.name })), { key: "none", name: "none", label: "No tags" }].map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={f.tag.includes(t.name)}
                onClick={() => toggleTag(t.name)}
                className={`rounded-full px-2.5 py-1 text-sm ${f.tag.includes(t.name) ? "bg-action text-white" : "bg-container text-subtle hover:text-ink"} ${t.key === "none" ? "italic" : ""}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Section>
      )}
    </nav>
  );
}

// + New collection: a name box right in the sidebar (Enter adds it and opens it, Escape cancels)
function NewCollection({ onCreated }: { onCreated: (c: CollectionInfo) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => (setOpen(false), setName(""), setError(""));
  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const c = await api<CollectionInfo>("POST", "/api/collections", { name: name.trim() });
      close();
      onCreated(c);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="px-3 py-1.5 text-left text-sm font-semibold text-link hover:underline">
        + New collection
      </button>
    );
  return (
    <form
      onSubmit={(e) => (e.preventDefault(), void add())}
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), close())}
      className="flex flex-col gap-1.5 px-2 py-1.5"
    >
      <input
        autoFocus
        aria-label="New collection name"
        placeholder="Collection name"
        value={name}
        maxLength={100}
        onChange={(e) => (setName(e.target.value), setError(""))}
        className="w-full rounded-lg border border-line bg-container px-2.5 py-1.5 text-sm outline-none focus:border-action focus:ring-2 focus:ring-action/15"
      />
      <div className="flex items-center gap-2">
        <button type="submit" disabled={!name.trim() || busy} className="rounded-lg bg-primary px-3 py-1 text-sm font-semibold text-white hover:bg-primary-pressed disabled:opacity-50">
          {busy ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={close} className="text-sm font-semibold text-subtle hover:underline">
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
    </form>
  );
}

export function RecipeImage({ src, title, className = "" }: { src: string | null; title: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) return <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className={`object-cover ${className}`} />;
  return (
    <div aria-hidden className={`flex items-center justify-center bg-brand-subtle text-action/70 ${className}`}>
      <ChefIcon />
      <span className="sr-only">{title}</span>
    </div>
  );
}

function RecipeCard({ r }: { r: RecipeSummary }) {
  const time = formatMinutes(r.totalMinutes);
  return (
    <a href={`#/recipes/${r.id}`} className="group @container flex h-full flex-col overflow-hidden rounded-2xl bg-container shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.1)]">
      <div className="relative">
        <RecipeImage src={r.imageUrl} title={r.title} className="aspect-[4/3] w-full" />
        <div className="absolute right-2 top-2 flex gap-1">
          {r.pinned && (
            <span title="Pinned" className="rounded-full bg-container/90 p-1.5 text-action">
              <PinIcon filled className="size-3.5" />
            </span>
          )}
          {r.favorite && (
            <span title="Favorite" className="rounded-full bg-container/90 p-1.5 text-warning">
              <StarIcon filled className="size-3.5" />
            </span>
          )}
        </div>
      </div>
      <div className="p-2.5 @[12rem]:p-3 @[20rem]:p-4">
        {/* Every card the same size: the title always takes two lines, the details one.
            Text follows the tile's width, so small tiles don't cut it off. */}
        <h3 className="line-clamp-2 min-h-[2lh] text-sm font-semibold leading-snug group-hover:text-action @[12rem]:text-base @[20rem]:text-lg">{r.title}</h3>
        <p className="mt-1 flex min-h-[1lh] min-w-0 items-center gap-x-3 overflow-hidden whitespace-nowrap text-[11px] text-subtle @[12rem]:text-xs @[20rem]:text-sm">
          {time && (
            <span className="flex shrink-0 items-center gap-1">
              <ClockIcon className="size-3.5" /> {time}
            </span>
          )}
          {r.rating && <span aria-label={`Rated ${r.rating} of 5`}>{"★".repeat(r.rating)}</span>}
          {r.sourceName && <span className="min-w-0 truncate">{r.sourceName}</span>}
        </p>
      </div>
    </a>
  );
}

function ViewControls({ view, onChange }: { view: RecipeView; onChange: (v: RecipeView) => void }) {
  const btn = tileButton;
  const list = view.mode === "list";
  const label = list ? "Show as cards" : "Show as a list";
  return (
    <div className="flex items-center gap-1 rounded-lg border border-line bg-container p-1">
      {!list && (
        <>
          <TilesAcross across={view.across} onChange={(across) => onChange({ ...view, across })} />
          <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-line sm:block" />
        </>
      )}
      <button type="button" aria-label={label} title={label} onClick={() => onChange({ ...view, mode: list ? "cards" : "list" })} className={btn}>
        {list ? <GridViewIcon /> : <ListViewIcon />}
      </button>
    </div>
  );
}

function RecipeRow({ r }: { r: RecipeSummary }) {
  const time = formatMinutes(r.totalMinutes);
  return (
    <a href={`#/recipes/${r.id}`} className="group flex items-center gap-3 overflow-hidden rounded-xl bg-container p-2 pr-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
      <RecipeImage src={r.imageUrl} title={r.title} className="aspect-[4/3] w-20 shrink-0 rounded-lg sm:w-24" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-semibold group-hover:text-action">{r.title}</h3>
        <p className="mt-0.5 flex min-w-0 items-center gap-x-3 overflow-hidden whitespace-nowrap text-xs text-subtle">
          {time && (
            <span className="flex shrink-0 items-center gap-1">
              <ClockIcon className="size-3.5" /> {time}
            </span>
          )}
          {r.rating && <span aria-label={`Rated ${r.rating} of 5`}>{"★".repeat(r.rating)}</span>}
          {r.sourceName && <span className="min-w-0 truncate">{r.sourceName}</span>}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        {r.pinned && (
          <span title="Pinned" className="text-action">
            <PinIcon filled className="size-4" />
          </span>
        )}
        {r.favorite && (
          <span title="Favorite" className="text-warning">
            <StarIcon filled className="size-4" />
          </span>
        )}
      </div>
    </a>
  );
}

function Empty({ searching }: { searching: boolean }) {
  return (
    <section className="mt-6 flex flex-col items-center rounded-2xl bg-container px-6 py-14 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-brand-subtle text-action">
        <ChefIcon />
      </span>
      {searching ? (
        <p className="mt-4 text-lg">No recipes match. Try fewer words, or another collection or tag.</p>
      ) : (
        <>
          <p className="mt-4 text-lg">Your recipe box is empty.</p>
          <p className="mt-1 text-subtle">Add your first one from a link to any recipe site, by pasting it, or by typing it in.</p>
          <button type="button" onClick={openImport} className="mt-5 rounded bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-pressed">
            Add a recipe
          </button>
        </>
      )}
    </section>
  );
}
