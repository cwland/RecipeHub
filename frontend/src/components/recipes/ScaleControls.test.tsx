import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScaleControls } from "./ScaleControls";

const controls = (over: { servings?: number | null; factor?: number } = {}) => {
  const setFactor = vi.fn();
  const setUnits = vi.fn();
  render(<ScaleControls servings={over.servings ?? null} factor={over.factor ?? 1} setFactor={setFactor} units="original" setUnits={setUnits} leans={null} />);
  return { setFactor, setUnits };
};

describe("scaling a recipe", () => {
  it("with a serving count: − 4 servings +", async () => {
    const { setFactor } = controls({ servings: 4 });
    const u = userEvent.setup();
    const group = screen.getByRole("group", { name: "Servings" });
    expect(group).toHaveTextContent("4 servings");
    await u.click(within(group).getByRole("button", { name: "More servings" }));
    expect(setFactor).toHaveBeenCalledWith(1.25);
  });

  it("without one: − 1× + (no row of size buttons)", async () => {
    const { setFactor } = controls({ factor: 1 });
    const u = userEvent.setup();
    const group = screen.getByRole("group", { name: "Recipe size" });
    expect(group).toHaveTextContent("1×");
    expect(screen.queryByRole("radio", { name: "2×" })).toBeNull();
    await u.click(within(group).getByRole("button", { name: "Make more" }));
    expect(setFactor).toHaveBeenLastCalledWith(1.5);
    await u.click(within(group).getByRole("button", { name: "Make less" }));
    expect(setFactor).toHaveBeenLastCalledWith(0.75);
  });

  it("steps through ½×, 1×, 1½×, 2×, 3×…", async () => {
    const { setFactor } = controls({ factor: 2 });
    const u = userEvent.setup();
    const group = screen.getByRole("group", { name: "Recipe size" });
    expect(group).toHaveTextContent("2×");
    await u.click(within(group).getByRole("button", { name: "Make more" }));
    expect(setFactor).toHaveBeenLastCalledWith(2.5);
    await u.click(within(group).getByRole("button", { name: "Make less" }));
    expect(setFactor).toHaveBeenLastCalledWith(1.5);
  });

  it("scaled: a small reset icon (with hover text) puts it back", async () => {
    const { setFactor } = controls({ factor: 2 });
    const u = userEvent.setup();
    const reset = screen.getByRole("button", { name: "Back to the recipe's amounts" });
    expect(reset).toHaveAttribute("title", "Back to the recipe's amounts");
    expect(reset).not.toHaveTextContent("Reset");
    await u.click(reset);
    expect(setFactor).toHaveBeenCalledWith(1);
  });

  it("not scaled: no reset, but its space is kept so the units don't move", () => {
    controls({ factor: 1 });
    expect(screen.queryByRole("button", { name: "Back to the recipe's amounts" })).toBeNull();
    expect(screen.getByTestId("reset-slot")).toBeInTheDocument();
  });
});

describe("units", () => {
  it("As is, Metric, US: in the same row as the servings (the row only wraps on very narrow phones)", () => {
    render(<ScaleControls servings={4} factor={1} setFactor={() => {}} units="original" setUnits={() => {}} leans="us" />);
    const units = screen.getByRole("radiogroup", { name: "Units" });
    expect(within(units).getAllByRole("radio").map((b) => b.textContent)).toEqual(["As is", "Metric", "US"]);
    expect(within(units).getByRole("radio", { name: "As is" })).toHaveAttribute("title", "As is (US)");
    expect(units.parentElement).toBe(screen.getByRole("group", { name: "Servings" }).parentElement);
  });
});
