import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrganizeSettings from "./OrganizeSettings";
import { fakeServer } from "../test/fakeServer";

// Settings › Recipes: categories, collections, tags and meal plan rows, one at a time, as chips
const cats = [
  { id: 1, name: "Breakfast", count: 2 },
  { id: 2, name: "Dinner", count: 10 },
  { id: 3, name: "Dessert", count: 0 },
];
const routes = (more: Record<string, any> = {}) => {
  let sort = { categories: "manual", collections: "manual" };
  return fakeServer({
    "GET /api/organize/sort": () => sort,
    "PUT /api/organize/sort": (b: any) => (sort = { ...sort, ...b }),
    "GET /api/categories": () => (sort.categories === "az" ? [...cats].sort((a, b) => a.name.localeCompare(b.name)) : cats),
    "GET /api/collections": () => [{ id: 9, name: "Quick Meals", description: "Under 30 minutes", count: 4 }],
    "GET /api/tags": () => [
      { id: 21, name: "beef", count: 3 },
      { id: 22, name: "spicy", count: 2 },
      { id: 23, name: "weeknight", count: 5 },
    ],
    "GET /api/plan/settings": () => ({ slots: [{ id: "b", name: "Breakfast" }, { id: "l", name: "Lunch" }, { id: "d", name: "Dinner" }], weekStart: 1 }),
    "PATCH /api/categories/:id": (b: any) => ({ id: 3, name: b.name }),
    "DELETE /api/categories/:id": () => ({ status: 204 }),
    "PUT /api/categories/order": () => ({ ok: true }),
    "PATCH /api/collections/:id": (b: any) => ({ id: 9, ...b }),
    ...more,
  });
};
const chips = (name: string) => within(screen.getByRole("list", { name })).getAllByRole("listitem").map((li) => li.textContent);

describe("Settings › Recipes, organized", () => {
  it("one list at a time: Categories, Collections, Tags, Meal plan", async () => {
    routes();
    const u = userEvent.setup();
    render(<OrganizeSettings />);
    const tabs = screen.getByRole("tablist", { name: "Organize" });
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Categories", "Collections", "Tags", "Meal plan"]);
    expect(await screen.findByRole("list", { name: "Categories" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Tags" })).toBeNull();
    await u.click(within(tabs).getByRole("tab", { name: "Tags" }));
    expect(await screen.findByRole("list", { name: "Tags" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Categories" })).toBeNull();
  });

  it("categories as chips with their recipe counts; sort A–Z, Z–A or Manual", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<OrganizeSettings />);
    await screen.findByRole("list", { name: "Categories" });
    await waitFor(() => expect(chips("Categories")).toEqual(["Breakfast2", "Dinner10", "Dessert0"]));
    await u.selectOptions(screen.getByRole("combobox", { name: "Sort categories" }), "az");
    await waitFor(() => expect(chips("Categories")).toEqual(["Breakfast2", "Dessert0", "Dinner10"]));
    expect(s.writes().find((w) => w.path === "/api/organize/sort")?.body).toEqual({ categories: "az" });
  });

  it("tapping a chip opens it: rename, see its recipes, delete (asks first)", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<OrganizeSettings />);
    const list = await screen.findByRole("list", { name: "Categories" });
    await u.click(await within(list).findByRole("button", { name: /Dessert/ }));
    const ed = screen.getByRole("dialog", { name: "Dessert" });
    expect(within(ed).getByRole("link", { name: "0 recipes" })).toHaveAttribute("href", "#/recipes?category=3");
    await u.clear(within(ed).getByLabelText("Name"));
    await u.type(within(ed).getByLabelText("Name"), "Desserts");
    await u.click(within(ed).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(s.writes().find((w) => w.method === "PATCH")).toMatchObject({ path: "/api/categories/3", body: { name: "Desserts" } }));
    await u.click(await within(list).findByRole("button", { name: /Dessert/ }));
    await u.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(s.writes().some((w) => w.method === "DELETE")).toBe(false);
    await u.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete Dessert" }));
    await waitFor(() => expect(s.writes().find((w) => w.method === "DELETE")?.path).toBe("/api/categories/3"));
  });

  it("in Manual, a chip can move earlier or later (as well as being dragged)", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<OrganizeSettings />);
    const list = await screen.findByRole("list", { name: "Categories" });
    await u.click(await within(list).findByRole("button", { name: /Dessert/ }));
    await u.click(within(screen.getByRole("dialog", { name: "Dessert" })).getByRole("button", { name: "Move earlier" }));
    await waitFor(() => expect(s.writes().find((w) => w.path === "/api/categories/order")?.body).toEqual({ ids: [1, 3, 2] }));
  });

  it("A–Z or Z–A: no moving by hand", async () => {
    routes();
    const u = userEvent.setup();
    render(<OrganizeSettings />);
    const list = await screen.findByRole("list", { name: "Categories" });
    await u.selectOptions(screen.getByRole("combobox", { name: "Sort categories" }), "az");
    await u.click(await within(list).findByRole("button", { name: /Dessert/ }));
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Move earlier" })).toBeNull();
  });

  it("collections have a description; tags have a search and no Add", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<OrganizeSettings />);
    await u.click(screen.getByRole("tab", { name: "Collections" }));
    await u.click(await within(await screen.findByRole("list", { name: "Collections" })).findByRole("button", { name: /Quick Meals/ }));
    const ed = screen.getByRole("dialog", { name: "Quick Meals" });
    expect(within(ed).getByLabelText("Description")).toHaveValue("Under 30 minutes");
    expect(screen.getByRole("combobox", { name: "Sort collections" })).toBeInTheDocument();
    await u.click(within(ed).getByRole("button", { name: "Close" }));
    await u.click(screen.getByRole("tab", { name: "Tags" }));
    await screen.findByRole("list", { name: "Tags" });
    await waitFor(() => expect(chips("Tags")).toHaveLength(3));
    await u.type(screen.getByRole("searchbox", { name: "Find a tag" }), "we");
    expect(chips("Tags")).toEqual(["weeknight5"]);
    expect(screen.queryByRole("textbox", { name: "New tag" })).toBeNull();
    expect(s.writes()).toHaveLength(0);
  });

  it("meal plan rows in their own tab", async () => {
    routes();
    const u = userEvent.setup();
    render(<OrganizeSettings />);
    await u.click(screen.getByRole("tab", { name: "Meal plan" }));
    expect(await screen.findByRole("button", { name: "Move Lunch down" })).toBeInTheDocument();
  });
});
