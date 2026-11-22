import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CookingPrefs from "./CookingPrefs";
import { SessionContext, type User } from "../session";
import { fakeServer } from "../test/fakeServer";

// Settings › Profile › Cooking: measurements and keeping the screen awake, saved as you change them
const user = { id: 1, username: "alex", displayName: "Alex", email: null, role: "owner", units: "original", keepAwake: true } as User;

describe("cooking preferences", () => {
  it("measurements and Keep the screen awake save straight away", async () => {
    const s = fakeServer({ "PATCH /api/profile": (b: any) => ({ ...user, ...b }) });
    const setUser = vi.fn();
    const u = userEvent.setup();
    render(
      <SessionContext.Provider value={{ user, setUser, replaceToken: () => {}, signOut: () => {}, signOutEverywhere: async () => {} }}>
        <CookingPrefs />
      </SessionContext.Provider>,
    );
    await u.click(screen.getByRole("radio", { name: /Metric/ }));
    await waitFor(() => expect(s.writes().at(-1)).toMatchObject({ path: "/api/profile", body: { units: "metric" } }));
    await u.click(screen.getByRole("switch", { name: /Keep the screen awake/ }));
    await waitFor(() => expect(s.writes().at(-1)?.body).toEqual({ keepAwake: false }));
    expect(setUser).toHaveBeenLastCalledWith(expect.objectContaining({ keepAwake: false }));
  });

  it("Sort ingredients A to Z: off by default, saves straight away", async () => {
    const s = fakeServer({ "PATCH /api/profile": (b: any) => ({ ...user, ...b }) });
    const u = userEvent.setup();
    render(
      <SessionContext.Provider value={{ user, setUser: () => {}, replaceToken: () => {}, signOut: () => {}, signOutEverywhere: async () => {} }}>
        <CookingPrefs />
      </SessionContext.Provider>,
    );
    const sw = screen.getByRole("switch", { name: /Sort ingredients A to Z/ });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await u.click(sw);
    await waitFor(() => expect(s.writes().at(-1)?.body).toEqual({ ingredientOrder: "alpha" }));
  });

  it("Measurements is its own section: As is / Metric / US pills, As is to start with", () => {
    fakeServer({});
    render(
      <SessionContext.Provider value={{ user: { ...user, units: undefined }, setUser: () => {}, replaceToken: () => {}, signOut: () => {}, signOutEverywhere: async () => {} }}>
        <CookingPrefs />
      </SessionContext.Provider>,
    );
    const m = screen.getByRole("region", { name: "Measurements" });
    expect(within(m).getAllByRole("radio").map((r) => r.textContent)).toEqual(["As is", "Metric", "US"]);
    expect(within(m).getByRole("radio", { name: "As is" })).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByRole("region", { name: "Cooking" })).queryByRole("radio")).toBeNull();
  });
});
