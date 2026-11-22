import { useEffect, useState } from "react";
import { aiWeights, convertTemperatures, ingredientLine, recipeUnits, type Units } from "../../cooking";
import { formatMinutes, siteName, type Ingredient, type Nutrition, type Step } from "../../recipes";
import { NutritionFacts } from "../recipes/NutritionCard";
import { ScaleControls } from "../recipes/ScaleControls";
import { ClockIcon, LinkOutIcon, Logo } from "../Icons";
import { EXPORT_FORMATS, type ExportFormat } from "../../exportFormats";
import { Popup } from "../Popup";

// /share/rcp_…: a recipe someone shared, for anyone with the link. No sign-in, nothing to change;
// it scales and switches units like the recipe page (just for whoever is looking).

export interface SharedRecipe {
  title: string;
  description: string | null;
  imageUrl: string | null;
  ingredients: Ingredient[];
  steps: Step[];
  servings: number | null;
  yieldText: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  nutrition: Nutrition | null;
  sourceUrl: string | null;
  sourceName: string | null;
  tags: string[];
  categories: string[];
}

export const shareTokenFrom = (pathname: string) => pathname.match(/^\/share\/(rcp_[0-9a-f]{32})\/?$/)?.[1] ?? null;

export default function PublicRecipePage({ token }: { token: string }) {
  const [r, setR] = useState<SharedRecipe | null>(null);
  const [missing, setMissing] = useState(false);
  const [factor, setFactor] = useState(1);
  const [units, setUnits] = useState<Units>("original");
  // ?download=pdf (the email's Download links): a window with that format picked
  const [download, setDownload] = useState<ExportFormat | null>(() => {
    const f = new URLSearchParams(window.location.search).get("download");
    return EXPORT_FORMATS.some((x) => x.id === f) ? (f as ExportFormat) : null;
  });

  useEffect(() => {
    // Plain fetch: this page never sends a sign-in
    fetch(`/api/public/share/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const recipe = (await res.json()) as SharedRecipe;
        setR(recipe);
        document.title = `${recipe.title} · RecipeHub`;
      })
      .catch(() => setMissing(true));
  }, [token]);

  const brand = (
    <header className="flex items-center gap-2 py-4">
      <Logo className="size-7" />
      <span className="font-semibold">RecipeHub</span>
    </header>
  );
  if (missing)
    return (
      <div className="mx-auto max-w-[640px] px-4">
        {brand}
        <h1 className="mt-6 text-2xl font-semibold">This recipe isn't shared</h1>
        <p className="mt-2 text-subtle">The link may have been replaced or turned off. Ask whoever sent it for a new one.</p>
      </div>
    );
  if (!r) return <div className="mx-auto max-w-[960px] px-4">{brand}</div>;
  const weights = aiWeights(r.nutrition);

  const times = ([["Prep", r.prepMinutes], ["Cook", r.cookMinutes], ["Total", r.totalMinutes]] as const).filter(([, m]) => m);
  const source = r.sourceName || siteName(r.sourceUrl);
  let n = 0;
  return (
    <div className="mx-auto max-w-[960px] px-4 pb-16">
      {brand}
      <article className="overflow-hidden rounded-2xl bg-container">
        <div className={r.imageUrl ? "grid md:grid-cols-2" : ""}>
          {r.imageUrl && (
            <div className="aspect-[4/3] bg-brand-subtle md:aspect-auto md:min-h-[320px]">
              <img src={r.imageUrl} alt={r.title} className="size-full object-cover" />
            </div>
          )}
          <div className="flex flex-col gap-3 p-5 sm:p-6">
            {r.categories.length > 0 && <p className="text-sm font-semibold uppercase tracking-wide text-muted">{r.categories.join(" · ")}</p>}
            <h1 className="text-3xl font-semibold leading-tight">{r.title}</h1>
            {r.description && <p className="text-subtle">{r.description}</p>}
            {(times.length > 0 || r.yieldText) && (
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                {times.length > 0 && <ClockIcon className="text-subtle" />}
                {times.map(([label, m]) => (
                  <span key={label}>
                    <span className="text-subtle">{label}</span> <strong>{formatMinutes(m!)}</strong>
                  </span>
                ))}
                {r.yieldText && <span>Makes {r.yieldText}</span>}
              </p>
            )}
            {source && (
              <p className="text-sm text-subtle">
                From{" "}
                {r.sourceUrl ? (
                  <a href={r.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-semibold text-link hover:underline">
                    {source} <LinkOutIcon />
                  </a>
                ) : (
                  <strong>{source}</strong>
                )}
              </p>
            )}
            {r.tags.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {r.tags.map((t) => (
                  <li key={t} className="rounded-full bg-page px-3 py-1 text-sm text-subtle">
                    #{t}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </article>

      <div className="mt-4 grid items-start gap-4 md:grid-cols-2">
          <section aria-label="Ingredients" className="rounded-2xl bg-container p-5 sm:p-6 md:col-start-1 md:row-start-1">
            <h2 className="text-xl font-semibold">Ingredients</h2>
            <div className="mt-3">
              <ScaleControls servings={r.servings} factor={factor} setFactor={setFactor} units={units} setUnits={setUnits} leans={recipeUnits(r.ingredients)} />
            </div>
            <ul className="mt-3 divide-y divide-line">
              {r.ingredients.map((i, k) => {
                const line = ingredientLine(i, factor, units, weights.get(i.raw.trim().toLowerCase()));
                return (
                  <li key={k} className={`py-2.5 ${i.section ? "pt-4 text-sm font-semibold uppercase tracking-wide text-muted" : ""}`}>
                    {line.plain ? (
                      line.name
                    ) : (
                      <>
                        <strong className="font-semibold">{line.amount}</strong> {line.name}
                        {line.note && <span className="text-subtle">, {line.note}</span>}
                        {line.dried && <span className="text-subtle"> ({line.dried})</span>}
                        {line.was && <span className="text-subtle" title={line.estimate === "ai" ? "Weight estimated by AI (with the nutrition)" : "Approximate weight"}> ({line.was})</span>}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        <section aria-label="Steps" className="rounded-2xl bg-container p-5 sm:p-6 md:col-start-2 md:row-span-2 md:row-start-1">
          <h2 className="text-xl font-semibold">Steps</h2>
          <ol className="mt-3 flex flex-col gap-4">
            {r.steps.map((s, k) =>
              s.section ? (
                <li key={k} className="mt-2 text-sm font-semibold uppercase tracking-wide text-muted">
                  {s.section}
                </li>
              ) : (
                <li key={k} className="flex gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-sm font-semibold text-action">{++n}</span>
                  <p className="leading-relaxed">{convertTemperatures(s.text ?? "", units)}</p>
                </li>
              ),
            )}
          </ol>
        </section>
        {r.nutrition && (
          <section aria-label="Nutrition" className="rounded-2xl bg-container p-5 sm:p-6 md:col-start-1 md:row-start-2">
            <h2 className="text-xl font-semibold">Nutrition</h2>
            <p className="text-sm text-subtle">Per serving</p>
            <NutritionFacts value={r.nutrition} />
          </section>
        )}
      </div>
      <section aria-label="Download" className="mt-4 rounded-2xl bg-container p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Download</h2>
        <p className="mt-1 text-sm text-subtle">Keep a copy, or bring it into your own recipe app.</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {EXPORT_FORMATS.map((f) => (
            <li key={f.id} className="rounded-xl border border-line px-4 py-3">
              <a href={`/api/public/share/${token}/export?format=${f.id}`} download className="font-semibold text-link hover:underline">
                {f.name}
              </a>
              <p className="mt-0.5 text-xs text-subtle">{f.hint}</p>
            </li>
          ))}
        </ul>
      </section>
      <p className="mt-6 text-center text-sm text-muted">Shared from RecipeHub, a self-hosted recipe manager.</p>
      {download && (
        <Popup title={`Download ${r.title}`} onClose={() => setDownload(null)}>
          <div className="flex flex-col gap-3 p-5">
            <div role="radiogroup" aria-label="Format" className="flex flex-col gap-2">
              {EXPORT_FORMATS.map((f) => (
                <label key={f.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 px-3 py-2.5 ${download === f.id ? "border-action bg-brand-subtle" : "border-line hover:border-strong"}`}>
                  <input type="radio" name="download-format" checked={download === f.id} onChange={() => setDownload(f.id)} className="mt-1 accent-[var(--color-action)]" />
                  <span>
                    <span className="font-semibold">{f.name}</span>
                    <span className="block text-xs text-subtle">{f.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <a href={`/api/public/share/${token}/export?format=${download}`} download className="self-start rounded-lg bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-pressed">
              Download {EXPORT_FORMATS.find((f) => f.id === download)!.name}
            </a>
          </div>
        </Popup>
      )}
    </div>
  );
}
