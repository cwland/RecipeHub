import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecipeList, { hintAddRecipe, recipesChanged } from "./RecipeList";
import { fakeServer } from "../../test/fakeServer";

const summary = (id: number, title: string) => ({ id, title, imageUrl: null, totalMinutes: null, rating: null, favorite: false, pinned: false, tags: [], categories: [] });
const setup = (more: Record<string, any> = {}) => {
  const server = fakeServer({
    "POST /api/collections": (b: any) => ({ status: 201, json: { id: 12, name: b.name, description: null, count: 0, images: [] } }),
    "GET /api/tags": () => [
      { id: 1, name: "beef", count: 3 },
      { id: 2, name: "spicy", count: 2 },
    ],
    "GET /api/categories": () => [{ id: 3, name: "Dinner", count: 2 }],
    "GET /api/collections": () => [],
    "GET /api/recipes": (_b: unknown, path: string) => {
      const qs = new URLSearchParams(path.split("?")[1]);
      // "none" filters get their own count for the sidebar
      if (qs.get("category") === "none" && qs.get("limit") === "1") return { total: 4, recipes: [summary(9, "Toast")] };
      return { total: 1, recipes: [summary(1, "Chili")] };
    },
    ...more,
  });
  // what the list asked for last (ignoring the sidebar's count requests)
  const lastList = () => {
    const list = server.sent.filter((s) => s.path.startsWith("/api/recipes?") && new URLSearchParams(s.path.split("?")[1]).get("limit") !== "1");
    return new URLSearchParams(list[list.length - 1].path.split("?")[1]);
  };
  render(<RecipeList params={new URLSearchParams()} />);
  return { lastList, server };
};
const sidebar = () => within(screen.getByRole("complementary", { name: "Browse recipes" }));

describe("browsing the recipe list", () => {
  it("clicking a selected tag again turns it off", async () => {
    const u = userEvent.setup();
    const { lastList } = setup();
    const beef = await sidebar().findByRole("button", { name: "beef" });
    await u.click(beef);
    await waitFor(() => expect(lastList().getAll("tag")).toEqual(["beef"]));
    await u.click(sidebar().getByRole("button", { name: "beef" }));
    await waitFor(() => expect(lastList().getAll("tag")).toEqual([]));
    expect(sidebar().getByRole("button", { name: "beef" })).toHaveAttribute("aria-pressed", "false");
  });

  it("several tags can be on at once: recipes with all of them", async () => {
    const u = userEvent.setup();
    const { lastList } = setup();
    await u.click(await sidebar().findByRole("button", { name: "beef" }));
    await u.click(sidebar().getByRole("button", { name: "spicy" }));
    await waitFor(() => expect(lastList().getAll("tag")).toEqual(["beef", "spicy"]));
    expect(sidebar().getByRole("button", { name: "beef" })).toHaveAttribute("aria-pressed", "true");
    expect(sidebar().getByRole("button", { name: "spicy" })).toHaveAttribute("aria-pressed", "true");
  });

  it("tags narrow the category you're in instead of replacing it", async () => {
    const u = userEvent.setup();
    const { lastList } = setup();
    await u.click(await sidebar().findByRole("button", { name: /Dinner/ }));
    await u.click(sidebar().getByRole("button", { name: "beef" }));
    await waitFor(() => expect([lastList().get("category"), lastList().getAll("tag")]).toEqual(["3", ["beef"]]));
  });

  it("clicking the selected category again goes back to all recipes", async () => {
    const u = userEvent.setup();
    const { lastList } = setup();
    await u.click(await sidebar().findByRole("button", { name: /Dinner/ }));
    await waitFor(() => expect(lastList().get("category")).toBe("3"));
    await u.click(sidebar().getByRole("button", { name: /Dinner/ }));
    await waitFor(() => expect(lastList().get("category")).toBeNull());
  });

  it("recipes with no category can be found, with how many there are", async () => {
    const u = userEvent.setup();
    const { lastList } = setup();
    const none = await sidebar().findByRole("button", { name: /No category\s*4/ });
    await u.click(none);
    await waitFor(() => expect(lastList().get("category")).toBe("none"));
    expect(screen.getByRole("heading", { name: "No category" })).toBeInTheDocument();
  });

  it("recipes with no tags can be found", async () => {
    const u = userEvent.setup();
    const { lastList } = setup();
    await u.click(await sidebar().findByRole("button", { name: "No tags" }));
    await waitFor(() => expect(lastList().getAll("tag")).toEqual(["none"]));
  });
});

describe("a search that finds nothing where you are", () => {
  const noneForQuery = {
    "GET /api/recipes": (_b: unknown, path: string) => {
      const qs = new URLSearchParams(path.split("?")[1]);
      if (qs.get("limit") === "1") return { total: 4, recipes: [summary(9, "Toast")] };
      if (qs.get("q") && qs.get("category")) return { total: 0, recipes: [] };
      return { total: 1, recipes: [summary(1, "Chili")] };
    },
  };

  it("offers Search all on the count line; it keeps the words and drops the category", async () => {
    const u = userEvent.setup();
    const { lastList } = setup(noneForQuery);
    await u.click(await sidebar().findByRole("button", { name: /Dinner/ }));
    await u.type(screen.getByRole("searchbox", { name: "Search recipes" }), "breakfast");
    const line = await screen.findByText(/0 recipes for “breakfast”/);
    await u.click(within(line).getByRole("button", { name: "Search all" }));
    await waitFor(() => expect([lastList().get("q"), lastList().get("category")]).toEqual(["breakfast", null]));
    expect(screen.getByRole("heading", { name: "All recipes" })).toBeInTheDocument();
  });

  it("isn't offered when you're already searching all recipes", async () => {
    const u = userEvent.setup();
    setup({ "GET /api/recipes": () => ({ total: 0, recipes: [] }) });
    await u.type(await screen.findByRole("searchbox", { name: "Search recipes" }), "breakfast");
    await screen.findByText(/0 recipes for “breakfast”/);
    expect(screen.queryByRole("button", { name: "Search all" })).toBeNull();
  });
});

describe("after the setup wizard", () => {
  it("Add recipe is pointed out (glowing, with a note) until you click it or Got it", async () => {
    const u = userEvent.setup();
    hintAddRecipe();
    setup();
    const add = await screen.findByRole("button", { name: "Add recipe" });
    expect(add).toHaveAttribute("data-hint", "true");
    const note = screen.getByRole("status", { name: "Tip" });
    expect(note).toHaveTextContent(/import your first recipe by hand or from a link/);
    await u.click(within(note).getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("status", { name: "Tip" })).toBeNull();
    expect(add).not.toHaveAttribute("data-hint");
  });

  it("not pointed out otherwise", async () => {
    setup();
    expect(await screen.findByRole("button", { name: "Add recipe" })).not.toHaveAttribute("data-hint");
    expect(screen.queryByRole("status", { name: "Tip" })).toBeNull();
  });
});

describe("a new collection from the sidebar", () => {
  it("+ New collection asks for a name right there; Enter adds it and opens it", async () => {
    const u = userEvent.setup();
    const { lastList, server } = setup();
    await u.click(await sidebar().findByRole("button", { name: "+ New collection" }));
    await u.type(sidebar().getByRole("textbox", { name: "New collection name" }), "Weeknight wins{Enter}");
    await waitFor(() => expect(server.writes().at(-1)).toMatchObject({ method: "POST", path: "/api/collections", body: { name: "Weeknight wins" } }));
    expect(await sidebar().findByRole("button", { name: /Weeknight wins/ })).toBeInTheDocument();
    await waitFor(() => expect(lastList().get("collection")).toBe("12"));
    expect(sidebar().queryByRole("textbox", { name: "New collection name" })).toBeNull();
  });

  it("a name that's taken says so; Escape cancels", async () => {
    const u = userEvent.setup();
    setup({ "POST /api/collections": () => ({ status: 409, json: { error: "There's already a collection called Soups" } }) });
    await u.click(await sidebar().findByRole("button", { name: "+ New collection" }));
    await u.type(sidebar().getByRole("textbox", { name: "New collection name" }), "Soups{Enter}");
    expect(await sidebar().findByRole("alert")).toHaveTextContent("already a collection called Soups");
    await u.keyboard("{Escape}");
    expect(sidebar().queryByRole("textbox", { name: "New collection name" })).toBeNull();
    expect(sidebar().getByRole("button", { name: "+ New collection" })).toBeInTheDocument();
  });
});

describe("after an import adds recipes", () => {
  it("the list reloads by itself (it was showing none)", async () => {
    let total = 0;
    setup({ "GET /api/recipes": (_b: unknown, path: string) => (new URLSearchParams(path.split("?")[1]).get("limit") === "1" ? { total: 0, recipes: [] } : total ? { total: 1, recipes: [summary(5, "Weeknight Chili")] } : { total: 0, recipes: [] }) });
    expect(await screen.findByText("Your recipe box is empty.")).toBeInTheDocument();
    total = 1;
    recipesChanged();
    expect((await screen.findAllByText("Weeknight Chili")).length).toBeGreaterThan(0);
  });

  it("an empty recipe box says so (not 'No recipes match')", async () => {
    setup({ "GET /api/recipes": () => ({ total: 0, recipes: [] }) });
    expect(await screen.findByText("Your recipe box is empty.")).toBeInTheDocument();
    expect(screen.queryByText(/No recipes match/)).toBeNull();
  });
});

describe("card or list view and tiles across", () => {
  const grid = () => screen.getByRole("list", { name: "Recipes" });

  it("starts as cards 4 across; + and − change it and it sticks", async () => {
    localStorage.clear();
    const u = userEvent.setup();
    setup();
    await screen.findByRole("heading", { name: "Chili" });
    expect(grid()).toHaveAttribute("data-across", "4");
    await u.click(screen.getByRole("button", { name: "More tiles across" }));
    expect(grid()).toHaveAttribute("data-across", "5");
    await u.click(screen.getByRole("button", { name: "More tiles across" }));
    expect(screen.getByRole("button", { name: "More tiles across" })).toBeDisabled();
    expect(JSON.parse(localStorage.getItem("recipehub-recipe-view")!)).toEqual({ mode: "cards", across: 6 });
    for (let i = 0; i < 4; i++) await u.click(screen.getByRole("button", { name: "Fewer tiles across" }));
    expect(grid()).toHaveAttribute("data-across", "2");
    expect(screen.getByRole("button", { name: "Fewer tiles across" })).toBeDisabled();
  });

  it("the view icon switches to a list (no tile size buttons) and back", async () => {
    localStorage.clear();
    const u = userEvent.setup();
    setup();
    await screen.findByRole("heading", { name: "Chili" });
    await u.click(screen.getByRole("button", { name: "Show as a list" }));
    expect(grid()).toHaveAttribute("data-view", "list");
    expect(screen.queryByRole("button", { name: "More tiles across" })).toBeNull();
    expect(JSON.parse(localStorage.getItem("recipehub-recipe-view")!).mode).toBe("list");
    await u.click(screen.getByRole("button", { name: "Show as cards" }));
    expect(grid()).toHaveAttribute("data-view", "cards");
  });

  it("opens in the view picked last time", async () => {
    localStorage.setItem("recipehub-recipe-view", JSON.stringify({ mode: "list", across: 3 }));
    setup();
    await screen.findByRole("heading", { name: "Chili" });
    expect(grid()).toHaveAttribute("data-view", "list");
  });
});
