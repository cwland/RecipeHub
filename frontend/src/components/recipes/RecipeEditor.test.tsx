import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecipeEditor from "./RecipeEditor";
import { fakeServer, recipeJson } from "../../test/fakeServer";

const lists = {
  "GET /api/categories": () => [
    { id: 1, name: "Breakfast", count: 0 },
    { id: 3, name: "Dinner", count: 2 },
  ],
  "GET /api/collections": () => [{ id: 5, name: "Quick meals", description: null, count: 0, images: [] }],
  "GET /api/tags": () => [{ id: 1, name: "beef", count: 1 }],
};
const created = (body: any) => ({ status: 201, json: recipeJson({ id: 42, title: body.title }) });

describe("adding a recipe by hand", () => {
  it("sends what was typed, with times and servings as numbers, and opens the new recipe", async () => {
    const server = fakeServer({ ...lists, "POST /api/recipes": created });
    const u = userEvent.setup();
    render(<RecipeEditor />);
    await u.type(screen.getByLabelText("Name"), "Pancakes");
    await u.type(screen.getByLabelText("Servings"), "four");
    await u.type(screen.getByLabelText("Prep (min)"), "1 hr 15 min");
    await u.type(screen.getByLabelText("Ingredients"), "2 cups flour{Enter}2 eggs");
    await u.click(await screen.findByRole("button", { name: "Breakfast" }));
    await u.click(screen.getByRole("button", { name: "Save recipe" }));
    await waitFor(() => expect(window.location.hash).toBe("#/recipes/42?added=1"));
    expect(server.writes().map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      {
        method: "POST",
        path: "/api/recipes",
        body: expect.objectContaining({ title: "Pancakes", servings: 4, prepMinutes: 75, ingredients: "2 cups flour\n2 eggs", categories: [1] }),
      },
    ]);
  });

  it("Blank recipe after a blocked import: the link is already filled in", async () => {
    window.location.hash = "#/recipes/new?source=" + encodeURIComponent("https://kitchen.example.com/recipes/13647-pork");
    fakeServer({ ...lists });
    render(<RecipeEditor />);
    expect(await screen.findByLabelText("Source link")).toHaveValue("https://kitchen.example.com/recipes/13647-pork");
    window.location.hash = "";
  });

  it("pressing Enter in the Name box doesn't save a half-typed recipe", async () => {
    const server = fakeServer({ ...lists, "POST /api/recipes": created });
    const u = userEvent.setup();
    render(<RecipeEditor />);
    await u.type(screen.getByLabelText("Name"), "Pancakes{Enter}");
    await new Promise((r) => setTimeout(r, 50));
    expect(server.writes()).toEqual([]);
  });

  it("Enter in the tags box adds the tag and doesn't save", async () => {
    const server = fakeServer({ ...lists, "POST /api/recipes": created });
    const u = userEvent.setup();
    render(<RecipeEditor />);
    await u.type(screen.getByLabelText("Name"), "Pancakes");
    await u.type(screen.getByLabelText("Tags"), "Sweet{Enter}");
    expect(screen.getByText("#sweet")).toBeInTheDocument();
    expect(server.writes()).toEqual([]);
  });

  it("clicking Save twice quickly makes one recipe, not two", async () => {
    let answer: (v: unknown) => void = () => {};
    const server = fakeServer({ ...lists, "POST /api/recipes": (body) => new Promise((r) => (answer = () => r(created(body)))) as any });
    const u = userEvent.setup();
    render(<RecipeEditor />);
    await u.type(screen.getByLabelText("Name"), "Pancakes");
    const save = screen.getByRole("button", { name: "Save recipe" });
    await u.dblClick(save);
    answer(null);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.writes().filter((w) => w.path === "/api/recipes")).toHaveLength(1);
  });

  it("a field the server refuses says why next to it, and keeps everything typed", async () => {
    fakeServer({
      ...lists,
      "POST /api/recipes": () => ({ status: 400, json: { error: "Invalid request", details: [{ path: "sourceUrl", message: "That isn't a web address" }] } }),
    });
    const u = userEvent.setup();
    render(<RecipeEditor />);
    await u.type(screen.getByLabelText("Name"), "Pancakes");
    await u.type(screen.getByLabelText("Source link"), "my notebook");
    await u.click(screen.getByRole("button", { name: "Save recipe" }));
    expect(await screen.findByText("That isn't a web address")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Pancakes");
    expect(screen.getByRole("button", { name: "Save recipe" })).toBeEnabled();
  });

  it("when the server can't be reached, it says so in plain words and you can try again", async () => {
    fakeServer(lists);
    const u = userEvent.setup();
    render(<RecipeEditor />);
    await u.type(screen.getByLabelText("Name"), "Pancakes");
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await u.click(screen.getByRole("button", { name: "Save recipe" }));
    expect(await screen.findByText(/couldn't reach recipehub/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save recipe" })).toBeEnabled();
  });
});

describe("editing a recipe", () => {
  it("shows the saved recipe and saves changes back to it", async () => {
    const server = fakeServer({ ...lists, "GET /api/recipes/7": () => recipeJson(), "PATCH /api/recipes/7": (body) => recipeJson({ title: body.title }) });
    const u = userEvent.setup();
    render(<RecipeEditor id={7} />);
    const name = await screen.findByLabelText("Name");
    expect(name).toHaveValue("Weeknight Chili");
    expect(screen.getByLabelText("Ingredients")).toHaveValue("1 lb ground beef\n2 tbsp chili powder");
    expect(screen.getByRole("button", { name: "Dinner" })).toHaveAttribute("aria-pressed", "true");
    await u.clear(name);
    await u.type(name, "Best Chili");
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    await u.click(await screen.findByRole("button", { name: "Update" }));
    await waitFor(() => expect(window.location.hash).toBe("#/recipes/7"));
    expect(server.writes()[0]).toMatchObject({ method: "PATCH", body: { title: "Best Chili", categories: [3], tags: ["beef"], version: "current" } });
  });
});

describe("saving changes with recipe versioning", () => {
  const edit = async (over: Record<string, unknown> = {}) => {
    const server = fakeServer({ ...lists, "GET /api/recipes/7": () => recipeJson(over), "PATCH /api/recipes/7": (body) => recipeJson({ title: body.title }) });
    const u = userEvent.setup();
    window.location.hash = "#/recipes/7/edit";
    render(<RecipeEditor id={7} />);
    await screen.findByLabelText("Name");
    return { server, u };
  };

  it("asks: save to the current version, or as a new one", async () => {
    const { server, u } = await edit();
    await u.type(screen.getByLabelText("Ingredients"), "\n1 tsp salt");
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    const ask = await screen.findByRole("dialog", { name: "Save your changes" });
    expect(ask).toHaveTextContent("Update the current version, or save your changes as a new version?");
    expect(server.writes()).toHaveLength(0);
    await u.click(within(ask).getByRole("button", { name: "New version" }));
    await waitFor(() => expect(window.location.hash).toBe("#/recipes/7"));
    expect(server.writes()[0].body).toMatchObject({ version: "new" });
  });

  it("cancel goes back to the form and saves nothing", async () => {
    const { server, u } = await edit();
    await u.type(screen.getByLabelText("Name"), "!");
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    await u.click(within(await screen.findByRole("dialog", { name: "Save your changes" })).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Save your changes" })).toBeNull();
    expect(server.writes()).toHaveLength(0);
    expect(screen.getByLabelText("Name")).toHaveValue("Weeknight Chili!");
  });

  it("only tags, categories or collections changed: saved straight away (they aren't in versions)", async () => {
    const { server, u } = await edit();
    await u.click(screen.getByRole("button", { name: "Dinner" }));
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(server.writes()).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: "Save your changes" })).toBeNull();
    expect(server.writes()[0].body.version).toBeUndefined();
  });

  it("versioning off: saved straight away", async () => {
    const { server, u } = await edit({ versioning: false });
    await u.type(screen.getByLabelText("Name"), "!");
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(server.writes()).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: "Save your changes" })).toBeNull();
    expect(server.writes()[0].body.version).toBeUndefined();
  });
});
