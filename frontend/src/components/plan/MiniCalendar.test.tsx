import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MiniCalendar from "./MiniCalendar";

const dayName = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
};

describe("MiniCalendar", () => {
  it("shows the month of the chosen day, with weekday letters from the week start", () => {
    const { unmount } = render(<MiniCalendar value="2026-11-22" onChange={() => {}} weekStart={1} />);
    expect(screen.getByRole("heading", { name: /November 2026/ })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
    unmount();
    render(<MiniCalendar value="2026-11-22" onChange={() => {}} weekStart={0} />);
    expect(screen.getAllByRole("columnheader")[0]).toHaveTextContent("Su");
  });

  it("picking a day calls onChange; the chosen day is pressed", async () => {
    const onChange = vi.fn();
    const u = userEvent.setup();
    render(<MiniCalendar value="2026-11-22" onChange={onChange} weekStart={1} />);
    expect(screen.getByRole("button", { name: dayName("2026-11-22") })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: dayName("2026-11-25") })).toHaveAttribute("aria-pressed", "false");
    await u.click(screen.getByRole("button", { name: dayName("2026-11-25") }));
    expect(onChange).toHaveBeenCalledWith("2026-11-25");
  });

  it("month arrows change the month and report the range shown", async () => {
    const onMonthChange = vi.fn();
    const u = userEvent.setup();
    render(<MiniCalendar value="2026-11-22" onChange={() => {}} weekStart={1} onMonthChange={onMonthChange} />);
    expect(onMonthChange).toHaveBeenLastCalledWith("2026-10-26", "2026-12-06");
    await u.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: /December 2026/ })).toBeInTheDocument();
    expect(onMonthChange).toHaveBeenLastCalledWith("2026-11-30", "2027-01-03");
    await u.click(screen.getByRole("button", { name: "Previous month" }));
    await u.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("heading", { name: /October 2026/ })).toBeInTheDocument();
  });

  it("days with meals planned are named so and show a dot", () => {
    render(<MiniCalendar value="2026-11-22" onChange={() => {}} weekStart={1} marked={new Set(["2026-11-25"])} />);
    const day = screen.getByRole("button", { name: `${dayName("2026-11-25")}, has meals planned` });
    expect(within(day).getByTestId("dot")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: dayName("2026-11-24") })).queryByTestId("dot")).toBeNull();
  });
});
