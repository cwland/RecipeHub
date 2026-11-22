import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import SettingsPage from "./SettingsPage";
import { SessionContext, type Session } from "../session";
import { fakeServer } from "../test/fakeServer";

const session = (role: "owner" | "member"): Session => ({
  user: { id: 1, username: "alex", displayName: null, email: null, role },
  setUser: () => {},
  replaceToken: () => {},
  signOut: () => {},
  signOutEverywhere: async () => {},
});
const go = (hash: string) => act(() => {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
});

afterEach(() => {
  window.location.hash = "";
});

describe("Settings tabs", () => {
  it("every tab is loaded when Settings opens; switching just shows it (nothing loads again)", async () => {
    // (answers aren't the point here: every request is counted, unknown ones get a 404)
    const server = fakeServer({});
    window.location.hash = "#/settings/profile";
    render(
      <SessionContext.Provider value={session("owner")}>
        <SettingsPage />
      </SessionContext.Provider>
    );
    const panels = screen.getAllByRole("tabpanel", { hidden: true });
    expect(panels.map((p) => p.getAttribute("aria-label"))).toEqual(["Profile", "Recipes", "Household", "Security", "API keys", "Email", "AI", "Data", "Logs"]);
    expect(panels.filter((p) => !p.hidden).map((p) => p.getAttribute("aria-label"))).toEqual(["Profile"]);
    await waitFor(() => expect(server.sent.some((s) => s.path.startsWith("/api/logs"))).toBe(true)); // the Logs tab loaded too
    await new Promise((r) => setTimeout(r, 50));
    const before = server.sent.length;
    go("#/settings/logs");
    expect(screen.getByRole("tabpanel", { name: "Logs" })).toBeVisible();
    const profile = screen.getAllByRole("tabpanel", { hidden: true }).find((p) => p.getAttribute("aria-label") === "Profile")!;
    expect(profile.hidden).toBe(true);
    go("#/settings/profile");
    go("#/settings/ai");
    await new Promise((r) => setTimeout(r, 50));
    expect(server.sent.length).toBe(before);
  });

  it("members only get their tabs", () => {
    fakeServer({});
    window.location.hash = "#/settings/profile";
    render(
      <SessionContext.Provider value={session("member")}>
        <SettingsPage />
      </SessionContext.Provider>
    );
    expect(screen.getAllByRole("tabpanel", { hidden: true }).map((p) => p.getAttribute("aria-label"))).toEqual(["Profile", "Recipes", "Household", "Security"]);
  });
});

describe("where things are", () => {
  it("Cooking and Meal plan email are on the Recipes tab, not Profile", () => {
    fakeServer({});
    window.location.hash = "#/settings/recipes";
    render(
      <SessionContext.Provider value={session("owner")}>
        <SettingsPage />
      </SessionContext.Provider>
    );
    const panel = (name: string) => screen.getAllByRole("tabpanel", { hidden: true }).find((p) => p.getAttribute("aria-label") === name)!;
    expect(within(panel("Recipes")).getByRole("region", { name: "Cooking", hidden: true })).toBeInTheDocument();
    expect(within(panel("Recipes")).getByRole("region", { name: "Meal plan email", hidden: true })).toBeInTheDocument();
    expect(within(panel("Profile")).queryByRole("region", { name: "Cooking", hidden: true })).toBeNull();
    expect(within(panel("Profile")).queryByRole("region", { name: "Meal plan email", hidden: true })).toBeNull();
  });

  it("AI Enhance and Auto nutrition are on the Recipes tab", () => {
    fakeServer({});
    window.location.hash = "#/settings/recipes";
    render(
      <SessionContext.Provider value={session("owner")}>
        <SettingsPage />
      </SessionContext.Provider>
    );
    const panel = screen.getAllByRole("tabpanel", { hidden: true }).find((p) => p.getAttribute("aria-label") === "Recipes")!;
    expect(within(panel).getByRole("region", { name: "AI Enhance", hidden: true })).toBeInTheDocument();
    expect(within(panel).getByRole("region", { name: "Auto nutrition", hidden: true })).toBeInTheDocument();
  });
});
