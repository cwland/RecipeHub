import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdatesSettings } from "./UpdateBar";
import { fakeServer } from "../test/fakeServer";

// Settings › Data › Updates: how often to look for a new version
const info = (over: object = {}) => ({ enabled: true, every: "day", latest: null, checkedAt: null, error: null, dismissed: null, repo: "cwland/RecipeHub", ...over });

describe("Updates: how often", () => {
  it("every day to start with; the choices are hour, 6 hours, day, week, month, never", async () => {
    fakeServer({ "GET /api/updates": () => info() });
    render(<UpdatesSettings />);
    const pick = await screen.findByRole("combobox", { name: "Check for updates" });
    expect(pick).toHaveValue("day");
    expect([...(pick as HTMLSelectElement).options].map((o) => o.text)).toEqual(["Every hour", "Every 6 hours", "Every day", "Every week", "Every month", "Never"]);
  });

  it("a choice saves straight away; Never hides Check now", async () => {
    const s = fakeServer({ "GET /api/updates": () => info(), "PUT /api/updates/settings": (b: any) => info({ every: b.every, enabled: b.every !== "never" }) });
    const u = userEvent.setup();
    render(<UpdatesSettings />);
    const pick = await screen.findByRole("combobox", { name: "Check for updates" });
    await u.selectOptions(pick, "week");
    await waitFor(() => expect(s.writes().at(-1)?.body).toEqual({ every: "week" }));
    expect(screen.getByRole("button", { name: "Check now" })).toBeInTheDocument();
    await u.selectOptions(pick, "never");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Check now" })).toBeNull());
  });
});
