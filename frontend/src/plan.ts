// Meal plan shapes and date helpers (dates are local calendar days, "YYYY-MM-DD")

export interface PlanEntry {
  id: number;
  date: string;
  slot: string;
  position: number;
  recipeId: number | null;
  title: string;
  servings: number | null;
  note: string | null;
  imageUrl: string | null;
  totalMinutes: number | null;
  recipeServings: number | null;
}

export interface PlannerSettings {
  slots: { id: string; name: string }[];
  weekStart: 0 | 1;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDay = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (s: string, n: number) => {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return isoDay(d);
};
export const today = () => isoDay(new Date());

// The first day of the week that holds this day
export function weekOf(day: string, weekStart: 0 | 1) {
  const d = parseDay(day);
  const back = (d.getDay() - weekStart + 7) % 7;
  return addDays(day, -back);
}

// "Nov 2 – 8, 2026" / "Dec 28 – Jan 3, 2027"
export function weekLabel(start: string) {
  const a = parseDay(start);
  const b = parseDay(addDays(start, 6));
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: "short" });
  return a.getMonth() === b.getMonth() ? `${month(a)} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}` : `${month(a)} ${a.getDate()} – ${month(b)} ${b.getDate()}, ${b.getFullYear()}`;
}

export const dayName = (s: string, style: "short" | "long" = "short") => parseDay(s).toLocaleDateString(undefined, { weekday: style });
