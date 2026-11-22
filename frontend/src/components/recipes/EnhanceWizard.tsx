import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, getToken } from "../../api";
import { Popup } from "../Popup";
import { Check, ChevronRight, EditIcon } from "../Icons";
import { stepLabel, type Enhancement, type Nutrition, type Recipe } from "../../recipes";
import { ServingsChooser } from "./NutritionCard";

// One line of the progress list from the server
type Skip = { id: string; name: string };
type Progress = { text: string; waiting?: boolean; at: number; detail?: string; skip?: Skip };
type StepEvent = { text: string; waiting?: boolean; skip?: Skip };

// Ask for the check with progress: the server sends one JSON object per line as it works
// ({"type":"step",...}, then {"type":"result",...} or {"type":"error",...}). A plain JSON reply works too.
async function checkRecipe(id: number, on: { step: (p: StepEvent) => void; status: (text: string) => void }, o: { skip: string[]; signal: AbortSignal }): Promise<Enhancement> {
  const token = getToken();
  let res: Response;
  try {
    const query = o.skip.length ? `?skip=${o.skip.map(encodeURIComponent).join(",")}` : "";
    res = await fetch(`/api/recipes/${id}/enhance${query}`, { method: "POST", signal: o.signal, headers: { accept: "application/x-ndjson, application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  } catch {
    throw new ApiError(0, "Couldn't reach RecipeHub. Check your connection and try again.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? `The AI check failed (${res.status})`);
  }
  if (!(res.headers.get("content-type") ?? "").includes("ndjson")) return (await res.json()) as Enhancement;
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const o = JSON.parse(line);
      if (o.type === "step") on.step({ text: o.text, waiting: o.waiting, skip: o.skip });
      else if (o.type === "status") on.status(o.text);
      else if (o.type === "result") return o.enhancement as Enhancement;
      else if (o.type === "error") throw new ApiError(o.status ?? 500, o.error ?? "The AI check failed");
    }
    if (done) throw new ApiError(0, "The connection closed before the AI finished. Try again.");
  }
}

// What the AI was asked to look for (shown in turn while it works; these are its instructions, not progress)
const ASKED = [
  "look for missing times, temperatures and doneness cues",
  "expand brief steps into full instructions",
  "check that the steps use every ingredient",
  "find ingredients the steps use but the list leaves out",
  "check doneness temperatures are food-safe",
  "estimate nutrition per serving",
  "match your categories and suggest tags",
];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// collapsed: the check is done and the suggestions are showing; a > opens the list again
function ProgressList({ lines, working, onSkip, collapsed }: { lines: Progress[]; working: boolean; onSkip: (s: Skip) => void; collapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [tip, setTip] = useState(0);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    const r = setInterval(() => setTip((i) => (i + 1) % ASKED.length), 3500);
    return () => (clearInterval(t), clearInterval(r));
  }, [working]);
  if (collapsed && !open)
    return (
      <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className="flex items-center gap-1.5 self-start rounded-lg px-1 py-1 text-sm font-semibold text-subtle hover:text-ink">
        <ChevronRight className="size-4" /> What the AI did ({lines.length} steps)
      </button>
    );
  return (
    <div className="rounded-xl bg-page p-4">
      {collapsed && (
        <button type="button" aria-expanded={true} onClick={() => setOpen(false)} className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-subtle hover:text-ink">
          <ChevronRight className="size-4 rotate-90" /> What the AI did ({lines.length} steps)
        </button>
      )}
      <ul role="log" aria-label="AI check progress" className="space-y-1.5 text-sm">
        {lines.map((l, i) => {
          const active = working && i === lines.length - 1;
          const next = lines[i + 1];
          // a finished wait: "Asked Home AI (qwen3-vl:32b)", took 0:42
          const text = !active && l.waiting ? l.text.replace(/^Asking (.*)…$/, "Asked $1") : l.text;
          return (
            <li key={i} className="flex items-start gap-2">
              {active ? <span className="mt-1 size-3 shrink-0 animate-spin rounded-full border-2 border-action border-t-transparent" aria-hidden /> : <Check className="mt-0.5 size-4 shrink-0 text-action" />}
              <span className={active ? "font-semibold" : "text-subtle"}>
                {text}
                {active && l.detail && <span className="block text-xs font-normal text-muted">{l.detail}</span>}
              </span>
              {active && l.waiting && <span className="ml-auto tabular-nums text-muted">{clock(Math.max(0, Math.floor((now - l.at) / 1000)))}</span>}
              {!active && l.waiting && next && <span className="ml-auto tabular-nums text-muted">took {clock(Math.max(0, Math.round((next.at - l.at) / 1000)))}</span>}
              {active && l.skip && (
                <button type="button" onClick={() => onSkip(l.skip!)} className="shrink-0 rounded-md border border-line bg-container px-2 py-0.5 text-xs font-semibold hover:bg-pressed">
                  Skip {l.skip.name}
                </button>
              )}
            </li>
          );
        })}
        {working && !lines.length && <li className="text-subtle">Starting the check…</li>}
      </ul>
      {working && (
        <p className="mt-3 border-t border-line pt-3 text-sm text-muted">
          The AI was asked to {ASKED[tip]}. A full check usually takes 10 seconds to a couple of minutes on a home AI.
        </p>
      )}
    </div>
  );
}

type Key = "steps" | "ingredients" | "nutrition" | "organize";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const stepLines = (r: Recipe) => r.steps.map((s) => (s.section ? `# ${s.section}` : s.text));
const ingredientLines = (r: Recipe) => r.ingredients.map((i) => (i.section ? `# ${i.section}` : i.raw));

// One line of a list; "# Heading" lines show as headings. Lines that aren't in the original are marked.
function Line({ text, marked }: { text: string; marked?: boolean }) {
  const heading = text.match(/^#\s+(.+)$/)?.[1];
  const label = heading ? null : stepLabel(text);
  const body = heading ? (
    <strong>{heading}</strong>
  ) : label ? (
    <>
      <strong>{label[0]}</strong>
      {label[1]}
    </>
  ) : (
    text
  );
  return <li className="py-0.5">{marked ? <mark className="rounded bg-action/15 px-0.5 text-ink">{body}</mark> : body}</li>;
}
function Lines({ lines, against }: { lines: string[]; against?: string[] }) {
  const before = against && new Set(against.map(norm));
  if (!lines.length) return <p className="text-subtle">None</p>;
  return (
    <ul className="space-y-0.5">
      {lines.map((l, i) => (
        <Line key={i} text={l} marked={!!before && !before.has(norm(l))} />
      ))}
    </ul>
  );
}

const NUTRIENTS: [keyof Nutrition, string, string][] = [
  ["calories", "Calories", "kcal"],
  ["fat", "Fat", "g"],
  ["saturatedFat", "Saturated fat", "g"],
  ["carbs", "Carbs", "g"],
  ["fiber", "Fiber", "g"],
  ["sugar", "Sugar", "g"],
  ["addedSugar", "Added sugars", "g"],
  ["protein", "Protein", "g"],
  ["sodium", "Sodium", "mg"],
];
function NutritionList({ n }: { n: Nutrition | null }) {
  if (!n) return <p className="text-subtle">None yet</p>;
  return (
    <dl className="grid grid-cols-[auto_auto] justify-start gap-x-4 gap-y-0.5">
      {n.servingSize && (
        <div className="contents">
          <dt className="text-subtle">Serving size</dt>
          <dd>{n.servingSize}</dd>
        </div>
      )}
      {NUTRIENTS.map(([k, label, unit]) => (
        <div key={k} className="contents">
          <dt className="text-subtle">{label}</dt>
          <dd>{n[k] == null ? "–" : `${n[k]} ${unit}`}</dd>
        </div>
      ))}
    </dl>
  );
}

function Chips({ items, mark, strike, isNew }: { items: string[]; mark?: Set<string>; strike?: Set<string>; isNew?: Set<string> }) {
  if (!items.length) return <span className="text-subtle">None</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((x) => {
        const k = x.toLowerCase();
        const label = strike?.has(k) ? <s>{x}</s> : mark?.has(k) ? <mark className="rounded bg-action/15 px-0.5 text-ink">{x}</mark> : x;
        return (
          <span key={x} className="inline-flex items-center gap-1 rounded-full bg-page px-2.5 py-0.5">
            {label}
            {isNew?.has(k) && <span className="rounded bg-action px-1 text-xs font-semibold text-white">new</span>}
          </span>
        );
      })}
    </span>
  );
}

// One part of the recipe: Original on the left, AI suggestion on the right (stacked on a phone),
// and what changed. The pencil opens the suggestion to edit it (editor); Done ends editing.
function Part({ title, badge, changes, original, suggested, editing, onEdit, onDone, editor }: { title: string; badge?: string; changes: string[]; original: ReactNode; suggested: ReactNode; editing: boolean; onEdit: () => void; onDone: () => void; editor: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-xl font-bold">
        {title}
        {badge && <span className="rounded-full bg-brand-subtle px-2 py-0.5 text-xs font-semibold text-action">{badge}</span>}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-line p-3">
          <h4 className="mb-1 text-sm font-semibold uppercase tracking-wide text-subtle">Original</h4>
          {original}
        </div>
        <div className={`rounded-xl border p-3 ${editing ? "border-action ring-2 ring-action/20" : "border-action/40"}`}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-subtle">AI suggestion</h4>
            {!editing && (
              <button type="button" aria-label="Edit the AI suggestion" title="Edit the AI suggestion" onClick={onEdit} className="flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-pressed hover:text-ink">
                <EditIcon />
              </button>
            )}
          </div>
          {editing ? (
            <div className="flex flex-col gap-2">
              {editor}
              <button type="button" onClick={onDone} className="self-end rounded-lg bg-action px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
                Done
              </button>
            </div>
          ) : (
            suggested
          )}
        </div>
      </div>
      {changes.length > 0 && (
        <div className="rounded-lg bg-page p-3">
          <p className="text-sm font-semibold">What changed</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// The nutrition fields the server takes back (a loaded recipe's nutrition carries a few more, like outdated)
const NUTRITION_KEYS = ["calories", "fat", "saturatedFat", "carbs", "fiber", "sugar", "addedSugar", "protein", "sodium", "source", "servings", "servingSize", "note", "perIngredient"] as const;
const nutritionBody = (n: Nutrition, servingSize: string | null) => {
  const all = n as unknown as Record<string, unknown>;
  return { ...Object.fromEntries(NUTRITION_KEYS.filter((k) => all[k] !== undefined).map((k) => [k, all[k]])), servingSize };
};

// The AI's per-serving numbers for another number of servings (the whole recipe stays the same)
const NUMBER_KEYS = ["calories", "fat", "saturatedFat", "carbs", "fiber", "sugar", "addedSugar", "protein", "sodium"] as const;
export function perServingFor(n: Nutrition, servings: number): Nutrition {
  const was = n.servings || 1;
  if (was === servings) return n;
  const out = { ...n, servings } as Record<string, unknown>;
  for (const k of NUMBER_KEYS) {
    const v = (n as unknown as Record<string, number | null | undefined>)[k];
    if (typeof v === "number") out[k] = Math.round(((v * was) / servings) * 10) / 10;
  }
  return out as unknown as Nutrition;
}

const box = "w-full rounded-lg border border-line bg-page px-3 py-2 text-sm leading-relaxed outline-none focus:border-action";
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

// Improve with AI: asks the AI to check the recipe (nothing is saved yet), then goes one part at a
// time (ingredients, instructions, nutrition, categories and tags: only parts with changes), each
// with the original beside the AI's version. Reject change or Accept change moves on; after the
// last part the accepted parts are saved (what the recipe was stays in the version history).
// The pencil edits the AI's version first. onFinished: the end with nothing accepted (or nothing
// to change); onClose: the ✕. position and onStop: an import's recipes one by one.
// onChanged: the name, servings, serving size or Makes were saved from the first step (the wizard stays open).
export default function EnhanceWizard({ recipe, onClose, onApplied, onFinished, onChanged, position, onStop }: { recipe: Recipe; onClose: () => void; onApplied: (r: Recipe) => void; onFinished?: () => void; onChanged?: (r: Recipe) => void; position?: { n: number; of: number }; onStop?: () => void }) {
  const [e, setE] = useState<Enhancement | null>(null);
  const [error, setError] = useState("");
  const [applyError, setApplyError] = useState("");
  const [busy, setBusy] = useState(false);
  const [use, setUse] = useState<Record<Key, boolean>>({ steps: false, ingredients: false, nutrition: false, organize: false });
  const [at, setAt] = useState(0); // which part
  // The AI's versions as edited here (the pencil), and the part being edited
  const [mine, setMine] = useState<{ ingredients?: string[]; steps?: string[]; nutrition?: Nutrition | null; categories?: string[]; tags?: string[] }>({});
  const [editing, setEditing] = useState<Key | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  // The name, servings, Makes and serving size as saved from the first step
  const [now, setNow] = useState({ title: recipe.title, servings: recipe.servings, yieldText: recipe.yieldText, servingSize: recipe.nutrition?.servingSize ?? null });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // What was typed into servings, serving size and Makes (a field not typed in stays as it is)
  const [dd, setDd] = useState<Partial<Record<"servings" | "servingSize" | "yieldText", string>>>({});
  const [detailsError, setDetailsError] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  // No servings on the recipe: asked first, since the AI's nutrition is per serving
  const [needServings, setNeedServings] = useState(!recipe.servings);
  const pickedSize = useRef<string | null>(null);

  const [lines, setLines] = useState<Progress[]>([]);
  const [errorStatus, setErrorStatus] = useState(0);
  const run = useRef(0);
  const stopper = useRef<AbortController | null>(null);
  // skip: services the person skipped as too slow (asked again without them; the list carries on)
  const check = useCallback(
    (skip: string[] = []) => {
      const mineRun = ++run.current; // a newer request wins over an older answer
      stopper.current?.abort();
      const stop = (stopper.current = new AbortController());
      setError("");
      setE(null);
      if (!skip.length) setLines([]);
      checkRecipe(
        recipe.id,
        {
          step: (p) =>
            mineRun === run.current &&
            setLines((ls) => (skip.length && /^Reading “/.test(p.text) && ls.some((l) => /^Reading “/.test(l.text)) ? ls : [...ls, { ...p, at: Date.now() }])),
          status: (text) => mineRun === run.current && setLines((ls) => (ls.length ? [...ls.slice(0, -1), { ...ls[ls.length - 1], detail: text }] : ls)),
        },
        { skip, signal: stop.signal }
      )
        .then((r) => {
          if (mineRun !== run.current) return;
          setE(r);
          setAt(0);
          // the serving size picked before the check labels the AI's nutrition
          setMine(pickedSize.current && r.nutrition.suggested ? { nutrition: { ...r.nutrition.suggested, servingSize: pickedSize.current } } : {});
          setUse({ steps: false, ingredients: false, nutrition: false, organize: false });
        })
        .catch((err) => {
          if (mineRun !== run.current) return;
          setErrorStatus((err as ApiError).status ?? 0);
          setError((err as Error).message);
        });
    },
    [recipe.id]
  );
  const skipped = useRef<string[]>([]);
  const skipService = (s: Skip) => {
    skipped.current = [...skipped.current, s.id];
    setLines((ls) => [...ls.map((l) => ({ ...l, skip: undefined, detail: undefined })), { text: `Skipped ${s.name}`, at: Date.now() }]);
    check(skipped.current);
  };
  // closing the window stops the request (the AI server stops working on it too)
  useEffect(() => () => stopper.current?.abort(), []);
  useEffect(() => {
    if (needServings) return; // (asked for the servings first)
    skipped.current = [];
    check();
  }, [check, needServings]);

  // The AI's version of each part, with any edits made here
  const sug = e && {
    ingredients: mine.ingredients ?? e.ingredients.suggested,
    steps: mine.steps ?? e.steps.suggested,
    nutrition: mine.nutrition !== undefined ? mine.nutrition : e.nutrition.suggested,
    categories: mine.categories ?? e.organize.categories,
    tags: mine.tags ?? e.organize.tags,
  };

  // The serving size shown: yours, else the AI's suggestion
  const servingSize = now.servingSize ?? sug?.nutrition?.servingSize ?? null;
  async function patch(body: Record<string, unknown>) {
    const r = await api<Recipe>("PATCH", `/api/recipes/${recipe.id}`, body);
    setNow((x) => ({ ...x, title: r.title, servings: r.servings, yieldText: r.yieldText }));
    onChanged?.(r);
  }
  async function rename() {
    const t = (renaming ?? "").trim();
    setRenaming(null);
    if (!t || t === now.title) return;
    setDetailsError("");
    try {
      await patch({ title: t });
    } catch (err) {
      setDetailsError((err as Error).message);
    }
  }
  async function saveDetails() {
    const servingsText = dd.servings?.trim();
    const servings = servingsText ? Number(servingsText) : null;
    if (servingsText && !(Number.isInteger(servings) && servings! > 0 && servings! <= 1000)) return setDetailsError("Servings should be a whole number. Put things like “2 loaves” in Makes.");
    const yieldText = dd.yieldText?.trim() || null;
    const size = dd.servingSize?.trim() || null;
    const body: Record<string, unknown> = {};
    if (dd.servings !== undefined && servings !== now.servings) body.servings = servings;
    if (dd.yieldText !== undefined && yieldText !== now.yieldText) body.yieldText = yieldText;
    // New servings: the AI's per-serving numbers are divided again (it's still the same recipe)
    let suggested = sug?.nutrition ?? null;
    if (body.servings && suggested) suggested = perServingFor(suggested, body.servings as number);
    // The serving size lives with the nutrition: the recipe's own, and the AI's suggested numbers
    if (dd.servingSize !== undefined && size !== servingSize) {
      if (recipe.nutrition) body.nutrition = nutritionBody(recipe.nutrition, size);
      if (suggested) suggested = { ...suggested, servingSize: size };
      setNow((x) => ({ ...x, servingSize: size }));
    }
    if (suggested && suggested !== sug?.nutrition) setMine((m) => ({ ...m, nutrition: suggested }));
    setDetailsError("");
    if (Object.keys(body).length) {
      setSavingDetails(true);
      try {
        await patch(body);
      } catch (err) {
        return setDetailsError((err as Error).message);
      } finally {
        setSavingDetails(false);
      }
    }
    setDetailsOpen(false);
    setDd({});
  }

  async function save(choices: Record<Key, boolean>) {
    if (!e || !sug) return;
    const body: Record<string, unknown> = {};
    if (choices.steps && e.steps.changed) body.steps = sug.steps;
    if (choices.ingredients && e.ingredients.changed) body.ingredients = sug.ingredients;
    if (choices.nutrition && e.nutrition.changed) body.nutrition = sug.nutrition;
    if (choices.organize && e.organize.changed) Object.assign(body, { categories: sug.categories, tags: sug.tags });
    if (!Object.keys(body).length) return (onFinished ?? onClose)();
    setBusy(true);
    setApplyError("");
    try {
      onApplied(await api<Recipe>("POST", `/api/recipes/${recipe.id}/enhance/apply`, body));
    } catch (err) {
      setApplyError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const cats = recipe.categories.map((c) => c.name);
  const lower = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));
  const startEdit = (key: Key) => {
    if (!sug) return;
    setDraft(
      key === "ingredients"
        ? { text: sug.ingredients.join("\n") }
        : key === "steps"
          ? { text: sug.steps.join("\n") }
          : key === "organize"
            ? { categories: sug.categories.join(", "), tags: sug.tags.join(", ") }
            : Object.fromEntries([...NUTRIENTS.map(([k]) => [k, sug.nutrition?.[k] == null ? "" : String(sug.nutrition[k])]), ["servingSize", sug.nutrition?.servingSize ?? ""]])
    );
    setEditing(key);
  };
  const finishEdit = () => {
    if (!editing || !e) return;
    const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);
    if (editing === "ingredients") setMine({ ...mine, ingredients: lines(draft.text) });
    if (editing === "steps") setMine({ ...mine, steps: lines(draft.text) });
    if (editing === "organize") setMine({ ...mine, categories: list(draft.categories), tags: list(draft.tags).map((t) => t.toLowerCase()) });
    if (editing === "nutrition") {
      const base = (sug?.nutrition ?? { source: "ai", servings: recipe.servings }) as Nutrition;
      const n = { ...base } as Record<string, unknown>;
      for (const [k] of NUTRIENTS) n[k] = draft[k]?.trim() ? Number(draft[k]) : null;
      n.servingSize = draft.servingSize?.trim() || null;
      delete n.perIngredient; // your numbers: the AI's per-ingredient breakdown no longer adds up to them
      setMine({ ...mine, nutrition: n as unknown as Nutrition });
    }
    setEditing(null);
  };
  const textEditor = <textarea aria-label="AI suggestion" rows={10} value={draft.text ?? ""} onChange={(ev) => setDraft({ ...draft, text: ev.target.value })} className={box} />;
  const field = (key: string, label: string) => (
    <label key={key} className="flex flex-col gap-0.5 text-xs font-semibold text-subtle">
      {label}
      <input aria-label={label} value={draft[key] ?? ""} onChange={(ev) => setDraft({ ...draft, [key]: ev.target.value })} className={box} />
    </label>
  );

  // The screens: each part with changes, in this order
  const parts: { key: Key; title: string; screen: () => ReactNode }[] = !e || !sug
    ? []
    : ([
        {
          key: "ingredients",
          title: "Ingredients",
          screen: () => <Part title="Ingredients" changes={e.ingredients.changes} editing={editing === "ingredients"} onEdit={() => startEdit("ingredients")} onDone={finishEdit} editor={textEditor} original={<Lines lines={ingredientLines(recipe)} />} suggested={<Lines lines={sug.ingredients} against={ingredientLines(recipe)} />} />,
        },
        {
          key: "steps",
          title: "Instructions",
          screen: () => (
            <Part
              title="Instructions"
              badge={e.steps.mode === "expanded" ? "Expanded" : e.steps.mode === "filled" ? "Filled gaps" : undefined}
              changes={e.steps.changes}
              editing={editing === "steps"}
              onEdit={() => startEdit("steps")}
              onDone={finishEdit}
              editor={textEditor}
              original={<Lines lines={stepLines(recipe)} />}
              suggested={<Lines lines={sug.steps} against={stepLines(recipe)} />}
            />
          ),
        },
        {
          key: "nutrition",
          title: "Nutrition",
          screen: () => (
            <Part
              title="Nutrition"
              changes={e.nutrition.changes}
              editing={editing === "nutrition"}
              onEdit={() => startEdit("nutrition")}
              onDone={finishEdit}
              editor={<div className="grid grid-cols-2 gap-2">{[field("servingSize", "Serving size"), ...NUTRIENTS.map(([k, label, unit]) => field(k, `${label} (${unit})`))]}</div>}
              original={<NutritionList n={recipe.nutrition} />}
              suggested={<NutritionList n={sug.nutrition} />}
            />
          ),
        },
        {
          key: "organize",
          title: "Categories and tags",
          screen: () => (
            <Part
              title="Categories and tags"
              changes={e.organize.changes}
              editing={editing === "organize"}
              onEdit={() => startEdit("organize")}
              onDone={finishEdit}
              editor={
                <div className="flex flex-col gap-2">
                  {field("categories", "Categories")}
                  {field("tags", "Tags")}
                  <p className="text-xs text-muted">Separate them with commas.</p>
                </div>
              }
              original={
                <div className="space-y-2">
                  <p className="text-sm text-subtle">Categories</p>
                  <Chips items={cats} />
                  <p className="text-sm text-subtle">Tags</p>
                  <Chips items={recipe.tags} strike={new Set([...lower(recipe.tags)].filter((t) => !lower(sug.tags).has(t)))} />
                </div>
              }
              suggested={
                <div className="space-y-2">
                  <p className="text-sm text-subtle">Categories</p>
                  <Chips items={sug.categories} mark={new Set([...lower(sug.categories)].filter((c) => !lower(cats).has(c)))} isNew={lower(e.organize.newCategories)} />
                  <p className="text-sm text-subtle">Tags</p>
                  <Chips items={sug.tags} mark={new Set([...lower(sug.tags)].filter((t) => !lower(recipe.tags).has(t)))} />
                </div>
              }
            />
          ),
        },
      ] as const).filter((p) => e[p.key].changed);

  // Reject change / Accept change: remember the choice and move on; after the last part, save
  const choose = (accept: boolean) => {
    const key = parts[at].key;
    const next = { ...use, [key]: accept };
    setUse(next);
    if (at < parts.length - 1) setAt(at + 1);
    else void save(next);
  };
  const button = "rounded-lg px-4 py-2 font-semibold disabled:opacity-50";
  const first = at === 0;
  const sizeHint = !recipe.nutrition && !sug?.nutrition ? "Comes with the nutrition" : !recipe.nutrition ? "Saved with the nutrition step" : undefined;

  // The header: the name, with a pencil on the first step
  const heading =
    renaming !== null ? (
      <input
        aria-label="Recipe name"
        autoFocus
        value={renaming}
        maxLength={300}
        onChange={(ev) => setRenaming(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") void rename();
          if (ev.key === "Escape") {
            ev.stopPropagation(); // (not the window's Escape, which closes the wizard)
            setRenaming(null);
          }
        }}
        onBlur={() => void rename()}
        className="w-full max-w-md rounded-lg border border-action bg-container px-3 py-1 text-center text-xl font-bold outline-none"
      />
    ) : (
      <h2 className="flex items-center gap-1.5 text-xl font-bold">
        {now.title}
        {first && (
          <button type="button" aria-label="Rename the recipe" title="Rename the recipe" onClick={() => setRenaming(now.title)} className="flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-container/70 hover:text-ink">
            <EditIcon />
          </button>
        )}
      </h2>
    );

  // Servings, serving size and Makes: on the first step you can fill them in (empty ones are open to type in)
  const detailRow = (key: "servings" | "servingSize" | "yieldText", label: string, value: string | null, hint?: string) => {
    const open = detailsOpen || (!value && !(key === "servingSize" && !recipe.nutrition && !sug?.nutrition));
    return (
      <div key={key} className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-subtle">{label}</span>
        {open ? (
          <input aria-label={label} value={dd[key] ?? value ?? ""} onChange={(ev) => setDd({ ...dd, [key]: ev.target.value })} placeholder={key === "servings" ? "4" : key === "yieldText" ? "24 cookies" : "About 1 cup"} inputMode={key === "servings" ? "numeric" : undefined} className={box} />
        ) : (
          <span>{value ?? "–"}</span>
        )}
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
    );
  };
  const anyOpen = detailsOpen || !now.servings || !now.yieldText || (!servingSize && !!(recipe.nutrition || sug?.nutrition));
  const dirty = Object.keys(dd).length > 0;
  const details = needServings ? null : first ? (
    <div role="group" aria-label="Recipe details" className="rounded-xl border border-line p-3">
      <div className="grid grid-cols-3 gap-3 text-sm">
        {detailRow("servings", "Servings", now.servings == null ? null : String(now.servings))}
        {detailRow("servingSize", "Serving size", servingSize, sizeHint)}
        {detailRow("yieldText", "Makes", now.yieldText)}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        {detailsError && <p role="alert" className="mr-auto text-sm text-error">{detailsError}</p>}
        {!detailsOpen && (
          <button type="button" aria-label="Edit servings and size" title="Edit servings and size" onClick={() => setDetailsOpen(true)} className="flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-pressed hover:text-ink">
            <EditIcon />
          </button>
        )}
        {detailsOpen && (
          <button type="button" onClick={() => (setDetailsOpen(false), setDd({}), setDetailsError(""))} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-subtle hover:bg-page">
            Cancel
          </button>
        )}
        {anyOpen && (
          <button type="button" aria-label="Save details" disabled={savingDetails || !dirty} onClick={() => void saveDetails()} className="rounded-lg bg-action px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {savingDetails ? "Saving…" : "Save"}
          </button>
        )}
      </div>
    </div>
  ) : (
    <p className="text-sm text-subtle">
      {[now.servings && `Serves ${now.servings}`, servingSize && `${servingSize} per serving`, now.yieldText && `Makes ${now.yieldText}`].filter(Boolean).join(" · ")}
    </p>
  );

  return (
    <Popup title={now.title} heading={heading} onClose={onClose} wide tall>
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        {e && parts.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-action">
                {position ? `Recipe ${position.n} of ${position.of} · ` : ""}Improve with AI · Step {at + 1} of {parts.length}
              </p>
              {onStop && (
                <button type="button" onClick={onStop} className="text-sm font-semibold text-subtle hover:underline">
                  Stop reviewing
                </button>
              )}
            </div>
            <div className="flex gap-1" aria-hidden>
              {parts.map((_, i) => (
                <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= at ? "bg-action" : "bg-line"}`} />
              ))}
            </div>
          </div>
        )}
        {needServings && (
          <section aria-label="How many servings?" className="flex flex-col gap-3">
            <h3 className="text-xl font-bold">How many servings?</h3>
            <ServingsChooser
              recipeId={recipe.id}
              yieldText={recipe.yieldText}
              onCancel={onClose}
              saveLabel="Save and continue"
              onSaved={(r, size) => {
                pickedSize.current = size ?? null;
                setNow((x) => ({ ...x, servings: r.servings, yieldText: r.yieldText, servingSize: size ?? x.servingSize }));
                onChanged?.(r);
                setNeedServings(false);
              }}
            />
          </section>
        )}
        {details}
        {!needServings && (lines.length > 0 || (!e && !error)) && <ProgressList lines={lines} working={!e && !error} onSkip={skipService} collapsed={!!e} />}
        {error && (
          <div role="alert" className="rounded-xl bg-error-subtle p-4">
            <p>{error}</p>
            {/* AI Enhance or AI turned off, or the recipe is gone: asking again won't help */}
            {errorStatus !== 409 && errorStatus !== 404 && (
              <button type="button" onClick={() => check(skipped.current)} className="mt-3 rounded-lg bg-action px-4 py-2 font-semibold text-white hover:opacity-90">
                Try again
              </button>
            )}
          </div>
        )}
        {e && parts.length === 0 && (
          <>
            <p className="rounded-xl bg-page p-4">The AI didn't find anything to change. The recipe looks good as it is.</p>
            <div className="flex justify-end">
              <button type="button" onClick={() => (onFinished ?? onClose)()} className={`${button} bg-action text-white hover:opacity-90`}>
                Done
              </button>
            </div>
          </>
        )}
        {e && parts.length > 0 && (
          <>
            {parts[at].screen()}
            {applyError && (
              <p role="alert" className="rounded-xl bg-error-subtle p-3">
                {applyError}
              </p>
            )}
            <div role="group" aria-label="Your choice" className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              {at > 0 && (
                <button type="button" disabled={!!editing || busy} onClick={() => setAt(at - 1)} className={`${button} text-subtle hover:bg-page`}>
                  Prior
                </button>
              )}
              <span className="ml-auto" />
              <button type="button" disabled={!!editing || busy} onClick={() => choose(false)} className={`${button} border border-line hover:bg-page`}>
                Reject change
              </button>
              <button type="button" disabled={!!editing || busy} onClick={() => choose(true)} className={`${button} bg-action text-white hover:opacity-90`}>
                {busy ? "Saving…" : "Accept change"}
              </button>
            </div>
            {editing && <p className="-mt-2 text-right text-sm text-subtle">Press Done to finish editing first.</p>}
          </>
        )}
      </div>
    </Popup>
  );
}
