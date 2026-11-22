import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { api } from "../api";
import { useSession, type User } from "../session";
import { THEMES, applyMode, applyTheme, useTheme, type ColorMode, type Theme } from "../themes";
import { Card, Notice } from "./settingsUi";

// The colors shown next to each theme's name: logo, buttons, accents, links, background
function Swatches({ t }: { t: Theme }) {
  const colors = [t.colors.brand, t.colors.primary, t.colors.action, t.colors.link, t.colors.page];
  return (
    <span className="flex shrink-0 gap-1" aria-hidden>
      {colors.map((c, i) => (
        <span key={i} className="size-5 rounded-md border border-black/10" style={{ background: c }} />
      ))}
    </span>
  );
}

const MODES: { id: ColorMode; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "Match device" },
];

// Settings › Profile › Appearance: a dropdown of themes with their colors, and light/dark mode.
// Picking one applies it right away and saves it with your account (this browser remembers it for
// the sign-in page too).
export default function ThemePicker() {
  const { setUser } = useSession();
  const { theme, mode } = useTheme();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  async function pick(t: Theme) {
    setOpen(false);
    setMsg(null);
    const before = theme.id;
    applyTheme(t.id);
    try {
      setUser(await api<User>("PATCH", "/api/profile", { theme: t.id }));
    } catch (e) {
      applyTheme(before);
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function pickMode(m: ColorMode) {
    setMsg(null);
    const before = mode;
    applyMode(m);
    try {
      setUser(await api<User>("PATCH", "/api/profile", { colorMode: m }));
    } catch (e) {
      applyMode(before);
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <Card title="Appearance" description="The app's colors, light or dark. Your choice is saved with your account.">
      <div role="radiogroup" aria-label="Light or dark" className="mb-4 inline-flex rounded-lg bg-page p-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            onClick={() => pickMode(m.id)}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${mode === m.id ? "bg-container text-ink shadow-sm" : "text-subtle hover:text-ink"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div ref={box} className="relative max-w-md">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Theme: ${theme.name}`} title={`Theme: ${theme.name}`}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-3 rounded border border-muted/50 bg-container px-3 py-2.5 text-left outline-none focus:border-action focus:ring-2 focus:ring-action/15"
        >
          <span className="min-w-0 flex-1 truncate font-medium">{theme.name}</span>
          <Swatches t={theme} />
          <ChevronDown className={`size-4 shrink-0 text-subtle transition ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <ul role="listbox" aria-label="Themes" className="absolute inset-x-0 z-30 mt-1 overflow-hidden rounded-xl bg-container py-1 shadow-[0_8px_28px_rgba(0,0,0,0.16)]">
            {THEMES.map((t) => (
              <li key={t.id} role="option" aria-selected={t.id === theme.id}>
                <button type="button" onClick={() => pick(t)} className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-pressed ${t.id === theme.id ? "bg-pressed" : ""}`}>
                  <span className="w-4 shrink-0 text-action">{t.id === theme.id && <Check className="size-4" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{t.name}</span>
                    <span className="block truncate text-sm text-subtle">{t.description}</span>
                  </span>
                  <Swatches t={t} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {msg && (
        <div className="mt-3">
          <Notice msg={msg} />
        </div>
      )}
    </Card>
  );
}
