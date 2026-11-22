import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GroceryPage from "./GroceryPage";
import { SessionContext, type User } from "../../session";
import { fakeServer } from "../../test/fakeServer";

const live = vi.hoisted(() => ({ fn: null as null | (() => void) }));
vi.mock("../../live", () => ({ useLive: (_t: unknown, fn: () => void) => void (live.fn = fn) }));

const user = { id: 1, username: "alex", displayName: "Alex", email: null, role: "owner" } as User;
const item = (id: number, name: string, over: Record<string, unknown> = {}) => ({ id, listId: 1, name, quantity: null, unit: null, note: null, aisle: "dairy", aisleBy: "words", checked: false, position: id, sources: [], ...over });
const lists = [{ id: 1, name: "Week of November 16", open: 3, done: 0 }];

function page() {
  return render(
    <SessionContext.Provider value={{ user, setUser: () => {}, replaceToken: () => {}, signOut: () => {}, signOutEverywhere: async () => {} }}>
      <GroceryPage />
    </SessionContext.Provider>,
  );
}

describe("grocery list: edit mode", () => {
  const routes = (items = [item(1, "eggs"), item(2, "milk"), item(3, "bread")]) => ({
    "GET /api/grocery/lists": () => lists,
    "GET /api/grocery/this-week": () => ({ name: "Week of November 16", listId: 1 }),
    "GET /api/grocery/lists/:id/items": () => items,
    "POST /api/grocery/items/delete": (b: any) => ({ deleted: b.ids.length }),
    "PATCH /api/grocery/items/:id": () => ({}),
  });

  it("selects several items and deletes them in one call", async () => {
    const s = fakeServer(routes());
    const u = userEvent.setup();
    page();
    await u.click(await screen.findByRole("button", { name: "Select items to delete" }));
    await u.click(screen.getByRole("checkbox", { name: "Select eggs" }));
    await u.click(screen.getByRole("checkbox", { name: "Select milk" }));
    await u.click(screen.getByRole("button", { name: "Delete 2 items" }));
    expect(screen.getByText("Delete 2 items?")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(s.writes()).toEqual([expect.objectContaining({ method: "POST", path: "/api/grocery/items/delete", body: { ids: [1, 2] } })]));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: /^Select / })).not.toBeInTheDocument());
  });

  it("Select all, and Delete is off until something is picked", async () => {
    fakeServer(routes());
    const u = userEvent.setup();
    page();
    await u.click(await screen.findByRole("button", { name: "Select items to delete" }));
    expect(screen.getByRole("button", { name: "Delete 0 items" })).toBeDisabled();
    await u.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByRole("button", { name: "Delete 3 items" })).toBeEnabled();
    await u.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("checkbox", { name: "eggs" })).toBeInTheDocument();
  });

  it("tapping a row in edit mode selects it, it doesn't check it off", async () => {
    const s = fakeServer(routes([item(1, "eggs"), item(2, "milk", { checked: true })]));
    const u = userEvent.setup();
    page();
    await u.click(await screen.findByRole("button", { name: "Select items to delete" }));
    await u.click(screen.getByRole("checkbox", { name: "Select milk" })); // in the cart: can go too
    expect(screen.getByRole("checkbox", { name: "Select milk" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument(); // no pencils while selecting
    expect(s.writes()).toEqual([]);
  });

  it("outside edit mode, tapping checks it off and the ⋯ still edits one item", async () => {
    const s = fakeServer(routes());
    const u = userEvent.setup();
    page();
    await u.click(await screen.findByRole("checkbox", { name: "eggs" }));
    await waitFor(() => expect(s.writes()[0]).toMatchObject({ method: "PATCH", path: "/api/grocery/items/1", body: { checked: true } }));
    await u.click(screen.getByRole("button", { name: "Edit milk" }));
    expect(screen.getByRole("dialog", { name: "Edit item" })).toBeInTheDocument();
  });

  it("switching to another list leaves edit mode", async () => {
    fakeServer({ ...routes(), "GET /api/grocery/lists": () => [...lists, { id: 2, name: "Costco", open: 1, done: 0 }] });
    const u = userEvent.setup();
    page();
    await u.click(await screen.findByRole("button", { name: "Select items to delete" }));
    await u.click(screen.getByRole("checkbox", { name: "Select eggs" }));
    await u.click(screen.getByRole("button", { name: "Costco (1)" }));
    await waitFor(() => expect(screen.queryByRole("toolbar", { name: "Delete items" })).not.toBeInTheDocument());
    expect(screen.queryByRole("checkbox", { name: /^Select / })).not.toBeInTheDocument();
  });

  it("a live update that takes a picked item away drops it from the picks", async () => {
    let now = [item(1, "eggs"), item(2, "milk"), item(3, "bread")];
    const s = fakeServer({ ...routes(), "GET /api/grocery/lists/:id/items": () => now });
    const u = userEvent.setup();
    page();
    await u.click(await screen.findByRole("button", { name: "Select items to delete" }));
    await u.click(screen.getByRole("checkbox", { name: "Select eggs" }));
    await u.click(screen.getByRole("checkbox", { name: "Select milk" }));
    now = [item(2, "milk"), item(3, "bread")]; // someone else deleted the eggs
    live.fn?.();
    expect(await screen.findByRole("button", { name: "Delete 1 item" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Delete 1 item" }));
    await u.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(s.writes().at(-1)).toMatchObject({ path: "/api/grocery/items/delete", body: { ids: [2] } }));
  });

  it("the tab shows how many are left in brackets", async () => {
    fakeServer(routes());
    page();
    const tab = await screen.findByRole("button", { name: "Week of November 16 (3)" });
    expect(within(tab).getByText("(3)")).toHaveClass("font-bold");
  });
});

describe("grocery list: archive, rename, no lists", () => {
  const archived = [{ id: 9, name: "Week of November 9", archivedAt: "2026-11-15T18:00:00Z", open: 1, done: 1 }];
  const oldItems = [item(20, "chicken", { listId: 9, quantity: 2, unit: "lb", aisle: "meat" }), item(21, "rice", { listId: 9, aisle: "pantry", checked: true })];
  const routes = (active = lists) => ({
    "GET /api/grocery/lists": (_b: any, path: string) => (path.includes("archived=1") ? archived : active),
    "GET /api/grocery/this-week": () => ({ name: "Week of November 16", listId: active.find((l) => l.name === "Week of November 16")?.id ?? null }),
    "GET /api/grocery/lists/:id/items": (_b: any, path: string) => (path.includes("/9/") ? oldItems : [item(1, "eggs")]),
    "POST /api/grocery/lists/:id/archive": () => ({}),
    "POST /api/grocery/lists/:id/bring-forward": (b: any) => ({ status: 201, json: { listId: b.listId ?? 5, added: b.itemIds.length, merged: 0 } }),
    "POST /api/grocery/lists": (b: any) => ({ status: 201, json: { id: 5, name: b.name, open: 0, done: 0 } }),
    "PATCH /api/grocery/lists/:id": (b: any) => (b.name === "Costco" ? { status: 409, json: { error: 'There\'s already a list called "Costco"' } } : { id: 1, name: b.name }),
  });

  it("archives the list after a confirm", async () => {
    const s = fakeServer(routes());
    const u = userEvent.setup();
    page();
    await u.click(await screen.findByRole("button", { name: "Archive this list" }));
    expect(s.writes()).toEqual([]);
    await u.click(screen.getByRole("button", { name: 'Archive "Week of November 16"? It moves to Archived lists.' }));
    await waitFor(() => expect(s.writes()).toEqual([expect.objectContaining({ method: "POST", path: "/api/grocery/lists/1/archive" })]));
  });

  it("Delete is there even with one list", async () => {
    fakeServer(routes());
    page();
    expect(await screen.findByRole("button", { name: 'Delete the "Week of November 16" list' })).toBeInTheDocument();
  });

  it("renames a list, and says when the name is taken", async () => {
    const s = fakeServer(routes());
    const u = userEvent.setup();
    page();
    await u.click(await screen.findByRole("button", { name: "Rename this list" }));
    const box = screen.getByRole("textbox", { name: "List name" });
    expect(box).toHaveValue("Week of November 16");
    await u.clear(box);
    await u.type(box, "Costco");
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('There\'s already a list called "Costco"');
    await u.clear(box);
    await u.type(box, "Big shop");
    await u.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(s.writes().at(-1)).toMatchObject({ method: "PATCH", path: "/api/grocery/lists/1", body: { name: "Big shop" } }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename list" })).not.toBeInTheDocument());
  });

  it("archiving the last list clears its items off the page", async () => {
    let active = lists;
    const r = routes();
    fakeServer({ ...r, "GET /api/grocery/lists": (_b: any, path: string) => (path.includes("archived=1") ? archived : active), "POST /api/grocery/lists/:id/archive": () => ((active = []), {}) });
    const u = userEvent.setup();
    page();
    await screen.findByRole("checkbox", { name: "eggs" });
    await u.click(screen.getByRole("button", { name: "Archive this list" }));
    await u.click(screen.getByRole("button", { name: /It moves to Archived lists/ }));
    expect(await screen.findByText("No grocery lists right now.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "eggs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select items to delete" })).not.toBeInTheDocument();
  });

  it("a slow reply for a list you've left doesn't put its items back", async () => {
    let active = lists;
    let release = () => {};
    let slow = false;
    const r = routes();
    fakeServer({
      ...r,
      "GET /api/grocery/lists": (_b: any, path: string) => (path.includes("archived=1") ? archived : active),
      "GET /api/grocery/lists/:id/items": () => (slow ? new Promise((res) => (release = () => res([item(1, "eggs")]))) : [item(1, "eggs")]),
      "POST /api/grocery/lists/:id/archive": () => ((active = []), {}),
    });
    const u = userEvent.setup();
    page();
    await screen.findByRole("checkbox", { name: "eggs" });
    slow = true;
    live.fn?.(); // someone else changed the list: reload, but the answer is slow
    await u.click(screen.getByRole("button", { name: "Archive this list" }));
    await u.click(screen.getByRole("button", { name: /It moves to Archived lists/ }));
    await screen.findByText("No grocery lists right now.");
    release();
    await new Promise((res) => setTimeout(res, 50));
    expect(screen.queryByRole("checkbox", { name: "eggs" })).not.toBeInTheDocument();
  });

  it("no lists left: offers this week's list", async () => {
    const s = fakeServer(routes([]));
    const u = userEvent.setup();
    page();
    await u.click(await screen.findByRole("button", { name: "Start Week of November 16" }));
    await waitFor(() => expect(s.writes()).toEqual([expect.objectContaining({ method: "POST", path: "/api/grocery/lists", body: { name: "Week of November 16" } })]));
  });

  it("opens an archived list read-only and brings chosen items forward", async () => {
    const s = fakeServer(routes());
    const u = userEvent.setup();
    page();
    await u.click(await screen.findByRole("button", { name: "Archived lists" }));
    const popup = screen.getByRole("dialog", { name: "Archived lists" });
    await u.click(await within(popup).findByRole("button", { name: /Week of November 9/ }));
    const view = await screen.findByRole("dialog", { name: "Week of November 9" });
    expect(await within(view).findByText("chicken")).toBeInTheDocument();
    expect(within(view).queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    // all ticked to start; untick rice
    expect(within(view).getByRole("checkbox", { name: /chicken/ })).toBeChecked();
    await u.click(within(view).getByRole("checkbox", { name: /rice/ }));
    expect(within(view).getByRole("combobox", { name: "Add to" })).toHaveValue("1");
    await u.click(within(view).getByRole("button", { name: "Add 1 item" }));
    await waitFor(() => expect(s.writes()).toEqual([expect.objectContaining({ method: "POST", path: "/api/grocery/lists/9/bring-forward", body: { itemIds: [20], listId: 1 } })]));
    expect(await within(view).findByText("Added 1 item to Week of November 16.")).toBeInTheDocument();
  });

  it("brings items forward onto a new list", async () => {
    const s = fakeServer(routes());
    const u = userEvent.setup();
    page();
    await u.click(await screen.findByRole("button", { name: "Archived lists" }));
    await u.click(await screen.findByRole("button", { name: /Week of November 9/ }));
    const view = await screen.findByRole("dialog", { name: "Week of November 9" });
    await within(view).findByText("chicken");
    await u.selectOptions(within(view).getByRole("combobox", { name: "Add to" }), "new");
    const name = within(view).getByRole("textbox", { name: "New list name" });
    await u.clear(name);
    await u.type(name, "Costco run");
    await u.click(within(view).getByRole("button", { name: "Add 2 items" }));
    await waitFor(() => expect(s.writes()[0]).toMatchObject({ body: { itemIds: [20, 21], name: "Costco run" } }));
  });
});
