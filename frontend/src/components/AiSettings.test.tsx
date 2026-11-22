import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AiSettings from "./AiSettings";
import { fakeServer } from "../test/fakeServer";

describe("AI services help", () => {
  it("the (i) next to AI services lists what a model needs, and models to try (home and paid)", async () => {
    fakeServer({ "GET /api/settings/ai": () => ({ settings: null }), "GET /api/settings/features": () => ({ ai: true, apiKeys: false, aiEnhance: true }) });
    const u = userEvent.setup();
    render(<AiSettings />);
    const services = await screen.findByRole("region", { name: "AI services" });
    await u.click(within(services).getByRole("button", { name: "Which AI models work with RecipeHub" }));
    const help = await screen.findByRole("dialog", { name: "Which AI models work" });
    // what it must support
    for (const need of [/JSON/, /pictures|photos/i, /thinking|reasoning/i, /context/i]) expect(within(help).getAllByText(need).length).toBeGreaterThan(0);
    // something to try at home, and something paid
    expect(within(help).getByText("qwen3-vl:8b")).toBeInTheDocument();
    expect(within(help).getByText("claude-haiku-5-5")).toBeInTheDocument();
  });
});

describe("AI Enhance and Auto nutrition moved", () => {
  it("aren't on the AI tab any more (they're in Settings › Recipes)", async () => {
    fakeServer({ "GET /api/settings/ai": () => ({ settings: null }), "GET /api/settings/features": () => ({ ai: true, apiKeys: false, aiEnhance: true, autoNutrition: true }) });
    render(<AiSettings />);
    await screen.findByRole("region", { name: "AI services" });
    expect(screen.queryByRole("region", { name: "AI Enhance" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Auto nutrition" })).toBeNull();
  });
});
