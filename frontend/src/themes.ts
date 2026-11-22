import { useEffect, useState } from "react";

// Color themes and light/dark mode (Settings › Profile › Appearance). A theme sets the color
// tokens from index.css (--color-*); dark mode swaps the neutrals (page, cards, lines, text) for
// dark ones and keeps the theme's accent colors. Both are saved with your account and remembered
// in this browser, so the sign-in page uses them too.

export type ThemeId = "fresh" | "harbor" | "terracotta-sage" | "slate-rose" | "midnight-coral";
export type ColorMode = "light" | "dark" | "system";

export interface Theme {
  id: ThemeId;
  name: string;
  description: string;
  colors: Record<string, string>; // --color-<name> (light mode)
}

export const THEMES: Theme[] = [
  {
    id: "fresh",
    name: "Fresh",
    description: "Fresh green on clean white, with dark slate",
    colors: { page: "#f5f7f6", container: "#ffffff", line: "#e4e9e6", strong: "#cfd8d3", brand: "#20b35b", "brand-subtle": "#e3f6ea", success: "#1f9d55", "success-subtle": "#dcf5e5", error: "#d1433b", "error-subtle": "#fde2df", warning: "#f2a20c", pressed: "#eaf5ee", active: "#d5efdf", primary: "#1e2b33", "primary-pressed": "#121b21", action: "#138a45", link: "#11853f", ink: "#1a2329", subtle: "#46545c", muted: "#66747b", inactive: "#8f9ca2" },
  },
  {
    id: "harbor",
    name: "Harbor",
    description: "Deep teal with a bright teal logo",
    colors: { page: "#f4f7f7", container: "#ffffff", line: "#e3eaea", strong: "#cfd9d9", brand: "#14a3a0", "brand-subtle": "#e2f5f4", success: "#1f9d55", "success-subtle": "#dcf5e5", error: "#d1433b", "error-subtle": "#fde2df", warning: "#f2a20c", pressed: "#e8f4f4", active: "#d2eeee", primary: "#0d3b45", "primary-pressed": "#082a31", action: "#0b7a85", link: "#0b8fa0", ink: "#1b2629", subtle: "#47575b", muted: "#66777b", inactive: "#8fa0a3" },
  },
  {
    id: "terracotta-sage",
    name: "Terracotta & Sage",
    description: "Espresso brown, terracotta and a sage logo",
    colors: { page: "#f8f5f2", container: "#ffffff", line: "#ece5de", strong: "#ddd2c7", brand: "#6f9f7c", "brand-subtle": "#e7f1ea", success: "#3f8f5a", "success-subtle": "#e0f1e5", error: "#c23b2e", "error-subtle": "#f9e0dc", warning: "#e09a1f", pressed: "#f5ece4", active: "#f0dfd1", primary: "#3e2a22", "primary-pressed": "#2b1d17", action: "#b4532a", link: "#c2410c", ink: "#2a211d", subtle: "#5b4d46", muted: "#7a6c64", inactive: "#a1948c" },
  },
  {
    id: "slate-rose",
    name: "Slate & Rose",
    description: "Cool slate, rose pink and a rose logo",
    colors: { page: "#f5f6f8", container: "#ffffff", line: "#e5e7ec", strong: "#d1d5dd", brand: "#f43f5e", "brand-subtle": "#ffe4e8", success: "#16a34a", "success-subtle": "#dcfce7", error: "#dc2626", "error-subtle": "#fee2e2", warning: "#f59e0b", pressed: "#f1f2f6", active: "#fde4ea", primary: "#2b2d42", "primary-pressed": "#1c1d2c", action: "#be185d", link: "#db2777", ink: "#1f2130", subtle: "#4b4f63", muted: "#6b7083", inactive: "#9a9eae" },
  },
  {
    id: "midnight-coral",
    name: "Midnight & Coral",
    description: "Midnight indigo, violet and a coral logo",
    colors: { page: "#f5f6fa", container: "#ffffff", line: "#e6e8f0", strong: "#d3d7e3", brand: "#ff6b57", "brand-subtle": "#ffeae6", success: "#1a9e5c", "success-subtle": "#dcf6e7", error: "#d23c3c", "error-subtle": "#fde1e1", warning: "#f5a524", pressed: "#eef0fb", active: "#dfe3fb", primary: "#1e1b4b", "primary-pressed": "#13113a", action: "#4338ca", link: "#4f46e5", ink: "#1c1d29", subtle: "#4a4d61", muted: "#6b6f85", inactive: "#9295a8" },
  },
];

export const DEFAULT_THEME: ThemeId = "fresh";
export const themeById = (id: string | null | undefined) => THEMES.find((t) => t.id === id) ?? THEMES[0];

// ---------- dark mode ----------

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
// a mixed with b: amount of a (0-1)
const mix = (a: string, b: string, amount: number) => {
  const [x, y] = [hex(a), hex(b)];
  return toHex(x.map((v, i) => v * amount + y[i] * (1 - amount)));
};

// Dark neutrals with a hint of the theme's accent; accents brightened so they read on dark cards
export function darkColors(t: Theme): Record<string, string> {
  const c = t.colors;
  const card = mix(c.action, "#151b1f", 0.06);
  return {
    ...c,
    page: mix(c.action, "#0d1215", 0.05),
    container: card,
    line: mix(c.action, "#242e33", 0.08),
    strong: mix(c.action, "#34414a", 0.1),
    ink: "#e8eef0",
    subtle: "#b4c0c4",
    muted: "#8c9a9e",
    inactive: "#66767b",
    brand: mix(c.brand, "#ffffff", 0.9),
    "brand-subtle": mix(c.brand, card, 0.2),
    action: mix(c.action, "#ffffff", 0.78),
    link: mix(c.link, "#ffffff", 0.7),
    primary: mix(c.action, "#000000", 0.85),
    "primary-pressed": mix(c.action, "#000000", 0.7),
    pressed: mix(c.action, card, 0.16),
    active: mix(c.action, card, 0.26),
    "success-subtle": mix(c.success, card, 0.22),
    "error-subtle": mix(c.error, card, 0.22),
    error: mix(c.error, "#ffffff", 0.8),
    success: mix(c.success, "#ffffff", 0.82),
  };
}

// ---------- applying ----------

const STORE_KEY = "recipehub-theme";
const MODE_KEY = "recipehub-mode";
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private window: just this visit */
  }
};

const isMode = (m: string | null | undefined): m is ColorMode => m === "light" || m === "dark" || m === "system";
let current: Theme = themeById(read(STORE_KEY));
let mode: ColorMode = isMode(read(MODE_KEY)) ? (read(MODE_KEY) as ColorMode) : "system";
const listeners = new Set<() => void>();
const systemDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
export const isDark = () => mode === "dark" || (mode === "system" && systemDark());

// The RecipeHub mark: a rounded square with a white leaf
export function logoSvg(brand: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${brand}"/><path d="M9 23c0-8 5.5-13.5 14-14 .4 8.6-5 14-13 14z" fill="#fff"/><path d="M10 22.5 18 14" stroke="${brand}" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}

function paint() {
  const dark = isDark();
  const colors = dark ? darkColors(current) : current.colors;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(colors)) root.style.setProperty(`--color-${k}`, v);
  root.dataset.mode = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", colors.page);
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = `data:image/svg+xml,${encodeURIComponent(logoSvg(current.colors.brand))}`;
  listeners.forEach((l) => l());
}

/** Use a theme now (and remember it in this browser). */
export function applyTheme(id: string | null | undefined) {
  current = themeById(id);
  write(STORE_KEY, current.id);
  paint();
}

/** Light, dark, or follow the device. */
export function applyMode(m: string | null | undefined) {
  mode = isMode(m) ? m : "system";
  write(MODE_KEY, mode);
  paint();
}

if (typeof matchMedia === "function") matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => mode === "system" && paint());

export const currentTheme = () => current;

/** The theme and mode in use; re-renders when either changes. */
export function useTheme() {
  const snap = () => ({ theme: current, mode, dark: isDark() });
  const [s, setS] = useState(snap);
  useEffect(() => {
    const l = () => setS(snap());
    listeners.add(l);
    l();
    return () => void listeners.delete(l);
  }, []);
  return s;
}
