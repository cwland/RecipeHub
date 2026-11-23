import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddToPlanDialog from "./AddToPlanDialog";
import { fakeServer } from "../../test/fakeServer";

const dayName = (iso: string, planned = false) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) + (planned ? ", has meals planned" : "");
};
const entry = (date: string, slot: string) => ({ id: 1, date, slot, position: 0, recipeId: 3, title: "Tacos", servings: null, note: null, imageUrl: null, totalMinutes: null, recipeServings: 4 });
const settings = { slots: [{ id: "breakfast", name: "Breakfast" }, { id: "lunch", name: "Lunch" }, { id: "dinner", name: "Dinner" }, { id: "snack", name: "Snack" }], weekStart: 1 };
const routes = (post: (b: any) => unknown = (b) => ({ status: 201, json: { ...entry(b.date, b.slot), id: 9, recipeId: 7 } })) => ({
  "GET /api/plan/settings": () => settings,
  "GET /api/plan": () => [entry("2026-11-25", "dinner"), entry("2026-12-02", "lunch")],
  "POST /api/plan": post,
});
const posts = (s: ReturnType<typeof fakeServer>) => s.writes().filter((w) => w.path === "/api/plan");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 22, 12));
});
afterEach(() => vi.useRealTimers());

describe("Add to meal plan popup", () => {
  it("offers the household's meals, none chosen; Add waits for a meal", async () => {
    fakeServer(routes());
    render(<AddToPlanDialog recipeId={7} onClose={() => {}} />);
    const radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Breakfast", "Lunch", "Dinner", "Snack"]);
    radios.forEach((r) => expect(r).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByRole("button", { name: dayName("2026-11-22") })).toHaveAttribute("aria-pressed", "true");
  });

  it("days with meals already planned get a dot, including days from the next month shown in the grid", async () => {
    const s = fakeServer(routes());
    render(<AddToPlanDialog recipeId={7} onClose={() => {}} />);
    expect(await screen.findByRole("button", { name: dayName("2026-11-25", true) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: dayName("2026-12-02", true) })).toBeInTheDocument();
    expect(s.sent.some((x) => x.method === "GET" && x.path === "/api/plan?from=2026-10-26&to=2026-12-06")).toBe(true);
  });

  it("adds the recipe on the chosen day and meal, then says where it went", async () => {
    const s = fakeServer(routes());
    const onClose = vi.fn();
    const u = userEvent.setup();
    render(<AddToPlanDialog recipeId={7} onClose={onClose} />);
    await u.click(await screen.findByRole("button", { name: dayName("2026-11-25", true) }));
    await u.click(screen.getByRole("radio", { name: "Dinner" }));
    await u.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText(/Added to Wed, Nov 25 · Dinner/)).toBeInTheDocument();
    expect(posts(s)[0].body).toEqual({ date: "2026-11-25", slot: "dinner", recipeId: 7 });
    expect(screen.getByRole("link", { name: "Open planner" })).toHaveAttribute("href", "#/plan?week=2026-11-25");
    await u.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("a scaled recipe keeps its servings on the plan", async () => {
    const s = fakeServer(routes());
    const u = userEvent.setup();
    render(<AddToPlanDialog recipeId={7} servings={8} onClose={() => {}} />);
    await u.click(await screen.findByRole("radio", { name: "Lunch" }));
    await u.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0].body).toEqual({ date: "2026-11-22", slot: "lunch", recipeId: 7, servings: 8 });
  });

  it("shows the server's error and lets you try again", async () => {
    fakeServer(routes(() => ({ status: 400, json: { error: 'There\'s no "brunch" meal slot' } })));
    const u = userEvent.setup();
    render(<AddToPlanDialog recipeId={7} onClose={() => {}} />);
    await u.click(await screen.findByRole("radio", { name: "Breakfast" }));
    await u.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('There\'s no "brunch" meal slot');
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("a slow answer for a month you've moved past doesn't overwrite the dots", async () => {
    const waiting: Record<string, (v: unknown) => void> = {};
    fakeServer({
      ...routes(),
      "GET /api/plan": (_b: unknown, path: string) =>
        path.includes("from=2026-11-30") ? new Promise((res) => (waiting.dec = res)) : path.includes("from=2026-12-28") ? [entry("2027-01-15", "dinner")] : [],
    });
    const u = userEvent.setup();
    render(<AddToPlanDialog recipeId={7} onClose={() => {}} />);
    await u.click(await screen.findByRole("button", { name: "Next month" }));
    await u.click(screen.getByRole("button", { name: "Next month" }));
    expect(await screen.findByRole("button", { name: dayName("2027-01-15", true) })).toBeInTheDocument();
    waiting.dec([entry("2026-12-30", "dinner")]);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("button", { name: dayName("2027-01-15", true) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: dayName("2026-12-30") })).toBeInTheDocument();
  });
});
