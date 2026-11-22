import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecipesPage from "./RecipesPage";
import { fakeServer, recipeJson } from "../../test/fakeServer";

const summary = (id: number, title: string) => ({ id, title, imageUrl: null, totalMinutes: null, rating: null, favorite: false, pinned: false, tags: [], categories: [] });
const many = Array.from({ length: 40 }, (_, i) => summary(i + 1, `Recipe ${i + 1}`));

// jsdom doesn't scroll: keep a pretend scroll position that scrollTo sets and scroll events report
let y = 0;
let server: ReturnType<typeof fakeServer>;
const scrollTo = vi.fn((a: number | ScrollToOptions, b?: number) => {
  y = typeof a === "number" ? (b ?? 0) : (a.top ?? 0);
});
const scrollBy = (to: number) => {
  y = to;
  window.dispatchEvent(new Event("scroll"));
};
const go = async (hash: string) => {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
};

beforeEach(() => {
  y = 0;
  scrollTo.mockClear();
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  server = fakeServer({
    "GET /api/tags": () => [{ id: 1, name: "beef", count: 3 }],
    "GET /api/categories": () => [],
    "GET /api/collections": () => [],
    "GET /api/ai/status": () => ({ ready: false, photos: false, enhance: false }),
    "GET /api/recipes/7": () => recipeJson(),
    "GET /api/recipes": () => ({ total: 40, recipes: many }),
  });
});
afterEach(() => {
  window.location.hash = "";
});

describe("leaving a recipe brings the list back where you were", () => {
  it("the back arrow (or Back) returns to the same scroll position, with the recipes already there", async () => {
    window.location.hash = "#/recipes";
    render(<RecipesPage />);
    await screen.findAllByText("Recipe 40");
    scrollBy(1800);
    await go("#/recipes/7");
    await screen.findByRole("heading", { level: 1, name: "Weeknight Chili" });
    expect(y).toBe(0); // a recipe opens at its top
    scrollBy(300); // (reading the recipe)
    await go("#/recipes");
    expect(screen.getAllByText("Recipe 40").length).toBeGreaterThan(0); // no wait for the list to load again
    expect(y).toBe(1800);
  });

  it("a list with other filters, or arriving fresh, starts at the top", async () => {
    window.location.hash = "#/recipes";
    render(<RecipesPage />);
    await screen.findAllByText("Recipe 40");
    scrollBy(1800);
    await go("#/recipes/7");
    await screen.findByRole("heading", { level: 1, name: "Weeknight Chili" });
    await go("#/recipes?favorite=1");
    expect(y).toBe(0);
  });
});

describe("filters stay on until you clear them", () => {
  // RecipeHub opened at its plain address (the home screen app, a bookmark): no #/recipes in it yet
  for (const start of ["", "#/", "#/recipes"]) {
    it(`a tag picked on the list is still on after opening a recipe and going back (opened at "${start || "no hash"}")`, async () => {
      const u = userEvent.setup();
      window.location.hash = start;
      render(<RecipesPage />);
      const side = within(await screen.findByRole("complementary", { name: "Browse recipes" }));
      await u.click(await side.findByRole("button", { name: "beef" }));
      await go("#/recipes/7");
      await u.click(await screen.findByRole("link", { name: "Recipes" }));
      await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));
      expect(window.location.hash).toBe("#/recipes?tag=beef");
      expect(within(await screen.findByRole("complementary", { name: "Browse recipes" })).getByRole("button", { name: "beef" })).toHaveAttribute("aria-pressed", "true");
      await waitFor(() => {
        const asked = server.sent.filter((x) => x.path.startsWith("/api/recipes?") && !x.path.includes("limit=1&") && !x.path.endsWith("limit=1"));
        expect(new URLSearchParams(asked[asked.length - 1].path.split("?")[1]).getAll("tag")).toEqual(["beef"]);
      });
    });
  }
});
