import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SavedCopiesSwitch } from "./SavedCopiesSwitch";
import { fakeServer } from "../test/fakeServer";

describe("Saved copies switch (Settings › Recipes)", () => {
  it("explains what it does, and saves right away", async () => {
    const all = { ai: true, apiKeys: false, aiEnhance: true, autoNutrition: true, recipeVersions: true };
    const server = fakeServer({
      "GET /api/settings/features": () => ({ ...all, savedCopies: true }),
      "PUT /api/settings/features": () => ({ ...all, savedCopies: false }),
    });
    const u = userEvent.setup();
    render(<SavedCopiesSwitch />);
    const card = await screen.findByRole("region", { name: "Saved copies" });
    expect(card).toHaveTextContent("Wayback Machine");
    expect(card).toHaveTextContent("archive.ph");
    const sw = within(card).getByRole("switch", { name: "Saved copies" });
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
    await u.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
    expect(server.writes()[0].body).toEqual({ savedCopies: false });
  });
});
