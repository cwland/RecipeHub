import { useEffect, useMemo, useState } from "react";
import { isoDay, monthGrid, monthLabel, parseDay, today, weekdayLetters } from "../../plan";
import { ChevronLeft, ChevronRight } from "../Icons";

// A small month calendar for picking a day. Days in `marked` (meals already planned) get a dot.
// onMonthChange reports the first and last day shown, so the caller can load what's planned.
export default function MiniCalendar({ value, onChange, weekStart, marked, onMonthChange }: { value: string; onChange: (day: string) => void; weekStart: 0 | 1; marked?: Set<string>; onMonthChange?: (from: string, to: string) => void }) {
  const [month, setMonth] = useState(`${value.slice(0, 7)}-01`);
  const weeks = useMemo(() => monthGrid(month, weekStart), [month, weekStart]);
  const from = weeks[0][0];
  const to = weeks[weeks.length - 1][6];
  useEffect(() => onMonthChange?.(from, to), [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (n: number) => {
    const d = parseDay(month);
    d.setMonth(d.getMonth() + n);
    setMonth(isoDay(d));
  };
  const now = today();
  const arrow = "flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-pressed hover:text-ink";
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="Previous month" title="Previous month" onClick={() => step(-1)} className={arrow}>
          <ChevronLeft />
        </button>
        <h3 className="font-bold">{monthLabel(month)}</h3>
        <button type="button" aria-label="Next month" title="Next month" onClick={() => step(1)} className={arrow}>
          <ChevronRight />
        </button>
      </div>
      <table className="w-full table-fixed text-center">
        <thead>
          <tr>
            {weekdayLetters(weekStart).map((l) => (
              <th key={l} scope="col" className="pb-1 text-xs font-semibold text-subtle">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w[0]}>
              {w.map((day) => {
                const selected = day === value;
                const outside = day.slice(0, 7) !== month.slice(0, 7);
                const busy = marked?.has(day) ?? false;
                const name = parseDay(day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) + (busy ? ", has meals planned" : "");
                return (
                  <td key={day} className="p-0.5">
                    <button
                      type="button"
                      aria-label={name}
                      aria-pressed={selected}
                      aria-current={day === now ? "date" : undefined}
                      onClick={() => onChange(day)}
                      className={`relative mx-auto flex size-9 items-center justify-center rounded-full text-sm ${selected ? "bg-primary font-bold text-white" : `hover:bg-pressed ${outside ? "text-subtle/60" : ""}`} ${day === now && !selected ? "ring-2 ring-primary" : ""}`}
                    >
                      {parseDay(day).getDate()}
                      {busy && <span data-testid="dot" aria-hidden="true" className={`absolute bottom-1 size-1 rounded-full ${selected ? "bg-white" : "bg-action"}`} />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
