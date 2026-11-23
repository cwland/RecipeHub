import { useContext, useEffect, useRef, useState, type FormEvent } from "react";
import { SessionContext } from "../../session";
import { api, uploadPhoto } from "../../api";
import { formatMinutes, ingredientOrder, ingredientsText, listAddress, parseMinutes, parseServings, siteName, stepsText, type Ingredient, type Mine, type Recipe, type Substitution } from "../../recipes";
import { BackIcon, Check, ChefIcon, GroceryIcon, PlannerIcon, ShareIcon, ClockIcon, EditIcon, LinkOutIcon, PinIcon, ServingsIcon, StarIcon, TagIcon, Trash, WandIcon } from "../Icons";
import { useAiStatus } from "../../ai";
import EnhanceWizard from "./EnhanceWizard";
import { OrganizeDialog } from "./OrganizeDialog";
import { SectionButtons, useSectionSave } from "./SectionSave";
import AddToPlanDialog from "../plan/AddToPlanDialog";
import { useLive } from "../../live";
import { Popup } from "../Popup";
import { RecipeImage } from "./RecipeList";
import AddToListDialog from "../grocery/AddToListDialog";
import { NutritionCard } from "./NutritionCard";
import { VersionHistory } from "./VersionHistory";
import ShareDialog from "./ShareDialog";
import { ScaleControls, useCookPrefs } from "./ScaleControls";
import { StepText } from "./StepText";
import { aiWeights, ingredientLine, recipeUnits, type Units } from "../../cooking";

const card = "rounded-2xl bg-container p-5 sm:p-6";
const inputClass = "mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 font-normal text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/15";

// ---------- editing in place ----------
type Section = "details" | "ingredients" | "steps" | "notes";
const str = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
// The text boxes for a section, filled from the recipe
function draftOf(r: Recipe, section: Section): Record<string, string> {
  if (section === "ingredients") return { ingredients: ingredientsText(r.ingredients) };
  if (section === "steps") return { steps: stepsText(r.steps) };
  if (section === "notes") return { notes: str(r.notes) };
  return { title: r.title, description: str(r.description), servings: str(r.servings), yieldText: str(r.yieldText), prepMinutes: str(r.prepMinutes), cookMinutes: str(r.cookMinutes), totalMinutes: str(r.totalMinutes), sourceName: str(r.sourceName), sourceUrl: str(r.sourceUrl) };
}
// What to send for a section (or what's wrong with it)
function bodyOf(section: Section, d: Record<string, string>): { body: Record<string, unknown> } | { errors: Record<string, string> } {
  if (section !== "details") return { body: { [section]: d[section] } };
  const errors: Record<string, string> = {};
  if (!d.title.trim()) errors.title = "Give the recipe a name";
  const servings = parseServings(d.servings);
  if (servings === undefined) errors.servings = "Servings should be a number. Put things like “2 loaves” in Makes.";
  const minutes = Object.fromEntries((["prepMinutes", "cookMinutes", "totalMinutes"] as const).map((k) => [k, parseMinutes(d[k])]));
  for (const [k, v] of Object.entries(minutes)) if (v === undefined) errors[k] = "Use minutes or a time like 1 hr 15 min";
  if (Object.keys(errors).length) return { errors };
  return { body: { title: d.title.trim(), description: d.description, servings, yieldText: d.yieldText, ...minutes, sourceName: d.sourceName, sourceUrl: d.sourceUrl } };
}

const iconButton = "flex size-9 shrink-0 items-center justify-center rounded-lg text-subtle hover:bg-pressed hover:text-ink";
const smallButton = "flex items-center gap-1.5 rounded-lg border border-line bg-container px-3 py-2 text-sm font-semibold hover:bg-pressed";

// startEditing: opened from an old "edit" link, so the details are ready to edit
// Imported from a web archive's saved copy (?copy=Wayback%20Machine&copied=2025-12-01): say so
function copyNote() {
  const q = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const from = q.get("copy");
  if (!from) return null;
  const day = q.get("copied");
  const when = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? ` (${new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })})` : "";
  return ` The site blocked the import, so this came from a saved copy on ${from === "Wayback Machine" ? "the Wayback Machine" : from}${when}. A saved copy can be older than the recipe on the site.`;
}

export default function RecipeView({ id, startEditing }: { id: number; startEditing?: boolean }) {
  const [r, setR] = useState<Recipe | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shopping, setShopping] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [sharing, setSharing] = useState(false);
  const prefs = useCookPrefs(id);
  const order = useContext(SessionContext)?.user.ingredientOrder ?? "entered";
  const ai = useAiStatus();
  // Just added (typed in or imported): offer an AI check once
  // Typed in: offer the AI check once. Imported: go straight into the review (when AI Enhance is on).
  const [offer, setOffer] = useState(() => /[?&]added=/.test(window.location.hash));
  const [reviewImport, setReviewImport] = useState(() => /[?&]imported=/.test(window.location.hash));
  const [enhancing, setEnhancing] = useState(false);
  useEffect(() => {
    if (reviewImport && ai.enhance) {
      setReviewImport(false);
      setEnhancing(true);
    }
  }, [reviewImport, ai.enhance]);
  const [organizing, setOrganizing] = useState(false);
  // Editing in place: one section at a time, with its text while it's being edited
  const [editing, setEditing] = useState<Section | null>(startEditing ? "details" : null);
  // "Recipe added" / "Recipe updated" at the top for a moment, after the AI wizard
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 3500);
    return () => clearTimeout(t);
  }, [done]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  // Clicking elsewhere on the page (not a button, link or field) closes the section being edited;
  // with changes made, it asks first
  const [askDiscard, setAskDiscard] = useState(false);
  const dirty = useRef(false);
  const stopRef = useRef(() => {});
  dirty.current = !!editing && !!r && JSON.stringify(draft) !== JSON.stringify(draftOf(r, editing));
  useEffect(() => {
    if (!editing) return;
    const away = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el || el.closest("form, button, a, input, textarea, select, label, [role=dialog], [role=radio], [role=button]")) return;
      if (dirty.current) setAskDiscard(true);
      else stopRef.current();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const saver = useSectionSave(r, (updated) => setR(updated));
  const [tab, setTab] = useState<"recipe" | "nutrition" | "history">("recipe");

  useEffect(() => {
    setR(null);
    api<Recipe>("GET", `/api/recipes/${id}`)
      .then(setR)
      .catch((e) => setError((e as Error).message));
  }, [id]);
  // Auto nutrition finished for this recipe (here or on another device): show the new numbers
  useLive(["recipes"], (e) => {
    if (e.id === id) void api<Recipe>("GET", `/api/recipes/${id}`).then((fresh) => setR((x) => (x ? { ...x, nutrition: fresh.nutrition, nutritionUpdating: fresh.nutritionUpdating } : fresh)));
  });

  if (error) return <Shell><p role="alert" className="rounded-lg bg-error-subtle px-4 py-3 text-error">{error}</p></Shell>;
  if (!r) return <Shell />;
  const weights = aiWeights(r.nutrition);

  const setMine = async (change: Partial<Mine>) => {
    setR((x) => (x ? { ...x, me: { ...x.me, ...change } } : x)); // right away; the server confirms
    try {
      const me = await api<Mine>("PUT", `/api/recipes/${r.id}/me`, change);
      setR((x) => (x ? { ...x, me } : x));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  // The AI check offer was turned down, or the check closed with nothing applied: with Auto
  // nutrition on, the server works nutrition out now instead (it waited so AI wasn't asked twice)
  const skipAiCheck = () => {
    void api("POST", `/api/recipes/${r.id}/enhance/skip`)
      .then(() => api<Recipe>("GET", `/api/recipes/${r.id}`))
      .then((fresh) => setR((x) => (x ? { ...x, nutrition: fresh.nutrition, nutritionUpdating: fresh.nutritionUpdating } : x)))
      .catch(() => {});
  };
  const remove = async () => {
    await api("DELETE", `/api/recipes/${r.id}`);
    // Back to the list as you left it (the category, search or tags you were in)
    window.location.hash = listAddress();
  };

  const startEdit = (section: Section) => {
    saver.clear();
    setDraftErrors({});
    setDraft(draftOf(r, section));
    setEditing(section);
  };
  const stopEdit = () => {
    saver.clear();
    setDraftErrors({});
    setEditing(null);
  };
  stopRef.current = stopEdit;
  // Save the section being edited (nothing changed: just close it)
  const saveSection = (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const out = bodyOf(editing, draft);
    if ("errors" in out) return setDraftErrors(out.errors);
    setDraftErrors({});
    const before = bodyOf(editing, draftOf(r, editing));
    if (!("errors" in before) && JSON.stringify(before.body) === JSON.stringify(out.body)) return stopEdit();
    saver.save(out.body, () => setEditing(null));
  };
  const field = (key: string, label: string, opts: { area?: boolean; rows?: number; hint?: string } = {}) => (
    <label className="block">
      <span className="text-sm font-semibold text-subtle">{label}</span>
      {opts.area ? (
        <textarea aria-label={label} rows={opts.rows ?? 4} value={draft[key] ?? ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className={inputClass} />
      ) : (
        <input aria-label={label} value={draft[key] ?? ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className={inputClass} />
      )}
      {(draftErrors[key] || saver.fieldErrors[key]) && <span className="mt-1 block text-sm text-error">{draftErrors[key] || saver.fieldErrors[key]}</span>}
      {opts.hint && <span className="mt-1 block text-xs text-muted">{opts.hint}</span>}
    </label>
  );
  const pencil = (section: Section, label: string) => (
    <button type="button" aria-label={label} title={label} onClick={() => startEdit(section)} className={iconButton}>
      <EditIcon />
    </button>
  );

  const times = [
    ["Prep", r.prepMinutes],
    ["Cook", r.cookMinutes],
    ["Total", r.totalMinutes],
  ].filter(([, m]) => m) as [string, number][];
  const source = r.sourceName || siteName(r.sourceUrl);

  const imported = /[?&]imported=/.test(window.location.hash);
  return (
    <Shell>
      {imported && (
        <p role="status" className="mb-3 rounded-lg bg-success-subtle px-4 py-3 text-success">
          Imported. Give it a quick look, and use the pencils to fix anything that came through wrong.
          {/[?&]imported=warn/.test(window.location.hash) && " The photo couldn't be saved here, so it's shown from the site."}
          {copyNote()}
        </p>
      )}
      {ai.enhance && offer && (
        <section aria-label="AI check offer" className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-brand-subtle px-4 py-3">
          <WandIcon className="size-5 shrink-0 text-action" />
          <p className="min-w-0 flex-1">Check this recipe with AI? It can fill gaps in the steps, catch ingredient mistakes, estimate nutrition and suggest categories and tags.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOffer(false);
                skipAiCheck();
              }}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-subtle hover:underline"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={() => {
                setOffer(false);
                setEnhancing(true);
              }}
              className="rounded-lg bg-action px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Check with AI
            </button>
          </div>
        </section>
      )}
      {/* Header: photo, name, the facts, and what you can do with it */}
      <section aria-label="Recipe" className="overflow-hidden rounded-2xl bg-container md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <PhotoSlot recipe={r} onChange={(imageUrl) => setR({ ...r, imageUrl })} />
        <div className="flex flex-col p-5 sm:p-7 md:pt-5">
          {/* The categories on the left; Start cooking, Share and Delete on the right */}
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-semibold uppercase tracking-wide text-action">{!editing && r.categories.map((c) => c.name).join(" · ")}</p>
            <div className="flex shrink-0 items-center gap-1">
              {r.steps.length > 0 && (
                <a href={`#/recipes/${r.id}/cook`} className="mr-1 flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-pressed">
                  <ChefIcon className="size-4" /> Start cooking
                </a>
              )}
              <button type="button" aria-label="Share" title="Share" onClick={() => setSharing(true)} className={iconButton}>
                <ShareIcon />
              </button>
              <button type="button" aria-label="Delete recipe" title="Delete recipe" onClick={() => setConfirmDelete(true)} className={`${iconButton} hover:bg-error-subtle hover:text-error`}>
                <Trash />
              </button>
            </div>
          </div>
          <div className="mt-1 flex items-start gap-2">
            <h1 className="text-3xl font-bold leading-tight tracking-tight">{r.title}</h1>
            <div className="mt-1 flex shrink-0 items-center">
              {editing !== "details" && pencil("details", "Edit details")}
              <button type="button" aria-pressed={r.me.favorite} aria-label={r.me.favorite ? "Favorite" : "Add to favorites"} title={r.me.favorite ? "Favorite (click to remove)" : "Add to favorites"} onClick={() => void setMine({ favorite: !r.me.favorite })} className={`${iconButton} ${r.me.favorite ? "text-warning" : ""}`}>
                <StarIcon filled={r.me.favorite} className="size-5" />
              </button>
              <button type="button" aria-pressed={r.me.pinned} aria-label={r.me.pinned ? "Pinned" : "Pin to top"} title={r.me.pinned ? "Pinned to the top (click to unpin)" : "Pin to top"} onClick={() => void setMine({ pinned: !r.me.pinned })} className={`${iconButton} ${r.me.pinned ? "text-action" : ""}`}>
                <PinIcon filled={r.me.pinned} className="size-5" />
              </button>
            </div>
          </div>
          {editing === "details" ? (
            <form aria-label="Recipe details" onSubmit={saveSection} className="mt-3 flex flex-col gap-3">
              {field("title", "Name")}
              {field("description", "Description", { area: true, rows: 3 })}
              <div className="grid grid-cols-2 gap-3">
                {field("servings", "Servings")}
                {field("yieldText", "Makes", { hint: "Like “24 cookies” or “2 loaves”" })}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {field("prepMinutes", "Prep time")}
                {field("cookMinutes", "Cook time")}
                {field("totalMinutes", "Total time")}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {field("sourceName", "Source")}
                {field("sourceUrl", "Link to the original")}
              </div>
              <Stars value={r.me.rating} onChange={(rating) => void setMine({ rating })} />
              <SectionButtons busy={saver.busy} error={saver.error} onCancel={stopEdit} />
            </form>
          ) : (
            <>
            {r.description && <p className="mt-3 text-subtle">{r.description}</p>}

            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {times.map(([label, m]) => (
                <span key={label} className="flex items-center gap-1.5">
                  <ClockIcon className="size-4 text-muted" />
                  <span className="text-subtle">{label}</span> <strong>{formatMinutes(m)}</strong>
                </span>
              ))}
              {(r.servings || r.yieldText) && (
                <span className="flex items-center gap-1.5">
                  <ServingsIcon className="size-4 text-muted" />
                  <strong>{r.yieldText || `${r.servings} servings`}</strong>
                </span>
              )}
            </div>
            {source && (
              <p className="mt-3 text-sm text-subtle">
                From{" "}
                {r.sourceUrl ? (
                  <a href={r.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-semibold text-link hover:underline">
                    {source} <LinkOutIcon className="size-3.5" />
                  </a>
                ) : (
                  <strong>{source}</strong>
                )}
              </p>
            )}
            </>
          )}

          {editing !== "details" && (
            <div className="mt-4 flex items-center gap-3">
              <Stars value={r.me.rating} onChange={(rating) => void setMine({ rating })} />
            </div>
          )}

          {/* What you can do with it (hidden while a part is being edited) */}
          {!editing && (
          <div role="group" aria-label="Recipe actions" className="flex flex-wrap gap-2 pt-5">
            {r.ingredients.length > 0 && (
              <button type="button" onClick={() => setShopping(true)} className={smallButton}>
                <GroceryIcon className="size-4" /> Add to grocery list
              </button>
            )}
            <button type="button" onClick={() => setPlanning(true)} className={smallButton}>
              <PlannerIcon className="size-4" /> Add to meal plan
            </button>
            <button type="button" onClick={() => setOrganizing(true)} className={smallButton}>
              <TagIcon /> Organize
            </button>
            {ai.enhance && (
              <button type="button" onClick={() => setEnhancing(true)} className={smallButton}>
                <WandIcon /> Improve with AI
              </button>
            )}
          </div>
          )}
          {!editing && (r.tags.length > 0 || r.collections.length > 0) && (
            <ul aria-label="Tags and collections" className="flex flex-wrap gap-2 pt-3">
              {r.collections.map((c) => (
                <li key={`c${c.id}`}>
                  <a href={`#/recipes?collection=${c.id}`} className="block rounded-full bg-brand-subtle px-3 py-1 text-sm font-semibold text-action hover:underline">
                    {c.name}
                  </a>
                </li>
              ))}
              {r.tags.map((t) => (
                <li key={t}>
                  <a href={`#/recipes?tag=${encodeURIComponent(t)}`} className="block rounded-full bg-page px-3 py-1 text-sm text-subtle hover:text-ink">
                    #{t}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>


      {/* Tabs: the recipe itself, its nutrition, and its versions (when versioning is on) */}
      <div role="tablist" aria-label="Recipe sections" className="mt-4 flex gap-1 overflow-x-auto rounded-xl bg-container p-1">
        {(
          [
            ["recipe", "Active recipe"],
            ["nutrition", "Nutrition"],
            ...(r.versioning ? [["history", "Version history"]] : []),
          ] as [typeof tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            onClick={() => setTab(key)}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold ${tab === key ? "bg-action text-white" : "text-subtle hover:bg-pressed hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "recipe" && (
        <div role="tabpanel" id="panel-recipe" aria-labelledby="tab-recipe">
          {/* Two columns that each stack on their own (left: ingredients, notes, my notes; right:
              steps, substitutions), so a short ingredient list doesn't leave the notes far below.
              On phones the columns dissolve into one, in reading order. */}
          <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="contents lg:flex lg:flex-col lg:gap-4">
            <section aria-label="Ingredients" className={`${card} order-1 lg:order-none`}>
              <div className="flex items-center gap-1">
                <h2 className="text-xl font-bold">Ingredients</h2>
                {editing !== "ingredients" && pencil("ingredients", "Edit ingredients")}
              </div>
              {editing === "ingredients" ? (
                <form onSubmit={saveSection} className="mt-3">
                  {field("ingredients", "Ingredients", { area: true, rows: Math.max(8, (draft.ingredients ?? "").split("\n").length + 1), hint: "One per line. A line ending in “:” is a heading (“For the sauce:”)." })}
                  <SectionButtons busy={saver.busy} error={saver.error} onCancel={stopEdit} />
                </form>
              ) : (
                <>
                {r.ingredients.some((i) => i.quantity || i.unit) && (
                  <div className="mt-3">
                    <ScaleControls servings={r.servings} factor={prefs.factor} setFactor={prefs.setFactor} units={prefs.units} setUnits={prefs.setUnits} leans={recipeUnits(r.ingredients)} />
                  </div>
                )}
                {r.ingredients.length ? (
                  <ul className="mt-3">
                    {ingredientOrder(r.ingredients, order).map((n) => r.ingredients[n]).map((i, k) =>
                      i.section ? (
                        <li key={k} className="mt-4 pb-1 text-sm font-semibold uppercase tracking-wide text-muted first:mt-0">
                          {i.section}
                        </li>
                      ) : (
                        <li key={k} className="border-b border-line py-2 last:border-0">
                          <IngredientLine i={i} factor={prefs.factor} units={prefs.units} aiGrams={weights.get(i.raw.trim().toLowerCase())} />
                        </li>
                      )
                    )}
                  </ul>
                ) : (
                  <p className="mt-2 text-subtle">No ingredients yet.</p>
                )}
                </>
              )}
            </section>

            <section aria-label="Recipe notes" className={`${card} order-3 lg:order-none`}>
              <div className="flex items-center gap-1">
                <h2 className="text-xl font-bold">Notes</h2>
                {editing !== "notes" && pencil("notes", "Edit notes")}
              </div>
              {editing === "notes" ? (
                <form onSubmit={saveSection} className="mt-3">
                  {field("notes", "Notes", { area: true, rows: 5, hint: "Everyone in your household sees these." })}
                  <SectionButtons busy={saver.busy} error={saver.error} onCancel={stopEdit} />
                </form>
              ) : r.notes ? (
                <p className="mt-2 whitespace-pre-line">{r.notes}</p>
              ) : (
                <p className="mt-2 text-subtle">No notes yet.</p>
              )}
            </section>
            <MyNotes value={r.me.notes} onSave={(notes) => setMine({ notes })} className="order-4 lg:order-none" />
            </div>
            <div className="contents lg:flex lg:flex-col lg:gap-4">
            <section aria-label="Steps" className={`${card} order-2 lg:order-none`}>
              <div className="flex items-center gap-1">
                <h2 className="text-xl font-bold">Steps</h2>
                {editing !== "steps" && pencil("steps", "Edit steps")}
              </div>
              {editing === "steps" ? (
                <form onSubmit={saveSection} className="mt-3">
                  {field("steps", "Steps", { area: true, rows: 14, hint: "A blank line between steps. A line starting with “# ” is a heading." })}
                  <SectionButtons busy={saver.busy} error={saver.error} onCancel={stopEdit} />
                </form>
              ) : r.steps.length ? (
                <Steps steps={r.steps} units={prefs.units} factor={prefs.factor} recipe={r} />
              ) : (
                <p className="mt-2 text-subtle">No steps yet.</p>
              )}
            </section>
            <Substitutions recipeId={r.id} ingredients={r.ingredients} list={r.substitutions} onChange={(substitutions) => setR({ ...r, substitutions })} onApplied={setR} className="order-5 lg:order-none" />
            </div>
          </div>

        </div>
      )}
      {tab === "nutrition" && (
        <div role="tabpanel" id="panel-nutrition" aria-labelledby="tab-nutrition" className="mt-4">
          <NutritionCard recipeId={r.id} servings={r.servings} yieldText={r.yieldText} value={r.nutrition} updating={r.nutritionUpdating} onChange={(nutrition) => setR((x) => x && { ...x, nutrition })} onRecipe={setR} />
        </div>
      )}
      {tab === "history" && r.versioning && (
        <div role="tabpanel" id="panel-history" aria-labelledby="tab-history" className="mt-4">
          <VersionHistory recipeId={r.id} reloadKey={r.updatedAt} onActivated={setR} />
        </div>
      )}

      {enhancing && (
        <EnhanceWizard
          recipe={r}
          onClose={() => {
            setEnhancing(false);
            skipAiCheck();
          }}
          onApplied={(updated) => {
            setR(updated);
            setEnhancing(false);
            setDone(imported ? "Recipe added" : "Recipe updated");
          }}
          onChanged={setR}
          onFinished={() => {
            setEnhancing(false);
            skipAiCheck();
            if (imported) setDone("Recipe added");
          }}
        />
      )}
      {done && (
        <div role="status" aria-label="Done" className="fixed inset-x-0 top-4 z-[70] mx-auto flex w-fit items-center gap-2 rounded-full bg-ink px-5 py-2.5 font-semibold text-white shadow-lg">
          <Check className="size-4" /> {done}
        </div>
      )}
      {askDiscard && (
        <Popup title="Discard changes?" onClose={() => setAskDiscard(false)}>
          <div className="flex flex-col gap-4 p-5">
            <p>You changed this part of the recipe. Discard the changes?</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => (setAskDiscard(false), stopEdit())} className="rounded-lg bg-error px-4 py-2 font-semibold text-white hover:opacity-90">
                Discard
              </button>
              <button type="button" onClick={() => setAskDiscard(false)} className="rounded-lg border border-line px-4 py-2 font-semibold hover:bg-pressed">
                Keep editing
              </button>
            </div>
          </div>
        </Popup>
      )}
      {sharing && <ShareDialog recipe={r} onClose={() => setSharing(false)} />}
      {shopping && <AddToListDialog title={r.title} source={{ recipes: [{ recipeId: r.id, ...(r.servings ? { servings: Math.round(r.servings * prefs.factor * 100) / 100 } : prefs.factor !== 1 ? { scale: prefs.factor } : {}) }] }} onClose={() => setShopping(false)} />}
      {planning && <AddToPlanDialog recipeId={r.id} servings={plannedServings(r.servings, prefs.factor)} onClose={() => setPlanning(false)} />}
      {saver.askPopup}
      {organizing && <OrganizeDialog recipe={r} onClose={() => setOrganizing(false)} onSaved={(updated) => setR(updated)} />}
      {confirmDelete && (
        <Popup title="Delete this recipe?" onClose={() => setConfirmDelete(false)}>
          <div className="p-6">
            <p>
              <strong>{r.title}</strong> will be deleted for everyone in your household, with its notes, ratings and substitutions. This can't be undone (a backup can bring it back).
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmDelete(false)} className="px-3 py-2.5 font-semibold text-subtle hover:underline">
                Cancel
              </button>
              <button type="button" onClick={() => void remove()} className="rounded bg-error px-4 py-2.5 font-semibold text-white">
                Delete recipe
              </button>
            </div>
          </div>
        </Popup>
      )}
    </Shell>
  );
}

// The recipe's photo; click (or drop a file) to add or change it
function PhotoSlot({ recipe, onChange }: { recipe: Recipe; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onChange(await uploadPhoto(`/api/recipes/${recipe.id}/photo`, file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <label
      // Every recipe photo is the same 4:3 box, cropped to fill (uploads come in all shapes)
      className="group relative block aspect-[4/3] cursor-pointer overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void send(e.dataTransfer.files[0]);
      }}
    >
      <RecipeImage src={recipe.imageUrl} title={recipe.title} className="absolute inset-0 h-full w-full" />
      <input type="file" accept="image/*" className="sr-only" aria-label={recipe.imageUrl ? "Change photo" : "Add a photo"} onChange={(e) => void send(e.target.files?.[0])} />
      <span className={`absolute bottom-3 left-3 rounded-full bg-container/90 px-3 py-1.5 text-sm font-semibold shadow transition ${recipe.imageUrl && !busy ? "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" : ""}`}>
        {busy ? "Uploading…" : recipe.imageUrl ? "Change photo" : "Add a photo"}
      </span>
      {error && <span role="alert" className="absolute inset-x-3 top-3 rounded bg-error-subtle px-3 py-2 text-sm text-error">{error}</span>}
    </label>
  );
}

function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1100px] px-3 pb-16 pt-4 sm:px-6">
      <a href={listAddress()} className="mb-3 inline-flex items-center gap-1.5 font-semibold text-subtle hover:text-ink">
        <BackIcon className="size-4" /> Recipes
      </a>
      {children}
    </div>
  );
}

// "1½ cups flour, sifted": the amount in bold, at this scale and in these units
export function IngredientLine({ i, factor = 1, units = "original", aiGrams }: { i: Ingredient; factor?: number; units?: Units; aiGrams?: number }) {
  const line = ingredientLine(i, factor, units, aiGrams);
  if (line.plain) return <span>{line.name}</span>;
  return (
    <span>
      <strong className="font-semibold">{line.amount}</strong> {line.name}
      {line.note && <span className="text-subtle">, {line.note}</span>}
      {line.dried && <span className="text-subtle"> ({line.dried})</span>}
      {line.was && <span className="text-subtle" title={line.estimate === "ai" ? "Weight estimated by AI (with the nutrition)" : "Approximate weight"}> ({line.was})</span>}
    </span>
  );
}

function Steps({ steps, units, factor, recipe }: { steps: Recipe["steps"]; units: Units; factor: number; recipe: Recipe }) {
  let n = 0;
  return (
    <ol className="mt-3 flex flex-col gap-4">
      {steps.map((s, i) => {
        if (s.section)
          return (
            <li key={i} className="mt-2 text-sm font-semibold uppercase tracking-wide text-muted">
              {s.section}
            </li>
          );
        const num = ++n;
        return (
          <li key={i} className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-sm font-bold text-action">{num}</span>
            <p className="pt-0.5 leading-relaxed">
              <StepText text={s.text} units={units} recipe={recipe} stepNumber={num} scaling={{ ingredients: recipe.ingredients, factor }} />
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function Stars({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  return (
    <div role="radiogroup" aria-label="Your rating" className="flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`} title={`${n} star${n === 1 ? "" : "s"}`}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(value === n ? null : n)}
          className={`p-0.5 ${n <= shown ? "text-warning" : "text-strong"}`}
        >
          <StarIcon filled={n <= shown} className="size-6" />
        </button>
      ))}
      <span className="ml-2 text-sm text-subtle">{value ? "Your rating" : "Rate it"}</span>
    </div>
  );
}

function MyNotes({ value, onSave, className = "" }: { value: string | null; onSave: (v: string | null) => Promise<void>; className?: string }) {
  const [text, setText] = useState(value ?? "");
  const [saved, setSaved] = useState(false);
  const dirty = text.trim() !== (value ?? "");
  const save = async () => {
    if (!dirty) return;
    await onSave(text.trim() || null);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <section aria-label="My notes" className={`${card} ${className}`}>
      <h2 className="flex items-baseline gap-2 text-xl font-bold">
        My notes <span className="text-sm font-normal text-muted">only you see these</span>
      </h2>
      <textarea
        aria-label="My notes"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
        rows={4}
        placeholder="What you'd change next time…"
        className="mt-3 w-full rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action focus:ring-2 focus:ring-action/15"
      />
      <p className="h-5 text-sm text-success" role="status">
        {saved && "Saved"}
      </p>
    </section>
  );
}

// What you can use instead: an amount and a unit (both optional) and the item
const AMOUNTS = [["1/8", "⅛"], ["1/4", "¼"], ["1/3", "⅓"], ["1/2", "½"], ["2/3", "⅔"], ["3/4", "¾"], ["1", "1"], ["1 1/4", "1¼"], ["1 1/3", "1⅓"], ["1 1/2", "1½"], ["1 3/4", "1¾"], ["2", "2"], ["2 1/2", "2½"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"], ["8", "8"], ["10", "10"], ["12", "12"], ["16", "16"]];
const UNITS = ["tsp", "tbsp", "cup", "fl oz", "ml", "l", "g", "kg", "oz", "lb", "pinch", "dash", "clove", "can", "piece", "slice", "stick", "bunch", "handful"];
const pretty = (s: string) => AMOUNTS.reduce((t, [v, f]) => (v.includes("/") ? t.replace(new RegExp(`(^|\\s)${v.replace(/ /g, " ")}(?=\\s|$)`), `$1${f}`) : t), s);

// Substitutions: a swap (instead of an ingredient picked from this recipe, or of anything typed)
// or an item added, then Make a new version puts the ticked ones into the recipe's ingredients
function Substitutions({ recipeId, ingredients, list, onChange, onApplied, className = "" }: { recipeId: number; ingredients: Ingredient[]; list: Substitution[]; onChange: (l: Substitution[]) => void; onApplied: (r: Recipe) => void; className?: string }) {
  const [kind, setKind] = useState<"swap" | "add">("swap");
  const [original, setOriginal] = useState("");
  const [line, setLine] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("");
  const [item, setItem] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const can = (s: Substitution) => s.appliedVersion === null && (s.kind === "add" || !!s.line);
  const [off, setOff] = useState<Set<number>>(new Set()); // unticked
  const q = original.trim().toLowerCase();
  const lines = ingredients.filter((i) => !i.section).map((i) => i.raw);
  const matches = q && !line ? [...new Set(lines.filter((l) => l.toLowerCase().includes(q)))].slice(0, 8) : [];
  const clear = () => (setOriginal(""), setLine(null), setAmount(""), setUnit(""), setItem(""), setNote(""));
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setMsg("");
    try {
      const body = kind === "swap" ? { kind, line, original: line ? null : original.trim(), amount: amount || null, unit: unit || null, item: item.trim(), note: note.trim() || null } : { kind, amount: amount || null, unit: unit || null, item: item.trim(), note: note.trim() || null };
      const s = await api<Substitution>("POST", `/api/recipes/${recipeId}/substitutions`, body);
      onChange([s, ...list]);
      clear();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const remove = async (id: number) => {
    await api("DELETE", `/api/substitutions/${id}`);
    onChange(list.filter((s) => s.id !== id));
  };
  const ticked = list.filter((s) => can(s) && !off.has(s.id));
  const apply = async () => {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const r = await api<{ version: number | null; applied: number; missing: string[]; recipe: Recipe }>("POST", `/api/recipes/${recipeId}/substitutions/apply`, { ids: ticked.map((s) => s.id) });
      onApplied(r.recipe);
      setOff(new Set());
      setMsg(
        `${r.version ? `Saved as version ${r.version}` : "Saved"}: ${r.applied === 1 ? "1 change" : `${r.applied} changes`} to the ingredients.${r.missing.length ? ` Skipped (no longer in the recipe): ${r.missing.join(", ")}.` : ""} The earlier version is in Version history.`,
      );
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };
  const input = "min-w-0 rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action";
  const describe = (s: Substitution) => (s.kind === "add" ? `Added ${pretty(s.replacement)}` : `${s.original ?? ""} → ${pretty(s.replacement)}`);
  const kindChoice = (k: "swap" | "add", label: string) => (
    <label className={`cursor-pointer rounded-md px-3 py-1.5 ${kind === k ? "bg-container shadow-sm" : "text-subtle"}`}>
      <input type="radio" name={`sub-kind-${recipeId}`} aria-label={label} checked={kind === k} onChange={() => (setKind(k), setError(""))} className="sr-only" />
      {label}
    </label>
  );
  return (
    <section aria-label="Substitutions" className={`${card} ${className}`}>
      <h2 className="text-xl font-bold">Substitutions</h2>
      <p className="mt-1 text-sm text-subtle">What you swapped or added when you made it. Make a new version puts them into the recipe.</p>
      <div role="radiogroup" aria-label="Kind" className="mt-3 inline-flex rounded-lg bg-page p-1 text-sm font-semibold">
        {kindChoice("swap", "Swap an ingredient")}
        {kindChoice("add", "Add an item")}
      </div>
      <form onSubmit={(e) => void add(e)} className="mt-3 flex flex-col gap-2">
        {kind === "swap" && (
          <div className="relative">
            <input
              role="combobox"
              aria-label="Instead of"
              aria-expanded={matches.length > 0 && focus}
              aria-autocomplete="list"
              placeholder="Instead of (type to find one in the recipe)"
              value={original}
              onFocus={() => setFocus(true)}
              onBlur={() => setTimeout(() => setFocus(false), 150)}
              onChange={(e) => (setOriginal(e.target.value), setLine(null))}
              className={`${input} w-full`}
            />
            {line && <span className="mt-1 inline-block rounded-full bg-brand-subtle px-2 py-0.5 text-xs font-semibold text-action">From the recipe</span>}
            {matches.length > 0 && focus && (
              <ul role="listbox" aria-label="Ingredients in this recipe" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-container py-1 shadow-lg">
                {matches.map((m) => (
                  <li key={m} role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => (setOriginal(m), setLine(m), setFocus(false))} className="cursor-pointer px-3 py-2 text-sm hover:bg-pressed">
                    {m}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[7.5rem_7.5rem_1fr]">
          <select aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} className={input}>
            <option value="">Amount</option>
            {AMOUNTS.map(([v, f]) => (
              <option key={v} value={v}>
                {f}
              </option>
            ))}
          </select>
          <select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={input}>
            <option value="">Unit</option>
            {UNITS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          <input aria-label="Item" placeholder={kind === "swap" ? "I used (Greek yogurt)" : "What you added (smoked paprika)"} value={item} onChange={(e) => setItem(e.target.value)} className={`${input} col-span-2 sm:col-span-1`} />
        </div>
        <div className="flex gap-2">
          <input aria-label="How it went" placeholder="How it went (optional)" value={note} onChange={(e) => setNote(e.target.value)} className={`${input} flex-1`} />
          <button type="submit" disabled={!item.trim() || (kind === "swap" && !original.trim())} className="rounded-lg bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">
            Add
          </button>
        </div>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
      {list.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-muted">Your substitutions</h3>
          <ul aria-label="Your substitutions" className="mt-1 divide-y divide-line">
            {list.map((s) => (
              <li key={s.id} className="flex items-start gap-3 py-2.5">
                {can(s) ? (
                  <input type="checkbox" aria-label={`Include ${describe(s)}`} checked={!off.has(s.id)} onChange={(e) => setOff((o) => { const n = new Set(o); if (e.target.checked) n.delete(s.id); else n.add(s.id); return n; })} className="mt-1 size-4 shrink-0 accent-[var(--color-action)]" />
                ) : (
                  <span className="mt-1 size-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  {s.kind === "add" ? (
                    <strong className="font-semibold">{`Added ${pretty(s.replacement)}`}</strong>
                  ) : (
                    <span>
                      <span className="text-subtle line-through decoration-muted/60">{s.original}</span> → <strong>{pretty(s.replacement)}</strong>
                    </span>
                  )}
                  {s.appliedVersion !== null && <span className="ml-2 rounded-full bg-success-subtle px-2 py-0.5 text-xs font-semibold text-success">{s.appliedVersion ? `in v${s.appliedVersion}` : "applied"}</span>}
                  {s.kind === "swap" && !s.line && s.appliedVersion === null && <span className="block text-xs text-muted">A note: not tied to an ingredient in the recipe, so it isn't applied.</span>}
                  {s.note && <span className="block text-sm text-subtle">{s.note}</span>}
                  <span className="block text-xs text-muted">{new Date(s.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                </span>
                <button type="button" aria-label={`Remove ${describe(s)}`} title={`Remove ${describe(s)}`} onClick={() => void remove(s.id)} className="rounded p-1.5 text-muted hover:bg-error-subtle hover:text-error">
                  <Trash />
                </button>
              </li>
            ))}
          </ul>
          {list.some(can) && (
            <div className="mt-3 border-t border-line pt-3">
              <button type="button" disabled={busy || !ticked.length} onClick={() => void apply()} className="rounded-lg bg-action px-4 py-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {busy ? "Saving…" : "Make a new version with these changes"}
              </button>
              <p className="mt-1 text-xs text-muted">Swaps replace their ingredient lines and added items go at the end. The recipe as it is now stays in Version history.</p>
            </div>
          )}
        </>
      )}
      {msg && (
        <p role="status" className="mt-3 rounded-lg bg-success-subtle px-3 py-2 text-sm text-success">
          {msg}
        </p>
      )}
    </section>
  );
}


// Servings to put on the meal plan: the scaled count when the recipe has been scaled (whole servings), else none (the recipe's own)
function plannedServings(servings: number | null | undefined, factor: number) {
  if (!servings || factor === 1) return undefined;
  const n = Math.round(servings * factor);
  return n >= 1 && n !== servings ? n : undefined;
}
