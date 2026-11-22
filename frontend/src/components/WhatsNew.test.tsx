import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WhatsNew from "./WhatsNew";
import type { Release } from "../changelog";

// The window: the newest version(s) as cards up top, older ones folded under Earlier updates (> to open)
const releases: Release[] = [
  { version: "2.0.0", date: "2026-11-20", title: "Tiles on Discover", added: ["**Tiles across on Discover.** Pick 2 to 6."], fixed: ["Cards no longer cut off titles."] },
  { version: "1.9.0", date: "2026-11-18", title: "Servings first", changes: ["Asks for servings.", "Nutrition per serving."] },
  { version: "1.8.0", date: "2026-11-10", title: "Older one", changes: ["Something old."] },
];
const open = (props: Partial<Parameters<typeof WhatsNew>[0]> = {}) => render(<WhatsNew releases={releases} current="2.0.0" onClose={vi.fn()} {...props} />);

describe("What's new", () => {
  it("says the version and date at the top", () => {
    open();
    expect(screen.getByRole("dialog", { name: "What's new" })).toHaveTextContent(/RecipeHub v2\.0\.0 · Nov 20, 2026/);
  });

  it("the current version is a card: badge, title, date, and its changes under Added and Fixed", () => {
    open();
    const card = screen.getByRole("region", { name: "Version 2.0.0" });
    expect(within(card).getByText("Current version")).toBeInTheDocument();
    expect(card).toHaveTextContent("Tiles on Discover");
    expect(card).toHaveTextContent("Nov 20, 2026");
    expect(within(within(card).getByRole("list", { name: "Added" })).getAllByRole("listitem")).toHaveLength(1);
    expect(within(card).getByRole("list", { name: "Fixed" })).toHaveTextContent("Cards no longer cut off titles.");
    // **…** is the change's bold lead
    expect(within(card).getByText("Tiles across on Discover.").tagName).toBe("STRONG");
  });

  it("older versions are folded under Earlier updates, with how many changes; > opens one", async () => {
    const u = userEvent.setup();
    open();
    const earlier = screen.getByRole("region", { name: "Earlier updates" });
    const row = within(earlier).getByRole("button", { name: /v1\.9\.0.*Servings first/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(row).toHaveTextContent(/2 changes · Nov 18, 2026/);
    expect(within(earlier).getByRole("button", { name: /v1\.8\.0/ })).toHaveTextContent("1 change ·");
    expect(screen.queryByText("Asks for servings.")).toBeNull();
    await u.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Asks for servings.")).toBeVisible();
    await u.click(row);
    expect(screen.queryByText("Asks for servings.")).toBeNull();
  });

  it("after an update from an older version, every version you missed is a card", () => {
    open({ since: "1.8.0" });
    expect(screen.getByRole("region", { name: "Version 2.0.0" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Version 1.9.0" })).not.toHaveTextContent("Current version");
    expect(within(screen.getByRole("region", { name: "Earlier updates" })).getAllByRole("button")).toHaveLength(1);
  });

  it("versions not released yet don't show", () => {
    open({ current: "1.9.0" });
    expect(screen.queryByText(/v2\.0\.0/)).toBeNull();
    expect(screen.getByRole("region", { name: "Version 1.9.0" })).toHaveTextContent("Current version");
  });
});
