import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddToListDialog from "./AddToListDialog";
import { fakeServer } from "../../test/fakeServer";

const line = { key: "beef", name: "ground beef", quantity: 1, unit: "lb", aisle: "meat", sources: [{ recipeId: 7, title: "Chili" }], pantry: null };
const routes = (lists: object[], weekId: number | null = null) => ({
  "POST /api/grocery/preview": () => ({ lines: [line] }),
  "GET /api/grocery/lists": () => lists,
  "GET /api/grocery/this-week": () => ({ name: "Week of November 16", listId: weekId }),
  "POST /api/grocery/lists": (b: any) => (b.name === "Costco" ? { status: 409, json: { error: 'There\'s already a list called "Costco"' } } : { status: 201, json: { id: 12, name: b.name, open: 0, done: 0 } }),
  "POST /api/grocery/lists/:id/items": () => ({ status: 201, json: { added: 1, merged: 0, items: [] } }),
});
const adds = (s: ReturnType<typeof fakeServer>) => s.writes().filter((w) => w.path !== "/api/grocery/preview");
const dialog = () => render(<AddToListDialog source={{ recipes: [{ recipeId: 7 }] }} title="Chili" onClose={() => {}} />);

describe("Add to grocery list: which list", () => {
  it("no lists: suggests this week's list and creates it", async () => {
    const s = fakeServer(routes([]));
    const u = userEvent.setup();
    dialog();
    expect(await screen.findByRole("textbox", { name: "New list name" })).toHaveValue("Week of November 16");
    expect(screen.getByRole("combobox", { name: "List" })).toHaveValue("new");
    await u.click(screen.getByRole("button", { name: "Add 1 item" }));
    await waitFor(() =>
      expect(adds(s).map((w) => [w.method, w.path, w.body])).toEqual([
        ["POST", "/api/grocery/lists", { name: "Week of November 16" }],
        ["POST", "/api/grocery/lists/12/items", { items: [{ name: "ground beef", quantity: 1, unit: "lb", sources: [{ recipeId: 7, title: "Chili" }] }] }],
      ]),
    );
    expect(await screen.findByText(/on Week of November 16/)).toBeInTheDocument();
  });

  it("with lists: pick one (this week's to start) or start a new one", async () => {
    const s = fakeServer(routes([{ id: 1, name: "Costco", open: 0, done: 0 }, { id: 2, name: "Week of November 16", open: 0, done: 0 }], 2));
    const u = userEvent.setup();
    dialog();
    const select = await screen.findByRole("combobox", { name: "List" });
    await waitFor(() => expect(select).toHaveValue("2"));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Costco", "Week of November 16", "New list…"]);
    expect(screen.queryByRole("textbox", { name: "New list name" })).not.toBeInTheDocument();
    await u.selectOptions(select, "new");
    const name = screen.getByRole("textbox", { name: "New list name" });
    expect(name).toHaveValue(""); // this week's list is already there
    await u.type(name, "Costco");
    await u.click(screen.getByRole("button", { name: "Add 1 item" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('There\'s already a list called "Costco"');
    expect(adds(s)).toHaveLength(1);
  });

  it("a single list is shown too, so a new one can be started", async () => {
    fakeServer(routes([{ id: 1, name: "Costco", open: 0, done: 0 }]));
    dialog();
    expect(await screen.findByRole("combobox", { name: "List" })).toHaveValue("1");
  });
});
