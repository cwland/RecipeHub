import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReminderSettings from "./ReminderSettings";
import HouseholdSettings from "./HouseholdSettings";
import { SessionContext, type User } from "../session";
import { fakeServer } from "../test/fakeServer";

// Things that send email can't be turned on until email is set up (Settings › Email)
const user = { id: 1, username: "alex", displayName: "Alex", email: "alex@example.com", role: "owner", remindAt: null } as User;
const wrap = (el: JSX.Element, u: User = user) => (
  <SessionContext.Provider value={{ user: u, setUser: () => {}, replaceToken: () => {}, signOut: () => {}, signOutEverywhere: async () => {} }}>{el}</SessionContext.Provider>
);
const email = (active: boolean) => ({ "GET /api/settings/email": () => ({ source: active ? "app" : "none", active, linksReady: active, settings: null }) });

describe("Meal plan email needs email set up", () => {
  it("email not set up: the switch can't be turned on, and says where to set it up", async () => {
    fakeServer(email(false));
    render(wrap(<ReminderSettings />));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Meal plan email" })).toBeDisabled());
    expect(screen.getByText(/Email isn't set up yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Settings › Email/ })).toHaveAttribute("href", "#/settings/email");
  });

  it("already on from before: it can still be turned off", async () => {
    fakeServer({ ...email(false), "PUT /api/profile/reminder": () => ({}) });
    render(wrap(<ReminderSettings />, { ...user, remindAt: "17:00" }));
    await screen.findByText(/Email isn't set up yet/);
    expect(screen.getByRole("switch", { name: "Meal plan email" })).toBeEnabled();
  });

  it("email set up: the switch works as before", async () => {
    const s = fakeServer({ ...email(true), "PUT /api/profile/reminder": () => ({}) });
    render(wrap(<ReminderSettings />));
    const sw = screen.getByRole("switch", { name: "Meal plan email" });
    await waitFor(() => expect(s.sent.some((x) => x.path === "/api/settings/email")).toBe(true));
    expect(sw).toBeEnabled();
    expect(screen.queryByText(/Email isn't set up yet/)).toBeNull();
  });
});

describe("Household: Email an invite needs email set up", () => {
  const members = { "GET /api/household/members": () => [{ id: 1, username: "alex", displayName: "Alex", email: "alex@example.com", role: "owner", invited: false }] };
  it("can be picked, but warns and won't send", async () => {
    fakeServer({ ...members, ...email(false) });
    const u = userEvent.setup();
    render(wrap(<HouseholdSettings />));
    await u.click(await screen.findByRole("radio", { name: "Email an invite" }));
    expect(await screen.findByText(/Email isn't set up yet/)).toBeInTheDocument();
    await u.type(screen.getByLabelText("Username"), "sam");
    await u.type(screen.getByLabelText("Email"), "sam@example.com");
    expect(screen.getByRole("button", { name: "Send invite" })).toBeDisabled();
    // Set a password still works
    await u.click(screen.getByRole("radio", { name: "Set a password" }));
    expect(screen.queryByText(/Email isn't set up yet/)).toBeNull();
  });

  it("email set up: no warning", async () => {
    fakeServer({ ...members, ...email(true) });
    const u = userEvent.setup();
    render(wrap(<HouseholdSettings />));
    await u.click(await screen.findByRole("radio", { name: "Email an invite" }));
    await u.type(screen.getByLabelText("Username"), "sam");
    await u.type(screen.getByLabelText("Email"), "sam@example.com");
    await waitFor(() => expect(screen.getByRole("button", { name: "Send invite" })).toBeEnabled());
    expect(screen.queryByText(/Email isn't set up yet/)).toBeNull();
  });
});
