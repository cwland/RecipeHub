import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecipeVersionSwitch } from "./RecipeVersionSwitch";
import { fakeServer } from "../test/fakeServer";

describe("Recipe versioning switch (Settings › Recipes)", () => {
  it("saves right away", async () => {
    const server = fakeServer({
      "GET /api/settings/features": () => ({ ai: true, apiKeys: false, aiEnhance: true, autoNutrition: true, recipeVersions: true }),
      "PUT /api/settings/features": () => ({ ai: true, apiKeys: false, aiEnhance: true, autoNutrition: true, recipeVersions: false }),
    });
    const u = userEvent.setup();
    render(<RecipeVersionSwitch />);
    const card = await screen.findByRole("region", { name: "Recipe versioning" });
    const sw = within(card).getByRole("switch", { name: "Recipe versioning" });
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
    await u.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
    expect(server.writes()[0].body).toEqual({ recipeVersions: false });
  });
});
