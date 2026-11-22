import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InboxButton, InboxDrawer } from "./Inbox";
import { forgetAiStatus } from "../ai";
import { fakeServer } from "../test/fakeServer";

// The inbox: links, notes and recipe data sent in by the RecipeHub Companion extension
const items = [
  { id: 1, type: "RECIPE_LINK", title: "Pork Roast", url: "https://www.example.com/pork-roast", content: null, sourceApp: "RecipeHub Companion", metadata: { favIconUrl: "https://www.example.com/favicon.ico" }, status: "PENDING", sentBy: "RecipeHub Companion", createdAt: new Date(Date.now() - 5 * 60_000).toISOString(), reviewedAt: null },
  { id: 2, type: "TEXT_NOTE", title: "Try brining overnight", url: null, content: "Try brining overnight\nand less salt", sourceApp: null, metadata: null, status: "PENDING", sentBy: "Alex", createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(), reviewedAt: null },
  { id: 3, type: "RAW_RECIPE_DATA", title: "Chili", url: "https://example.com/chili", content: '{"@type":"Recipe","name":"Chili","recipeIngredient":["1 lb beef"]}', sourceApp: "RecipeHub Companion", metadata: null, status: "PENDING", sentBy: "RecipeHub Companion", createdAt: new Date(Date.now() - 86400_000).toISOString(), reviewedAt: null },
  { id: 4, type: "INSTAGRAM_LINK", title: "instagram.com", url: "https://www.instagram.com/p/abc/", content: null, sourceApp: "RecipeHub Companion", metadata: null, status: "PENDING", sentBy: "RecipeHub Companion", createdAt: new Date(Date.now() - 3 * 86400_000).toISOString(), reviewedAt: null },
];
const job = (over: object) => ({ id: 40, kind: "import-url", status: "queued", source: "https://www.example.com/pork-roast", result: null, error: null, createdAt: "2026-11-02T10:00:00Z", ...over });
const routes = (more: Record<string, any> = {}) =>
  fakeServer({
    "GET /api/ai/status": () => ({ ready: false, photos: false }),
    "GET /api/inbox/count": () => ({ pending: 4 }),
    "GET /api/inbox": (_: unknown, path: string) =>
      path.includes("DISMISSED") ? [{ ...items[0], id: 9, title: "Old link", status: "DISMISSED" }] : path.includes("PROCESSED") ? [{ ...items[0], id: 8, title: "Chili", status: "PROCESSED", recipeId: 31, sentBy: "RecipeHub Companion import" }, { ...items[0], id: 6, title: "Gone soup", status: "PROCESSED", recipeId: null }] : items,
    "PATCH /api/inbox/:id": (b: any, path: string) => ({ ...items.find((i) => path.endsWith(`/${i.id}`)) ?? items[0], status: b.status }),
    "DELETE /api/inbox/:id": () => ({ status: 204 }),
    ...more,
  });
beforeEach(() => forgetAiStatus());

describe("the inbox button", () => {
  it("shows how many are waiting", async () => {
    routes();
    render(<InboxButton variant="rail" onOpen={() => {}} />);
    expect(await screen.findByRole("button", { name: "Inbox, 4 waiting" })).toHaveTextContent("4");
  });

  it("no badge when nothing is waiting", async () => {
    routes({ "GET /api/inbox/count": () => ({ pending: 0 }) });
    render(<InboxButton variant="rail" onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Inbox" })).toHaveTextContent(""));
  });
});

describe("the inbox drawer", () => {
  it("lists what's waiting: title, its site's icon, what it is, where from and when", async () => {
    routes();
    render(<InboxDrawer onClose={() => {}} />);
    const drawer = screen.getByRole("dialog", { name: "Inbox" });
    const list = await within(drawer).findByRole("list", { name: "Waiting" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(4);
    expect(cards[0]).toHaveTextContent(/Pork Roast.*Recipe link.*example\.com.*5 min ago.*RecipeHub Companion/);
    expect(cards[0].querySelector("img")).toHaveAttribute("src", "https://www.example.com/favicon.ico"); // decorative (alt="")
    expect(within(cards[0]).getByRole("link", { name: "Pork Roast" })).toHaveAttribute("href", "https://www.example.com/pork-roast");
    expect(cards[1]).toHaveTextContent(/Note.*2 hr ago.*Alex.*and less salt/);
    expect(cards[1].textContent!.match(/Try brining overnight/g)).toHaveLength(1); // the title isn't repeated
    expect(cards[2]).toHaveTextContent(/Recipe data/);
    expect(cards[3]).toHaveTextContent(/Instagram/);
  });

  it("Import on a link opens the import window and starts it; once the recipe is in, the item is done", async () => {
    let polls = 0;
    const s = routes({
      "POST /api/recipes/import": () => ({ status: 202, json: job({}) }),
      "GET /api/imports/:id": () => (++polls > 1 ? job({ status: "done", result: { recipeId: 7, title: "Pork Roast" } }) : job({ status: "running" })),
    });
    const u = userEvent.setup();
    render(<InboxDrawer onClose={() => {}} />);
    const card = (await screen.findAllByRole("listitem"))[0];
    await u.click(within(card).getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("dialog", { name: "Add a recipe" })).toBeInTheDocument();
    await waitFor(() => expect(s.writes().find((w) => w.path === "/api/recipes/import")?.body).toEqual({ url: "https://www.example.com/pork-roast" }));
    await waitFor(() => expect(s.writes().find((w) => w.method === "PATCH")).toMatchObject({ path: "/api/inbox/1", body: { status: "PROCESSED", recipeId: 7 } }), { timeout: 4000 });
    await waitFor(() => expect(window.location.hash).toBe("#/recipes/7?imported=1"));
  });

  it("Import on recipe data sends it as the page, so the recipe is read from it", async () => {
    const s = routes({ "POST /api/recipes/import": () => ({ status: 202, json: job({}) }), "GET /api/imports/:id": () => job({ status: "running" }) });
    const u = userEvent.setup();
    render(<InboxDrawer onClose={() => {}} />);
    await u.click(within((await screen.findAllByRole("listitem"))[2]).getByRole("button", { name: "Import" }));
    await waitFor(() => expect(s.writes().find((w) => w.path === "/api/recipes/import")).toBeTruthy());
    const body = s.writes().find((w) => w.path === "/api/recipes/import")!.body;
    expect(body.url).toBe("https://example.com/chili");
    expect(body.html).toContain('<script type="application/ld+json">{"@type":"Recipe","name":"Chili"');
  });

  it("Import on a note opens the import window with its text, to read as a recipe", async () => {
    routes();
    const u = userEvent.setup();
    render(<InboxDrawer onClose={() => {}} />);
    await u.click(within((await screen.findAllByRole("listitem"))[1]).getByRole("button", { name: "Import" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a recipe" });
    expect(within(dialog).getByRole("textbox", { name: /The whole recipe/ })).toHaveValue("Try brining overnight\nand less salt");
  });

  it("Dismiss takes it off the list; Dismissed shows it, to bring back or delete for good", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<InboxDrawer onClose={() => {}} />);
    const card = (await screen.findAllByRole("listitem"))[0];
    await u.click(within(card).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(s.writes()[0]).toMatchObject({ method: "PATCH", path: "/api/inbox/1", body: { status: "DISMISSED" } });

    await u.click(screen.getByRole("tab", { name: "Dismissed" }));
    const old = await screen.findByRole("list", { name: "Dismissed" });
    await u.click(within(old).getByRole("button", { name: "Bring back" }));
    await waitFor(() => expect(s.writes().at(-1)).toMatchObject({ method: "PATCH", path: "/api/inbox/9", body: { status: "PENDING" } }));
  });

  it("Delete removes a dismissed item for good", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<InboxDrawer onClose={() => {}} />);
    await u.click(await screen.findByRole("tab", { name: "Dismissed" }));
    const old = await screen.findByRole("list", { name: "Dismissed" });
    await u.click(within(old).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(s.writes().at(-1)).toMatchObject({ method: "DELETE", path: "/api/inbox/9" }));
    expect(await screen.findByText("Nothing dismissed.")).toBeInTheDocument();
  });

  it("Imported: what became recipes (from the inbox, or imported straight from the extension), with a link to each", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<InboxDrawer onClose={() => {}} />);
    expect((await screen.findAllByRole("tab")).map((t) => t.textContent)).toEqual(["Waiting", "Imported", "Dismissed"]);
    await u.click(screen.getByRole("tab", { name: "Imported" }));
    const list = await screen.findByRole("list", { name: "Imported" });
    const [chili, gone] = within(list).getAllByRole("listitem");
    expect(within(chili).getByRole("link", { name: "Open the recipe" })).toHaveAttribute("href", "#/recipes/31");
    expect(chili).toHaveTextContent(/Imported/);
    expect(within(chili).queryByRole("button", { name: "Import" })).toBeNull();
    expect(within(gone).queryByRole("link", { name: "Open the recipe" })).toBeNull(); // the recipe was deleted since
    expect(gone).toHaveTextContent(/deleted/);
    await u.click(within(chili).getByRole("button", { name: "Remove from the list" }));
    await waitFor(() => expect(s.writes().at(-1)).toMatchObject({ method: "DELETE", path: "/api/inbox/8" }));
  });

  it("switching tabs before a slow list arrives: the tab you're on wins", async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    routes({ "GET /api/inbox": async (_: unknown, path: string) => (path.includes("PROCESSED") ? [{ ...items[0], id: 8, title: "Chili", status: "PROCESSED", recipeId: 31 }] : (await slow, items)) });
    const u = userEvent.setup();
    render(<InboxDrawer onClose={() => {}} />);
    await u.click(screen.getByRole("tab", { name: "Imported" }));
    expect(await screen.findByRole("list", { name: "Imported" })).toHaveTextContent("Chili");
    release(); // the Waiting list turns up late
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("list", { name: "Imported" })).toHaveTextContent("Chili");
    expect(screen.queryByText("Pork Roast")).toBeNull();
  });

  it("empty: says how things get here", async () => {
    routes({ "GET /api/inbox": () => [] });
    render(<InboxDrawer onClose={() => {}} />);
    expect(await screen.findByText(/Nothing waiting/)).toBeInTheDocument();
    expect(screen.getByText(/RecipeHub Companion/)).toBeInTheDocument();
  });
});
