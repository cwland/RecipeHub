import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShareDialog from "./ShareDialog";
import { fakeServer } from "../../test/fakeServer";

const A = { path: "/share/rcp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", url: "https://recipes.test/share/rcp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", on: true };
const B = { path: "/share/rcp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", url: "https://recipes.test/share/rcp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", on: true };

describe("the recipe's public link (Share)", () => {
  it("shows the link, and copies it", async () => {
    fakeServer({ "GET /api/recipes/7/share-link": () => A });
    const u = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText");
    render(<ShareDialog recipe={{ id: 7, title: "Chili" }} onClose={() => {}} />);
    const box = await screen.findByRole("region", { name: "Public link" });
    expect(await within(box).findByRole("textbox", { name: "Public link" })).toHaveValue(A.url);
    await u.click(within(box).getByRole("button", { name: "Copy link" }));
    expect(write).toHaveBeenCalledWith(A.url);
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied");
  });

  it("New link asks first, then replaces it (the old one stops working)", async () => {
    const server = fakeServer({ "GET /api/recipes/7/share-link": () => A, "POST /api/recipes/7/share-link/new": () => B });
    const u = userEvent.setup();
    render(<ShareDialog recipe={{ id: 7, title: "Chili" }} onClose={() => {}} />);
    const box = await screen.findByRole("region", { name: "Public link" });
    await within(box).findByDisplayValue(A.url);
    await u.click(within(box).getByRole("button", { name: "New link" }));
    expect(box).toHaveTextContent("The current link will stop working");
    expect(server.writes()).toHaveLength(0);
    await u.click(within(box).getByRole("button", { name: "Make a new link" }));
    await waitFor(() => expect(within(box).getByRole("textbox", { name: "Public link" })).toHaveValue(B.url));
  });

  it("with public links off, says so instead", async () => {
    fakeServer({ "GET /api/recipes/7/share-link": () => ({ ...A, on: false }) });
    render(<ShareDialog recipe={{ id: 7, title: "Chili" }} onClose={() => {}} />);
    const box = await screen.findByRole("region", { name: "Public link" });
    expect(await within(box).findByText(/Public share links are off/)).toBeInTheDocument();
    expect(within(box).queryByRole("button", { name: "Copy link" })).toBeNull();
  });
});

describe("downloads (Share)", () => {
  it("every format, from the app", async () => {
    const got: string[] = [];
    fakeServer({ "GET /api/recipes/7/share-link": () => A, "GET /api/recipes/7/export": (_b, path) => (got.push(path), new Response("file", { headers: { "content-disposition": 'attachment; filename="chili.pdf"' } })) });
    const u = userEvent.setup();
    URL.createObjectURL ??= () => "blob:x";
    URL.revokeObjectURL ??= () => {};
    render(<ShareDialog recipe={{ id: 7, title: "Chili" }} onClose={() => {}} />);
    const box = await screen.findByRole("region", { name: "Download" });
    expect(within(box).getAllByRole("button").map((b) => b.textContent)).toEqual(["PDF", "JSON-LD", "Paprika", "Meal-Master", "CookML"]);
    await u.click(within(box).getByRole("button", { name: "Paprika" }));
    await waitFor(() => expect(got).toEqual(["/api/recipes/7/export?format=paprika"]));
  });
});

describe("ways to send it (Share)", () => {
  const routes = (link = A, emailOn = true) => ({ "GET /api/settings/email": () => ({ active: emailOn }), "GET /api/recipes/7/share-link": () => link, "POST /api/recipes/7/email": () => ({ sent: 1 }), "GET /api/recipes/7/export": () => new Response("%PDF-1.7 file", { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="chili.pdf"' } }) });
  const open = async () => {
    const u = userEvent.setup();
    render(<ShareDialog recipe={{ id: 7, title: "Chili" }} onClose={() => {}} />);
    await screen.findByDisplayValue(A.url);
    return u;
  };
  const setShare = (share?: (d: ShareData) => Promise<void>, canShare?: (d: ShareData) => boolean) => {
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: canShare, configurable: true });
  };
  URL.createObjectURL ??= () => "blob:x";
  URL.revokeObjectURL ??= () => {};

  it("Share… opens the phone's (or Mac's) share sheet with the title and link; hidden where there isn't one", async () => {
    setShare(undefined);
    fakeServer(routes());
    const { unmount } = render(<ShareDialog recipe={{ id: 7, title: "Chili" }} onClose={() => {}} />);
    await screen.findByDisplayValue(A.url);
    expect(screen.queryByRole("button", { name: "Share…" })).toBeNull();
    unmount();
    const share = vi.fn(async () => {});
    setShare(share);
    fakeServer(routes());
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Share…" }));
    expect(share).toHaveBeenCalledWith({ title: "Chili", text: "Chili", url: A.url });
    setShare(undefined);
  });

  it("Share… with a file chosen sends the file too, where the share sheet takes files", async () => {
    const share = vi.fn(async (_d: ShareData) => {});
    setShare(share, () => true);
    fakeServer(routes());
    const u = await open();
    await u.selectOptions(screen.getByRole("combobox", { name: "Attach a file" }), "pdf");
    await u.click(screen.getByRole("button", { name: "Share…" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    const data = share.mock.calls[0][0];
    expect(data).toMatchObject({ title: "Chili", url: A.url });
    expect(data.files?.[0]).toMatchObject({ name: "chili.pdf", type: "application/pdf" });
    setShare(undefined);
  });

  it("Mail app: opens a new email with the subject and link filled in", async () => {
    fakeServer(routes());
    const go = vi.spyOn(window, "open").mockReturnValue(null);
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Mail app" }));
    const url = String(go.mock.calls[0][0]);
    expect(url.startsWith("mailto:?subject=Chili&body=")).toBe(true);
    expect(decodeURIComponent(url)).toContain(A.url);
    go.mockRestore();
  });

  it("Mail app with a file: downloads it first and says to attach it (mail links can't carry files)", async () => {
    const server = fakeServer(routes());
    const go = vi.spyOn(window, "open").mockReturnValue(null);
    const u = await open();
    await u.selectOptions(screen.getByRole("combobox", { name: "Attach a file" }), "pdf");
    await u.click(screen.getByRole("button", { name: "Mail app" }));
    await waitFor(() => expect(go).toHaveBeenCalled());
    expect(server.sent.some((s) => s.path === "/api/recipes/7/export?format=pdf")).toBe(true);
    expect(await screen.findByText("chili.pdf is in your downloads: attach it to the email.")).toBeInTheDocument();
    go.mockRestore();
  });

  it("two tabs: Link & downloads (to start with) and Email", async () => {
    fakeServer(routes());
    const u = await open();
    const tabs = screen.getByRole("tablist", { name: "Share" });
    expect(within(tabs).getAllByRole("tab").map((x) => x.textContent)).toEqual(["Link & downloads", "Email"]);
    expect(within(tabs).getByRole("tab", { name: "Link & downloads" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Download" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Send from RecipeHub" })).toBeNull();
    await u.click(within(tabs).getByRole("tab", { name: "Email" }));
    expect(screen.getByRole("form", { name: "Send from RecipeHub" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Download" })).toBeNull();
  });

  it("Send from RecipeHub: to and note, then the file to attach, then Send", async () => {
    const server = fakeServer(routes());
    const u = await open();
    await u.click(screen.getByRole("tab", { name: "Email" }));
    const form = screen.getByRole("form", { name: "Send from RecipeHub" });
    const order = [...form.querySelectorAll("input, textarea, select, button")].map((el) => el.getAttribute("aria-label") || el.id || el.textContent);
    expect(order).toEqual(["share-to", "share-note", "share-email-attach", "Send"]);
    await u.type(within(form).getByLabelText("To"), "mom@example.com");
    await u.type(within(form).getByLabelText(/Note/), "Try it!");
    await u.selectOptions(within(form).getByRole("combobox", { name: "Attach a file" }), "paprika");
    await u.click(within(form).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(server.writes().find((w) => w.path === "/api/recipes/7/email")?.body).toEqual({ to: "mom@example.com", note: "Try it!", attach: "paprika" }));
    expect(await within(form).findByText("Sent to mom@example.com.")).toBeInTheDocument();
  });

  it("email not set up: the Email tab still opens, warns, links to the setting, and won't send", async () => {
    fakeServer(routes(A, false));
    const u = await open();
    await u.click(screen.getByRole("tab", { name: "Email" }));
    expect(await screen.findByText(/Email isn't set up yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Settings › Email/ })).toHaveAttribute("href", "#/settings/email");
    const form = screen.getByRole("form", { name: "Send from RecipeHub" });
    await u.type(within(form).getByLabelText("To"), "mom@example.com");
    expect(within(form).getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("with public links off: Copy, Share… and Mail app need the link, so they aren't offered; email still is", async () => {
    setShare(vi.fn(async () => {}));
    fakeServer(routes({ ...A, on: false }));
    const u = userEvent.setup();
    render(<ShareDialog recipe={{ id: 7, title: "Chili" }} onClose={() => {}} />);
    await screen.findByText(/Public share links are off/);
    for (const name of ["Copy link", "Share…", "Mail app"]) expect([name, screen.queryByRole("button", { name })]).toEqual([name, null]);
    await u.click(screen.getByRole("tab", { name: "Email" }));
    expect(screen.getByRole("form", { name: "Send from RecipeHub" })).toBeInTheDocument();
    setShare(undefined);
  });
});
