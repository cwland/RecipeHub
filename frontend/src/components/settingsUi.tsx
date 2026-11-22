import type { ReactNode } from "react";

export function Card({ title, children, description, titleExtra }: { title: string; description?: ReactNode; children: ReactNode; titleExtra?: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl bg-container p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        {title}
        {titleExtra}
      </h2>
      {description && <p className="mt-1 text-subtle">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export const field = "mt-1 w-full rounded border border-muted/50 bg-container px-3 py-2 outline-none focus:border-action focus:ring-2 focus:ring-action/15";
export const primaryButton = "rounded bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-pressed disabled:opacity-60";
export const secondaryButton = "rounded border border-primary px-4 py-2.5 font-semibold text-primary hover:bg-pressed disabled:opacity-60";

export function Notice({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-success" : "text-error"}>
      {msg.text}
    </span>
  );
}

// An on/off switch with its label
// text: what shows beside the switch (default "On"/"Off")
export function Toggle({ label, checked, disabled, onChange, text }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; text?: ReactNode }) {
  return (
    <label className={`flex shrink-0 items-center gap-3 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
      <button
        type="button"
        role="switch"
        aria-label={label} title={label}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 rounded-full transition disabled:opacity-50 ${checked ? "bg-action" : "bg-strong"}`}
      >
        <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${checked ? "left-6" : "left-1"}`} />
      </button>
      {text ?? <span className="w-7 text-lg">{checked ? "On" : "Off"}</span>}
    </label>
  );
}

// A settings card: title, explanation, a switch on the right, and options underneath when it's on
export function SettingCard({ title, text, toggle, children, titleExtra }: { title: string; text: ReactNode; toggle?: ReactNode; children?: ReactNode; titleExtra?: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl bg-container p-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold">
            {title}
            {titleExtra}
          </h2>
          <div className="mt-2 max-w-md text-subtle">{text}</div>
        </div>
        {toggle}
      </div>
      {children && <div className="mt-5 border-t border-line pt-5">{children}</div>}
    </section>
  );
}

// As is / Metric / US as one pill switch (the same look as on a recipe), with what the choice means below
const UNIT_HINT = { original: "Amounts as the recipe was written.", metric: "Grams, millilitres and °C.", us: "Cups, ounces and °F." } as const;
export function UnitsPills({ value, onChange }: { value: "original" | "metric" | "us"; onChange: (v: "original" | "metric" | "us") => void }) {
  return (
    <div>
      <div role="radiogroup" aria-label="Measurements" className="inline-flex rounded-lg bg-page p-1">
        {(["original", "metric", "us"] as const).map((u) => (
          <button key={u} type="button" role="radio" aria-checked={value === u} onClick={() => onChange(u)} className={`whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-semibold transition ${value === u ? "bg-container text-ink shadow-sm" : "text-subtle hover:text-ink"}`}>
            {u === "original" ? "As is" : u === "metric" ? "Metric" : "US"}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-sm text-subtle">{UNIT_HINT[value]}</p>
    </div>
  );
}
