import { describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppShell from "./AppShell";
import { SessionContext, type User } from "../session";
import { fakeServer } from "../test/fakeServer";
import { rememberList } from "../recipes";

// The navigation: Discover is a page of its own. On phones the bottom bar has room for six, so
// Settings moves into the Account menu there.
const user: User = { id: 1, username: "alex", displayName: "Alex", email: "alex@example.com", role: "owner", seenVersion: "99.0.0", setupDone: true };
const shell = (who: User = user) => {
  fakeServer({ "GET /api/recipes": () => ({ total: 0, recipes: [] }), "GET /api/inbox/count": () => ({ pending: 0 }), "GET /api/imports/active": () => [] });
  window.location.hash = "#/recipes";
  render(
    <SessionContext.Provider value={{ user: who, setUser: vi.fn(), replaceToken: vi.fn(), signOut: vi.fn(), signOutEverywhere: vi.fn() }}>
      <AppShell />
    </SessionContext.Provider>
  );
};
const navs = () => screen.getAllByRole("navigation").filter((n) => within(n).queryByRole("link", { name: "Recipes" }));

describe("the navigation", () => {
  it("the left bar: Recipes, Discover, Meal plan, Grocery, Pantry, Settings", () => {
    shell();
    const [rail] = navs();
    expect(within(rail).getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual(["Recipes", "Discover", "Meal plan", "Grocery", "Pantry", "Settings"]);
    expect(within(rail).getByRole("link", { name: "Discover" })).toHaveAttribute("href", "#/discover");
  });

  it("Recipes goes back to the list as you left it (a tag still on), in both bars", () => {
    shell();
    rememberList("#/recipes?tag=beef");
    act(() => {
      window.location.hash = "#/discover";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    for (const nav of navs()) expect(within(nav).getByRole("link", { name: "Recipes" })).toHaveAttribute("href", "#/recipes?tag=beef");
    rememberList("#/recipes");
  });

  it("the phone's bottom bar: Discover in, Settings in the Account menu instead", async () => {
    shell();
    const bar = navs()[1];
    expect(within(bar).getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual(["Recipes", "Discover", "Meal plan", "Grocery", "Pantry"]);
    await userEvent.setup().click(within(bar).getByRole("button", { name: /Account menu/ }));
    expect(within(screen.getByRole("menu", { name: "Account" })).getByRole("menuitem", { name: /Settings/ })).toHaveAttribute("href", "#/settings");
  });
});

describe("What's new", () => {
  it("shows for someone who hasn't seen this version", async () => {
    shell({ ...user, seenVersion: "0.0.1" });
    expect(await screen.findByRole("dialog", { name: /What's new/ })).toBeInTheDocument();
  });

  it("not while the setup wizard is open (a new account): the wizard marks this version seen", () => {
    shell({ ...user, seenVersion: null, setupDone: false });
    expect(screen.queryByRole("dialog", { name: /What's new/ })).toBeNull();
  });
});
