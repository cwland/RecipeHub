import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PublicLinksSwitch } from "./PublicLinksSwitch";
import { fakeServer } from "../test/fakeServer";

describe("Public share links switch (Settings › Recipes)", () => {
  it("saves right away", async () => {
    const all = { ai: true, apiKeys: false, aiEnhance: true, autoNutrition: true, recipeVersions: true, savedCopies: true };
    const server = fakeServer({ "GET /api/settings/features": () => ({ ...all, publicLinks: true }), "PUT /api/settings/features": () => ({ ...all, publicLinks: false }) });
    const u = userEvent.setup();
    render(<PublicLinksSwitch />);
    const card = await screen.findByRole("region", { name: "Public share links" });
    const sw = within(card).getByRole("switch", { name: "Public share links" });
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
    await u.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
    expect(server.writes()[0].body).toEqual({ publicLinks: false });
  });
});
