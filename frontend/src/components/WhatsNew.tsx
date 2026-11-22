import { useState, type ReactNode } from "react";
import { CHANGELOG, isNewer, type Release } from "../changelog";
import { APP_VERSION } from "../version";
import { Popup } from "./Popup";
import { AddedIcon, ChangedIcon, ChevronRight, FixedIcon, WhatsNewIcon } from "./Icons";

const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const countOf = (r: Release) => (r.changes?.length ?? 0) + (r.added?.length ?? 0) + (r.changed?.length ?? 0) + (r.fixed?.length ?? 0);

// "What's new". Up top, as cards: the versions since the one you last dismissed (after an update),
// or just this one. Every other released version is folded under Earlier updates (› opens it).
export default function WhatsNew({ since, releases = CHANGELOG, current = APP_VERSION, onClose }: { since?: string | null; all?: boolean; releases?: Release[]; current?: string; onClose: () => void }) {
  const released = releases.filter((r) => !isNewer(r.version, current));
  const fresh = since ? released.filter((r) => isNewer(r.version, since)) : [];
  const top = fresh.length ? fresh : released.slice(0, 1);
  const earlier = released.slice(top.length);
  const now = released.find((r) => r.version === current) ?? released[0];

  const heading = (
    <div className="flex w-full items-center gap-3 text-left">
      <WhatsNewIcon className="size-8 shrink-0 text-warning" />
      <div className="min-w-0">
        <h2 className="text-xl font-bold">What's new</h2>
        <p className="text-sm text-subtle">
          RecipeHub v{current}
          {now && ` · ${shortDate(now.date)}`}
        </p>
      </div>
    </div>
  );

  return (
    <Popup title="What's new" heading={heading} wide onClose={onClose}>
      <div className="flex flex-col gap-4 px-4 py-5 sm:px-6">
        {top.map((r) => (
          <section key={r.version} aria-label={`Version ${r.version}`} className={`rounded-2xl border p-4 sm:p-6 ${r.version === current ? "border-warning/40 bg-warning/5" : "border-line bg-page"}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="text-2xl font-bold tabular-nums">v{r.version}</h3>
              {r.version === current && <span className="rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-warning">Current version</span>}
              <span className="ml-auto text-sm text-subtle">{shortDate(r.date)}</span>
            </div>
            {r.title && <p className="mt-1 text-lg font-semibold">{r.title}</p>}
            <Notes r={r} />
          </section>
        ))}

        {earlier.length > 0 && (
          <section aria-label="Earlier updates" className="mt-2">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">Earlier updates</h3>
            <ul className="mt-2 flex flex-col">
              {earlier.map((r) => (
                <Earlier key={r.version} r={r} />
              ))}
            </ul>
          </section>
        )}

        <div className="flex justify-end border-t border-line pt-4">
          <button type="button" onClick={onClose} className="rounded bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-pressed">
            Got it
          </button>
        </div>
      </div>
    </Popup>
  );
}

// One earlier version: a row (› v1.3.1 Title … 2 changes · Nov 18, 2026) that opens its notes
function Earlier({ r }: { r: Release }) {
  const [open, setOpen] = useState(false);
  const n = countOf(r);
  return (
    <li className="border-b border-line last:border-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-pressed">
        <ChevronRight className={`size-4 shrink-0 text-subtle transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="shrink-0 font-semibold tabular-nums">v{r.version}</span>
        {/* phones: the count and date go under the title, so the title has room */}
        <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3">
          <span className="min-w-0 flex-1 truncate text-subtle">{r.title}</span>
          <span className="shrink-0 text-xs text-muted sm:text-sm">
            {n} change{n === 1 ? "" : "s"} · {shortDate(r.date)}
          </span>
        </span>
      </button>
      {open && (
        <div className="pb-4 pl-9 pr-2">
          <Notes r={r} />
        </div>
      )}
    </li>
  );
}

const KINDS = [
  { key: "added", label: "Added", Icon: AddedIcon, color: "text-success" },
  { key: "changed", label: "Changed", Icon: ChangedIcon, color: "text-action" },
  { key: "fixed", label: "Fixed", Icon: FixedIcon, color: "text-warning" },
] as const;

// A version's changes: plain bullets, then Added / Changed / Fixed sections when it has them
function Notes({ r }: { r: Release }) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      {!!r.changes?.length && <Bullets label="Changes" items={r.changes} />}
      {KINDS.map(({ key, label, Icon, color }) =>
        r[key]?.length ? (
          <div key={key}>
            <p className={`flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide ${color}`}>
              <Icon /> {label}
            </p>
            <Bullets label={label} items={r[key]!} />
          </div>
        ) : null,
      )}
    </div>
  );
}

function Bullets({ label, items }: { label: string; items: string[] }) {
  return (
    <ul aria-label={label} className="mt-1 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
      {items.map((c) => (
        <li key={c}>{withBold(c)}</li>
      ))}
    </ul>
  );
}

// **text** shows bold (a change's lead)
function withBold(text: string): ReactNode {
  return text.split(/\*\*(.+?)\*\*/).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
}
