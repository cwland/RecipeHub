import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiEnhanceSwitch, AutoNutritionSwitch } from "./AiRecipeSwitches";
import { fakeServer } from "../test/fakeServer";
import { forgetAiStatus } from "../ai";

// Settings › Recipes: AI Enhance and Auto nutrition (they need AI)
beforeEach(() => forgetAiStatus());
const ready = (r: boolean) => ({ "GET /api/ai/status": () => ({ ready: r, photos: false, enhance: r }) });

describe.each([
  ["AI Enhance", "aiEnhance", AiEnhanceSwitch],
  ["Auto nutrition", "autoNutrition", AutoNutritionSwitch],
] as const)("%s", (title, key, Switch) => {
  it("saves right away", async () => {
    const server = fakeServer({ ...ready(true), "GET /api/settings/features": () => ({ ai: true, [key]: true }), "PUT /api/settings/features": () => ({ ai: true, [key]: false }) });
    const u = userEvent.setup();
    render(<Switch />);
    const sw = within(await screen.findByRole("region", { name: title })).getByRole("switch", { name: title });
    await waitFor(() => expect(sw).toBeEnabled());
    expect(sw).toHaveAttribute("aria-checked", "true");
    await u.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
    expect(server.writes().find((w) => w.path === "/api/settings/features")?.body).toEqual({ [key]: false });
  });

  it("AI off or not set up: can't be changed, and says where to set AI up", async () => {
    fakeServer({ ...ready(false), "GET /api/settings/features": () => ({ ai: false, [key]: true }) });
    render(<Switch />);
    const card = await screen.findByRole("region", { name: title });
    expect(await within(card).findByText(/Needs AI/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Settings › AI/ })).toHaveAttribute("href", "#/settings/ai");
    expect(within(card).getByRole("switch", { name: title })).toBeDisabled();
    expect(within(card).getByRole("switch", { name: title })).toHaveAttribute("aria-checked", "false");
  });
});
