import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError, api, uploadPhoto } from "../../api";
import { ingredientsText, parseMinutes, parseServings, stepsText, type CollectionInfo, type Recipe, type TagInfo } from "../../recipes";
import { clearUnsaved, useUnsavedGuard } from "../../unsavedGuard";
import { BackIcon, CloseIcon } from "../Icons";
import { RecipeImage } from "./RecipeList";
import { VersionChoice } from "./SectionSave";

interface Form {
  title: string;
  description: string;
  imageUrl: string;
  sourceUrl: string;
  sourceName: string;
  servings: string;
  yieldText: string;
  prepMinutes: string;
  cookMinutes: string;
  totalMinutes: string;
  ingredients: string;
  steps: string;
  notes: string;
  tags: string[];
  categories: number[];
  collections: number[];
}

const empty: Form = { title: "", description: "", imageUrl: "", sourceUrl: "", sourceName: "", servings: "", yieldText: "", prepMinutes: "", cookMinutes: "", totalMinutes: "", ingredients: "", steps: "", notes: "", tags: [], categories: [], collections: [] };
const str = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const fromRecipe = (r: Recipe): Form => ({
  title: r.title,
  description: str(r.description),
  imageUrl: str(r.imageUrl),
  sourceUrl: str(r.sourceUrl),
  sourceName: str(r.sourceName),
  servings: str(r.servings),
  yieldText: str(r.yieldText),
  prepMinutes: str(r.prepMinutes),
  cookMinutes: str(r.cookMinutes),
  totalMinutes: str(r.totalMinutes),
  ingredients: ingredientsText(r.ingredients),
  steps: stepsText(r.steps),
  notes: str(r.notes),
  tags: r.tags,
  categories: r.categories.map((c) => c.id),
  collections: r.collections.map((c) => c.id),
});

// The parts of a recipe kept in its versions (tags, categories, collections, photo and source aren't)
const VERSIONED: (keyof Form)[] = ["title", "description", "servings", "yieldText", "prepMinutes", "cookMinutes", "totalMinutes", "ingredients", "steps", "notes"];

const field = "mt-1 w-full rounded-lg border border-line bg-page px-3 py-2.5 outline-none focus:border-action focus:ring-2 focus:ring-action/15";
const labelText = "text-sm font-semibold text-subtle";
const card = "rounded-2xl bg-container p-5 sm:p-6";

// A new recipe from a blocked import (#/recipes/new?source=<link>): the link is filled in
const startingForm = (): Form => {
  const source = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("source");
  return source && /^https?:\/\//.test(source) ? { ...empty, sourceUrl: source } : empty;
};

export default function RecipeEditor({ id }: { id?: number }) {
  const [form, setForm] = useState<Form | null>(id ? null : startingForm);
  const [start, setStart] = useState<Form>(empty);
  const [categories, setCategories] = useState<TagInfo[]>([]);
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [versioning, setVersioning] = useState(false);
  // Saving changes with versioning on: what to send while asking "current or new version?"
  const [asking, setAsking] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    // the choices are extras: a recipe can still be typed in without them
    void api<TagInfo[]>("GET", "/api/categories").then(setCategories).catch(() => {});
    void api<CollectionInfo[]>("GET", "/api/collections").then(setCollections).catch(() => {});
    void api<TagInfo[]>("GET", "/api/tags").then(setAllTags).catch(() => {});
    if (id)
      api<Recipe>("GET", `/api/recipes/${id}`)
        .then((r) => {
          const f = fromRecipe(r);
          setVersioning(!!r.versioning);
          setForm(f);
          setStart(f);
        })
        .catch((e) => setError((e as Error).message));
  }, [id]);

  const dirty = useMemo(() => !!form && JSON.stringify(form) !== JSON.stringify(start), [form, start]);
  useUnsavedGuard("recipe-editor", dirty, "this recipe");

  if (!form) return <Frame id={id}>{error ? <p role="alert" className="text-error">{error}</p> : null}</Frame>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  // "allrecipes.com/x" -> "https://allrecipes.com/x"
  const linkOf = (v: string) => {
    const t = v.trim();
    return t && !/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith("/") && !/\s/.test(t) && /^[\w-]+(\.[\w-]+)+([/:?#].*)?$/.test(t) ? `https://${t}` : t;
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setError("");
    // Numbers the way people write them ("1 hr 15 min", "2-3"); anything else is pointed out, not dropped
    const servings = parseServings(form.servings);
    const prep = parseMinutes(form.prepMinutes);
    const cook = parseMinutes(form.cookMinutes);
    const total = parseMinutes(form.totalMinutes);
    const bad: Record<string, string> = {};
    if (servings === undefined) bad.servings = "Servings should be a number. Put things like “2 loaves” in Makes.";
    if (prep === undefined) bad.prepMinutes = "Use minutes or a time like 1 hr 15 min";
    if (cook === undefined) bad.cookMinutes = "Use minutes or a time like 1 hr 15 min";
    if (total === undefined) bad.totalMinutes = "Use minutes or a time like 1 hr 15 min";
    if (Object.keys(bad).length) {
      setErrors(bad);
      setError("Check the highlighted fields.");
      return;
    }
    setBusy(true);
    const body = {
      title: form.title,
      description: form.description,
      imageUrl: linkOf(form.imageUrl),
      sourceUrl: linkOf(form.sourceUrl),
      sourceName: form.sourceName,
      servings,
      yieldText: form.yieldText,
      prepMinutes: prep,
      cookMinutes: cook,
      // blank total: worked out from prep + cook
      ...(form.totalMinutes.trim() || (!form.prepMinutes.trim() && !form.cookMinutes.trim()) ? { totalMinutes: total } : {}),
      ingredients: form.ingredients,
      steps: form.steps,
      notes: form.notes,
      tags: form.tags,
      categories: form.categories,
      collections: form.collections,
    };
    // An edit to what versions keep: ask whether it goes into the current version or a new one
    if (id && versioning && VERSIONED.some((k) => form[k] !== start[k])) {
      setBusy(false);
      setAsking(body);
      return;
    }
    await send(body);
  };

  const send = async (body: Record<string, unknown>, version?: "current" | "new") => {
    setBusy(true);
    setAsking(null);
    try {
      const r = await api<Recipe>(id ? "PATCH" : "POST", id ? `/api/recipes/${id}` : "/api/recipes", version ? { ...body, version } : body);
      setStart(form); // saved: leaving is fine now
      clearUnsaved("recipe-editor");
      window.location.hash = id ? `#/recipes/${r.id}` : `#/recipes/${r.id}?added=1`; // new: the page offers an AI check
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
        setError("Check the highlighted fields.");
      } else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (k: "categories" | "collections", v: number) => set(k, form[k].includes(v) ? form[k].filter((x) => x !== v) : [...form[k], v]);
  const Err = ({ k }: { k: string }) => (errors[k] ? <span className="mt-1 block text-sm text-error">{errors[k]}</span> : null);

  return (
    <Frame id={id}>
      {/* Enter in a one-line box (Name, Servings…) moves on instead of saving a half-typed recipe */}
      <form onSubmit={save} onKeyDown={(e) => e.key === "Enter" && e.target instanceof HTMLInputElement && e.preventDefault()} className="flex flex-col gap-4" noValidate>
        <section className={card}>
          <h1 className="text-2xl font-semibold">{id ? "Edit recipe" : "New recipe"}</h1>
          <label className="mt-4 block">
            <span className={labelText}>Name</span>
            <input aria-label="Name" maxLength={300} autoFocus={!id} value={form.title} onChange={(e) => set("title", e.target.value)} className={`${field} text-lg font-semibold`} placeholder="Weeknight Chili" />
            <Err k="title" />
          </label>
          <label className="mt-4 block">
            <span className={labelText}>Description</span>
            <textarea aria-label="Description" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} className={field} placeholder="A line or two about it" />
          </label>
          <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <label className="block">
              <span className={labelText}>Photo</span>
              <input aria-label="Photo address" value={form.imageUrl.startsWith("/api/photos/") ? "Uploaded photo" : form.imageUrl} readOnly={form.imageUrl.startsWith("/api/photos/")} onChange={(e) => set("imageUrl", e.target.value)} className={field} placeholder="Upload one, or paste a picture address (https://…)" inputMode="url" />
              <Err k="imageUrl" />
              <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-container px-3 py-2 text-sm font-semibold hover:bg-pressed">
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setError("");
                    try {
                      set("imageUrl", await uploadPhoto("/api/photos", file));
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                />
                Upload a photo
              </label>
              {form.imageUrl && (
                <button type="button" onClick={() => set("imageUrl", "")} className="ml-2 px-2 py-2 text-sm font-semibold text-error hover:underline">
                  Remove photo
                </button>
              )}
            </label>
            <RecipeImage src={form.imageUrl.trim() || null} title="" className="mt-6 hidden aspect-[4/3] w-full rounded-lg sm:flex" />
          </div>
        </section>

        <section className={card}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {(
              [
                ["servings", "Servings", "4"],
                ["yieldText", "Makes", "24 cookies"],
                ["prepMinutes", "Prep (min)", "15"],
                ["cookMinutes", "Cook (min)", "30"],
                ["totalMinutes", "Total (min)", "auto"],
              ] as const
            ).map(([k, label, ph]) => (
              <label key={k} className={k === "yieldText" ? "col-span-1" : ""}>
                <span className={labelText}>{label}</span>
                <input aria-label={label} value={form[k]} onChange={(e) => set(k, e.target.value)} className={field} placeholder={ph} inputMode={k === "yieldText" ? "text" : "numeric"} />
                <Err k={k} />
              </label>
            ))}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section className={card}>
            <label className="block">
              <span className="text-xl font-bold">Ingredients</span>
              <span className="mt-1 block text-sm text-subtle">One per line. A line ending in “:” is a heading (For the sauce:).</span>
              <textarea aria-label="Ingredients" rows={14} value={form.ingredients} onChange={(e) => set("ingredients", e.target.value)} className={`${field} font-mono text-sm leading-relaxed`} placeholder={"1 lb ground beef\n1 (15 oz) can kidney beans, drained\n2 tbsp chili powder"} />
            </label>
          </section>
          <section className={card}>
            <label className="block">
              <span className="text-xl font-bold">Steps</span>
              <span className="mt-1 block text-sm text-subtle">A blank line between steps (or one per line). Start a line with # for a heading.</span>
              <textarea aria-label="Steps" rows={14} value={form.steps} onChange={(e) => set("steps", e.target.value)} className={`${field} text-sm leading-relaxed`} placeholder={"Brown the beef in a large pot.\n\nAdd everything else and simmer for 30 minutes."} />
            </label>
          </section>
        </div>

        <section className={card}>
          <h2 className="text-xl font-bold">Organize</h2>
          <div className="mt-3">
            <span className={labelText}>Categories</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {categories.map((c) => (
                <Chip key={c.id} on={form.categories.includes(c.id)} onClick={() => toggle("categories", c.id)}>
                  {c.name}
                </Chip>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <span className={labelText}>Collections</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {collections.map((c) => (
                <Chip key={c.id} on={form.collections.includes(c.id)} onClick={() => toggle("collections", c.id)}>
                  {c.name}
                </Chip>
              ))}
              {collections.length === 0 && <span className="text-sm text-muted">None yet: add them in Settings › Recipes, or from a recipe's Collections button.</span>}
            </div>
          </div>
          <TagInput tags={form.tags} known={allTags.map((t) => t.name)} onChange={(tags) => set("tags", tags)} />
        </section>

        <section className={card}>
          <h2 className="text-xl font-bold">Source and notes</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label>
              <span className={labelText}>Where it's from (link)</span>
              <input aria-label="Source link" value={form.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} className={field} placeholder="https://…" inputMode="url" />
              <Err k="sourceUrl" />
            </label>
            <label>
              <span className={labelText}>Source name</span>
              <input aria-label="Source name" value={form.sourceName} onChange={(e) => set("sourceName", e.target.value)} className={field} placeholder="Grandma's card, Serious Eats…" />
            </label>
          </div>
          <label className="mt-4 block">
            <span className={labelText}>Notes (everyone sees these)</span>
            <textarea aria-label="Notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} className={field} />
          </label>
        </section>

        <div className="sticky bottom-14 z-10 -mx-3 flex flex-wrap items-center gap-3 border-t border-line bg-page/95 px-3 py-3 backdrop-blur sm:bottom-0 sm:mx-0 sm:rounded-2xl sm:border-0 sm:bg-container sm:px-6">
          <button type="submit" disabled={busy || !form.title.trim()} className="rounded bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-pressed disabled:opacity-60">
            {busy ? "Saving…" : id ? "Save changes" : "Save recipe"}
          </button>
          <a href={id ? `#/recipes/${id}` : "#/recipes"} className="px-2 py-2.5 font-semibold text-subtle hover:underline">
            Cancel
          </a>
          {error && <span role="alert" className="text-error">{error}</span>}
        </div>
      </form>
      {asking && <VersionChoice onCurrent={() => void send(asking, "current")} onNew={() => void send(asking, "new")} onCancel={() => setAsking(null)} />}
    </Frame>
  );
}

function Frame({ id, children }: { id?: number; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1100px] px-3 pb-16 pt-4 sm:px-6">
      <a href={id ? `#/recipes/${id}` : "#/recipes"} className="mb-3 inline-flex items-center gap-1.5 font-semibold text-subtle hover:text-ink">
        <BackIcon className="size-4" /> {id ? "Back to the recipe" : "Recipes"}
      </a>
      {children}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${on ? "border-action bg-action text-white" : "border-line bg-page text-subtle hover:border-strong hover:text-ink"}`}>
      {children}
    </button>
  );
}

// Type a tag and press Enter or comma; suggestions from tags already used
function TagInput({ tags, known, onChange }: { tags: string[]; known: string[]; onChange: (t: string[]) => void }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const t = raw.trim().toLowerCase().replace(/^#/, "");
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setText("");
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(text);
    } else if (e.key === "Backspace" && !text && tags.length) onChange(tags.slice(0, -1));
  };
  const suggestions = text.trim() ? known.filter((k) => k.startsWith(text.trim().toLowerCase()) && !tags.includes(k)).slice(0, 6) : [];
  return (
    <div className="mt-4">
      <label htmlFor="tag-input" className={labelText}>
        Tags
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-page px-2 py-1.5 focus-within:border-action focus-within:ring-2 focus-within:ring-action/15">
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-full bg-container px-2.5 py-1 text-sm">
            #{t}
            <button type="button" aria-label={`Remove tag ${t}`} title={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="text-muted hover:text-error">
              <CloseIcon className="size-3.5" />
            </button>
          </span>
        ))}
        <input id="tag-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={key} onBlur={() => text.trim() && add(text)} placeholder={tags.length ? "" : "weeknight, vegetarian…"} className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 outline-none" />
      </div>
      {suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)} className="rounded-full bg-pressed px-2.5 py-1 text-sm text-action">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
