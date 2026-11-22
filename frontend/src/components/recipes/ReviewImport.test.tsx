import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReviewImport from "./ReviewImport";
import { fakeServer, recipeJson } from "../../test/fakeServer";
import { forgetAiStatus } from "../../ai";

const suggestion = {
  steps: { suggested: ["Brown the beef well."], changes: ["More detail."], changed: true },
  ingredients: { suggested: [], changes: [], changed: false },
  nutrition: { suggested: null, changes: [], changed: false },
  organize: { categories: [], newCategories: [], tags: [], changes: [], changed: false },
};
const routes = (more: Record<string, any> = {}) =>
  fakeServer({
    "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }),
    "GET /api/imports/31": () => ({ id: 31, kind: "import-file", status: "done", source: "My Recipes.paprikarecipes", result: { format: "Paprika", imported: 3, recipeIds: [5, 6, 7] }, error: null, createdAt: "2026-10-31T14:00:00Z" }),
    "GET /api/recipes/5": () => recipeJson({ id: 5, title: "Chili" }),
    "GET /api/recipes/6": () => recipeJson({ id: 6, title: "Pancakes" }),
    "GET /api/recipes/7": () => recipeJson({ id: 7, title: "Soup" }),
    "POST /api/recipes/:id/enhance": () => suggestion,
    "POST /api/recipes/:id/enhance/apply": () => recipeJson(),
    ...more,
  });

beforeEach(() => {
  forgetAiStatus();
  localStorage.clear();
});

describe("reviewing imported recipes one by one", () => {
  it("goes through each recipe, with its name and place in the header; rejecting moves on, accepting improves it", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<ReviewImport job={31} />);
    const first = await screen.findByRole("dialog", { name: "Chili" });
    expect(await within(first).findByText(/^Recipe 1 of 3 · Improve with AI · Step 1 of 1$/, undefined, { timeout: 3000 })).toBeInTheDocument();
    await u.click(within(first).getByRole("button", { name: "Reject change" }));
    const second = await screen.findByRole("dialog", { name: "Pancakes" });
    expect(await within(second).findByText(/^Recipe 2 of 3/, undefined, { timeout: 3000 })).toBeInTheDocument();
    await u.click(within(second).getByRole("button", { name: "Accept change" }));
    const third = await screen.findByRole("dialog", { name: "Soup" });
    await u.click(await within(third).findByRole("button", { name: "Close" }, { timeout: 3000 })); // the ✕ skips it too
    expect(await screen.findByRole("status", { name: "Review finished" })).toHaveTextContent("Reviewed 3 recipes: 1 improved, 2 skipped.");
    expect(s.writes().filter((w) => w.path.endsWith("/apply")).map((w) => w.path)).toEqual(["/api/recipes/6/enhance/apply"]);
  });

  it("Stop reviewing ends it early; what's done stays done", async () => {
    routes();
    const u = userEvent.setup();
    render(<ReviewImport job={31} />);
    const first = await screen.findByRole("dialog", { name: "Chili" });
    await u.click(await within(first).findByRole("button", { name: "Stop reviewing" }, { timeout: 3000 }));
    expect(await screen.findByRole("status", { name: "Review finished" })).toHaveTextContent("Stopped after 0 of 3 recipes: 0 improved, 0 skipped.");
  });

  it("picks up where you left off", async () => {
    routes();
    const u = userEvent.setup();
    const { unmount } = render(<ReviewImport job={31} />);
    await u.click(await within(await screen.findByRole("dialog", { name: "Chili" })).findByRole("button", { name: "Reject change" }, { timeout: 3000 }));
    await screen.findByRole("dialog", { name: "Pancakes" });
    unmount();
    render(<ReviewImport job={31} />);
    expect(await screen.findByRole("dialog", { name: "Pancakes" })).toBeInTheDocument();
  });

  it("a recipe deleted since the import is passed over", async () => {
    routes({ "GET /api/recipes/5": () => ({ status: 404, json: { error: "Recipe not found" } }) });
    render(<ReviewImport job={31} />);
    expect(await screen.findByRole("dialog", { name: "Pancakes" })).toBeInTheDocument();
  });

  it("AI Enhance off: says so instead", async () => {
    routes({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: false }) });
    render(<ReviewImport job={31} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Improve with AI is turned off/));
  });
});
