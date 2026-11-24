import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RecipeView from "../components/recipes/RecipeView";
import CookMode from "../components/recipes/CookMode";
import RecipeEditor from "../components/recipes/RecipeEditor";
import { fakeServer, recipeJson } from "../test/fakeServer";
import { forgetAiStatus } from "../ai";

beforeEach(() => {
  forgetAiStatus();
  sessionStorage.clear();
});
const status = (recipeChat: boolean) => ({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: false, recipeChat }) });

describe("where the chat bubble shows", () => {
  it("on the recipe page when recipe chat is on", async () => {
    fakeServer({ ...status(true), "GET /api/recipes/7": () => recipeJson() });
    render(<RecipeView id={7} />);
    expect(await screen.findByRole("button", { name: "Open recipe chat" })).toBeInTheDocument();
  });

  it("not at all when it's off, and no chat is read", async () => {
    const server = fakeServer({ ...status(false), "GET /api/recipes/7": () => recipeJson() });
    render(<RecipeView id={7} />);
    await screen.findByRole("region", { name: "Ingredients" });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("button", { name: "Open recipe chat" })).not.toBeInTheDocument();
    expect(server.sent.some((s) => s.path.includes("/chat"))).toBe(false);
  });

  it("in Cook mode too", async () => {
    fakeServer({ ...status(true), "GET /api/recipes/7": () => recipeJson(), "GET /api/recipes/7/me": () => ({}) });
    render(<CookMode id={7} />);
    expect(await screen.findByRole("button", { name: "Open recipe chat" })).toBeInTheDocument();
  });
});

describe("a recipe written by the chat", () => {
  it("fills the new-recipe editor", async () => {
    fakeServer({ "GET /api/categories": () => [], "GET /api/collections": () => [], "GET /api/tags": () => [] });
    sessionStorage.setItem(
      "recipehub-chat-draft",
      JSON.stringify({ title: "Weeknight Chili (lighter)", description: null, ingredients: ["1 lb beef", "1 cup Greek yogurt"], steps: ["Brown it.", "Simmer."], servings: 4, yieldText: null, prepMinutes: 10, cookMinutes: null, totalMinutes: null, tags: ["beef"], notes: "Made from Weeknight Chili with recipe chat." })
    );
    window.location.hash = "#/recipes/new?draft=chat";
    render(<RecipeEditor />);
    expect(await screen.findByDisplayValue("Weeknight Chili (lighter)")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/1 cup Greek yogurt/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Made from Weeknight Chili with recipe chat.")).toBeInTheDocument();
    expect(sessionStorage.getItem("recipehub-chat-draft")).toBeNull();
  });
});
