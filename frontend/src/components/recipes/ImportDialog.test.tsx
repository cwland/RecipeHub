import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetAiStatus } from "../../ai";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportDialog from "./ImportDialog";
import { fakeServer } from "../../test/fakeServer";

const job = (over: Record<string, unknown>) => ({ id: 31, kind: "import-file", status: "queued", source: "My Recipes.paprikarecipes", result: null, error: null, createdAt: "2026-10-31T14:00:00Z", ...over });

describe("importing a file from another app", () => {
  it("uploads the file, then says how many came in, how many were already there, and what couldn't be used", async () => {
    let polls = 0;
    const server = fakeServer({
      "GET /api/ai/status": () => ({ ready: false, photos: false }),
      "GET /api/imports": () => [],
      "POST /api/recipes/import/file": () => ({ status: 202, json: job({}) }),
      "GET /api/imports/31": () =>
        ++polls < 2 ? job({ status: "running" }) : job({ status: "done", result: { format: "Paprika", imported: 41, skipped: 3, problems: [{ name: "Untitled.paprikarecipe", reason: "It has no name" }] } }),
    });
    const onClose = vi.fn();
    const u = userEvent.setup();
    render(<ImportDialog onClose={onClose} />);
    await u.click(screen.getByRole("tab", { name: "From a file" }));
    const file = new File([new Uint8Array([80, 75, 3, 4])], "My Recipes.paprikarecipes");
    await u.upload(screen.getByLabelText("Recipe file"), file);
    await u.click(screen.getByRole("button", { name: "Import" }));
    const done = await screen.findByRole("status", { name: "Import finished" }, { timeout: 4000 });
    expect(done).toHaveTextContent("Added 41 recipes from Paprika");
    expect(done).toHaveTextContent("3 were already in your recipes");
    expect(within(done).getByText(/Untitled\.paprikarecipe/)).toHaveTextContent("It has no name");
    const sent = server.writes().find((w) => w.path === "/api/recipes/import/file?choose=1")!;
    expect((sent.body as FormData).get("file")).toBeInstanceOf(File);
    expect(onClose).not.toHaveBeenCalled(); // stays open to show the summary
  });

  it("when recipes came in, the recipe list is told to reload (See your recipes then shows them)", async () => {
    fakeServer({
      "GET /api/ai/status": () => ({ ready: false, photos: false }),
      "GET /api/imports": () => [],
      "POST /api/recipes/import/file": () => ({ status: 202, json: job({}) }),
      "GET /api/imports/31": () => job({ status: "done", result: { format: "Paprika", imported: 1, skipped: 0, problems: [] } }),
    });
    const changed = vi.fn();
    window.addEventListener("recipehub:recipes-changed", changed);
    const u = userEvent.setup();
    render(<ImportDialog onClose={() => {}} />);
    await u.click(screen.getByRole("tab", { name: "From a file" }));
    await u.upload(screen.getByLabelText("Recipe file"), new File([new Uint8Array([80, 75, 3, 4])], "chili.paprikarecipe"));
    await u.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByRole("status", { name: "Import finished" }, { timeout: 4000 });
    await waitFor(() => expect(changed).toHaveBeenCalled());
    window.removeEventListener("recipehub:recipes-changed", changed);
  });
});

describe("no recent imports list (they're in Settings › Logs)", () => {
  it("doesn't list or even load recent imports", async () => {
    const server = fakeServer({ "GET /api/imports": () => [{ id: 1, status: "done", source: "https://example.test/chili", result: { recipeId: 3, title: "Chili" }, error: null }], "GET /api/ai/status": () => ({ ready: true, photos: true, enhance: true }) });
    render(<ImportDialog onClose={() => {}} />);
    await screen.findByRole("button", { name: "Import" });
    expect(screen.queryByText("Recent imports")).toBeNull();
    expect(server.sent.filter((s) => s.path.startsWith("/api/imports"))).toHaveLength(0);
  });
});

describe("PDFs", () => {
  beforeEach(() => forgetAiStatus());
  const routes = (more: Record<string, any> = {}) => ({
    "GET /api/ai/status": () => ({ ready: true, photos: true }),
    "POST /api/recipes/import/file": () => ({ status: 202, json: job({ source: "chili.pdf", kind: "import-file" }) }),
    ...more,
  });

  it("the file tab takes a PDF too (one recipe or a whole cookbook)", async () => {
    fakeServer(routes());
    const u = userEvent.setup();
    render(<ImportDialog onClose={() => {}} />);
    await u.click(screen.getByRole("tab", { name: "From a file" }));
    expect(screen.getByLabelText("Recipe file")).toHaveAttribute("accept", expect.stringContaining(".pdf"));
    expect(screen.getAllByText(/PDF/).length).toBeGreaterThan(0);
  });

  it("the photo tab takes a PDF too, and sends it to be read as a file", async () => {
    const server = fakeServer(routes({ "GET /api/imports/31": () => job({ status: "running" }) }));
    const u = userEvent.setup();
    render(<ImportDialog onClose={() => {}} />);
    await u.click(await screen.findByRole("tab", { name: "From a photo" }));
    expect(screen.getByLabelText("Recipe photos")).toHaveAttribute("accept", expect.stringContaining("application/pdf"));
    await u.upload(screen.getByLabelText("Recipe photos"), new File([new Uint8Array([37, 80, 68, 70])], "card.pdf", { type: "application/pdf" }));
    await u.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(server.writes().map((w) => w.path)).toEqual(["/api/recipes/import/file?choose=1"]));
  });

  it("a PDF with one recipe opens it, like a link would", async () => {
    window.location.hash = "#/recipes";
    fakeServer(routes({ "GET /api/imports/31": () => job({ status: "done", result: { format: "PDF", imported: 1, skipped: 0, recipeIds: [5], problems: [] } }) }));
    const u = userEvent.setup();
    render(<ImportDialog onClose={() => {}} />);
    await u.click(screen.getByRole("tab", { name: "From a file" }));
    await u.upload(screen.getByLabelText("Recipe file"), new File([new Uint8Array([37, 80, 68, 70])], "chili.pdf", { type: "application/pdf" }));
    await u.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(window.location.hash).toBe("#/recipes/5?imported=1"), { timeout: 4000 });
  });

  describe("a file with just one recipe in it (any format)", () => {
  it("a Paprika file with one recipe opens it, so the AI check runs, like a link", async () => {
    window.location.hash = "#/recipes";
    fakeServer(routes({ "GET /api/imports/31": () => job({ status: "done", result: { format: "Paprika", imported: 1, skipped: 0, recipeIds: [5], problems: [] } }) }));
    const u = userEvent.setup();
    render(<ImportDialog onClose={() => {}} />);
    await u.click(screen.getByRole("tab", { name: "From a file" }));
    await u.upload(screen.getByLabelText("Recipe file"), new File([new Uint8Array([80, 75, 3, 4])], "Chili.paprikarecipes"));
    await u.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(window.location.hash).toBe("#/recipes/5?imported=1"), { timeout: 4000 });
  });

  it("one recipe was already there (skipped): nothing to open, it says so", async () => {
    window.location.hash = "#/recipes";
    fakeServer(routes({ "GET /api/imports/31": () => job({ status: "done", result: { format: "Paprika", imported: 0, skipped: 1, recipeIds: [], problems: [] } }) }));
    const u = userEvent.setup();
    render(<ImportDialog onClose={() => {}} />);
    await u.click(screen.getByRole("tab", { name: "From a file" }));
    await u.upload(screen.getByLabelText("Recipe file"), new File([new Uint8Array([80, 75, 3, 4])], "Chili.paprikarecipes"));
    await u.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByRole("status", { name: "Import finished" }, { timeout: 4000 });
    expect(window.location.hash).toBe("#/recipes");
  });
  });
});

describe("after importing many recipes", () => {
  beforeEach(() => forgetAiStatus());
  const done = (ai: object) =>
    fakeServer({
      "GET /api/ai/status": () => ai,
      "POST /api/recipes/import/file": () => ({ status: 202, json: job({}) }),
      "GET /api/imports/31": () => job({ status: "done", result: { format: "Paprika", imported: 3, skipped: 0, recipeIds: [5, 6, 7], problems: [] } }),
      "POST /api/imports/31/improve": () => ({ status: 202, json: { ...job({}), id: 40, kind: "import-improve" } }),
    });
  const run = async () => {
    const u = userEvent.setup();
    render(<ImportDialog onClose={() => {}} />);
    await u.click(screen.getByRole("tab", { name: "From a file" }));
    await u.upload(screen.getByLabelText("Recipe file"), new File([new Uint8Array([80, 75, 3, 4])], "My Recipes.paprikarecipes"));
    await u.click(screen.getByRole("button", { name: "Import" }));
    return screen.findByRole("status", { name: "Import finished" }, { timeout: 4000 });
  };

  it("offers to review them one by one with AI; the originals are kept", async () => {
    done({ ready: true, photos: false, enhance: true });
    const status = await run();
    expect(within(status).getByRole("link", { name: "Review one by one" })).toHaveAttribute("href", "#/recipes/review/31");
    expect(status).toHaveTextContent("Each recipe's original is kept as v1 in its Version history.");
  });

  it("Improve all automatically: says how many AI requests first, then starts it in the background and closes the window", async () => {
    window.location.hash = "#/recipes";
    const server = done({ ready: true, photos: false, enhance: true });
    const improves = () => server.writes().filter((w) => w.path === "/api/imports/31/improve");
    const started: unknown[] = [];
    const listen = (e: Event) => started.push((e as CustomEvent).detail);
    window.addEventListener("recipehub:background", listen);
    const onClose = vi.fn();
    const u = userEvent.setup();
    render(<ImportDialog onClose={onClose} />);
    await u.click(screen.getByRole("tab", { name: "From a file" }));
    await u.upload(screen.getByLabelText("Recipe file"), new File([new Uint8Array([80, 75, 3, 4])], "My Recipes.paprikarecipes"));
    await u.click(screen.getByRole("button", { name: "Import" }));
    const status = await screen.findByRole("status", { name: "Import finished" }, { timeout: 4000 });
    await u.click(within(status).getByRole("button", { name: "Improve all automatically" }));
    expect(status).toHaveTextContent("This asks your AI 3 times, once per recipe.");
    expect(improves()).toHaveLength(0); // not until Start
    await u.click(within(status).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(improves()).toHaveLength(1);
    expect(window.location.hash).toBe("#/recipes"); // it carries on in the background
    expect(started).toMatchObject([{ id: 40, kind: "import-improve" }]);
    window.removeEventListener("recipehub:background", listen);
  });

  it("with AI Enhance off there's nothing to offer", async () => {
    done({ ready: true, photos: false, enhance: false });
    const status = await run();
    expect(within(status).queryByRole("link", { name: "Review one by one" })).toBeNull();
  });
});


describe("a link the site blocks", () => {
  beforeEach(() => forgetAiStatus());
  const URL_ = "https://kitchen.example.com/recipes/13647-slow-cooker-apple-cider-pork";
  const linkJob = (over: Record<string, unknown>) => job({ kind: "import-url", source: URL_, ...over });
  const run = async (answer: () => unknown, ai = { ready: true, photos: true, enhance: false }) => {
    fakeServer({ "GET /api/ai/status": () => ai, "POST /api/recipes/import": () => ({ status: 202, json: linkJob({}) }), "GET /api/imports/31": answer });
    const u = userEvent.setup();
    render(<ImportDialog onClose={() => {}} />);
    await u.type(screen.getByLabelText("Recipe page, blog post or video"), URL_);
    await u.click(screen.getByRole("button", { name: "Import" }));
    return u;
  };

  it("while it looks for a saved copy, it says why and where it's looking", async () => {
    await run(() => linkJob({ status: "running", result: { blocked: { reason: "captcha", by: "Cloudflare", url: URL_ }, trying: "Wayback Machine" } }));
    expect(await screen.findByText("Couldn't get the recipe from kitchen.example.com: it asked for a security check. Trying a saved copy on the Wayback Machine…", {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("read from a saved copy: the recipe opens and says where it came from", async () => {
    window.location.hash = "#/recipes";
    await run(() => linkJob({ status: "done", result: { recipeId: 5, title: "Pork", how: "schema.org", savedCopy: { from: "Wayback Machine", url: `https://web.archive.org/web/20251201185510/${URL_}`, date: "2025-12-01" } } }));
    await waitFor(() => expect(window.location.hash).toBe("#/recipes/5?imported=1&copy=Wayback%20Machine&copied=2025-12-01"), { timeout: 4000 });
  });

  it("nothing worked: what you can do instead", async () => {
    const u = await run(() =>
      linkJob({
        status: "failed",
        error: "kitchen.example.com turned the request away (403). Some sites block apps. No saved copy could be read either: archive.ph asked for a security check.",
        result: { blocked: { reason: "refused", url: URL_ }, savedCopies: [{ from: "Wayback Machine", outcome: "none" }, { from: "archive.ph", outcome: "captcha", link: `https://archive.ph/newest/${URL_}` }] },
      }),
    );
    const box = await screen.findByRole("alert", { name: "Couldn't import" }, { timeout: 4000 });
    expect(box).toHaveTextContent("We were unable to automatically import the recipe");
    expect(box).toHaveTextContent("No saved copy could be read either: archive.ph asked for a security check.");
    expect(within(box).getByRole("link", { name: /Open the saved copy on archive\.ph/ })).toHaveAttribute("href", `https://archive.ph/newest/${URL_}`);
    expect(within(box).getByRole("link", { name: /Open the recipe's page/ })).toHaveAttribute("href", URL_);
    expect(within(box).getByRole("link", { name: "Blank recipe" })).toHaveAttribute("href", `#/recipes/new?source=${encodeURIComponent(URL_)}`);
    expect(within(box).queryByRole("button", { name: "Try again" })).toBeNull(); // a refusal won't change by itself
    await u.click(within(box).getByRole("button", { name: "Paste the recipe" }));
    expect(screen.getByRole("tab", { name: "Paste the recipe" })).toHaveAttribute("aria-selected", "true");
  });

  it("From a photo (a screenshot) is offered when your AI reads photos", async () => {
    const u = await run(() => linkJob({ status: "failed", error: "Blocked.", result: { blocked: { reason: "paywall", url: URL_ }, savedCopies: [] } }));
    const box = await screen.findByRole("alert", { name: "Couldn't import" }, { timeout: 4000 });
    await u.click(within(box).getByRole("button", { name: "From a photo" }));
    expect(screen.getByRole("tab", { name: "From a photo" })).toHaveAttribute("aria-selected", "true");
  });

  it("too many requests or the site down: Try again is offered", async () => {
    await run(() => linkJob({ status: "failed", error: "Busy.", result: { blocked: { reason: "rate-limited", url: URL_ } } }));
    const box = await screen.findByRole("alert", { name: "Couldn't import" }, { timeout: 4000 });
    expect(within(box).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("picking which recipes to import from a file", () => {
  beforeEach(() => forgetAiStatus());
  const choices = [
    { n: 1, title: "apple pie", already: false },
    { n: 3, title: "Bread", already: false },
    { n: 2, title: "Chili", already: true },
    { n: 0, title: "Waffles", already: false },
  ];
  const setup = (ai = { ready: true, photos: false, enhance: true }) =>
    fakeServer({
      "GET /api/ai/status": () => ai,
      "POST /api/recipes/import/file": () => ({ status: 202, json: job({}) }),
      "GET /api/imports/31": () => job({ status: "done", result: { format: "Paprika", choices, problems: [] } }),
      "POST /api/imports/31/choose": () => ({ status: 202, json: job({ id: 32 }) }),
      "GET /api/imports/32": () => job({ id: 32, status: "done", result: { format: "Paprika", imported: 2, skipped: 0, recipeIds: [5, 6], problems: [] } }),
      "POST /api/imports/32/improve": () => ({ status: 202, json: { ...job({}), id: 40, kind: "import-improve" } }),
    });
  const run = async () => {
    const u = userEvent.setup();
    render(<ImportDialog onClose={() => {}} />);
    await u.click(screen.getByRole("tab", { name: "From a file" }));
    await u.upload(screen.getByLabelText("Recipe file"), new File([new Uint8Array([80, 75, 3, 4])], "My Recipes.paprikarecipes"));
    await u.click(screen.getByRole("button", { name: "Import" }));
    return { u, list: await screen.findByRole("group", { name: "Recipes in the file" }, { timeout: 4000 }) };
  };

  it("lists the file's recipes A–Z, ticked (ones you already have are marked and unticked); nothing's imported until Accept", async () => {
    const server = setup();
    const { list } = await run();
    const boxes = within(list).getAllByRole("checkbox");
    expect(boxes.map((b) => b.closest("label")!.textContent)).toEqual(["apple pie", "Bread", "Chilialready in your recipes", "Waffles"]);
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, true, false, true]);
    expect(server.sent[server.sent.findIndex((s) => s.path.startsWith("/api/recipes/import/file"))].path).toBe("/api/recipes/import/file?choose=1");
    expect(server.writes().some((w) => w.path.endsWith("/choose"))).toBe(false);
  });

  it("Accept imports only the ticked ones, then the wizard starts", async () => {
    window.location.hash = "#/recipes";
    const server = setup();
    const { u, list } = await run();
    await u.click(within(list).getByRole("checkbox", { name: "Waffles" }));
    await u.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(server.writes().find((w) => w.path === "/api/imports/31/choose")?.body).toEqual({ keep: [1, 3] }));
    await waitFor(() => expect(window.location.hash).toBe("#/recipes/review/32"), { timeout: 4000 });
  });

  it("Improve all automatically instead: the window closes at once and the pill at the top follows the import, then the improvements", async () => {
    window.location.hash = "#/recipes";
    const server = setup();
    const onClose = vi.fn();
    const seen: unknown[] = [];
    const listen = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("recipehub:background", listen);
    const u = userEvent.setup();
    render(<ImportDialog onClose={onClose} />);
    await u.click(screen.getByRole("tab", { name: "From a file" }));
    await u.upload(screen.getByLabelText("Recipe file"), new File([new Uint8Array([80, 75, 3, 4])], "My Recipes.paprikarecipes"));
    await u.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByRole("group", { name: "Recipes in the file" }, { timeout: 4000 });
    await u.click(screen.getByRole("radio", { name: /Improve all automatically/ }));
    await u.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.writes().find((w) => w.path === "/api/imports/31/choose")?.body).toEqual({ keep: [0, 1, 3], improve: true });
    expect(seen).toEqual([expect.objectContaining({ id: 32 })]); // the import, shown in the pill
    expect(server.writes().some((w) => w.path.endsWith("/improve"))).toBe(false); // the server starts that itself
    window.removeEventListener("recipehub:background", listen);
  });

  it("with Improve with AI off: Accept just imports them", async () => {
    setup({ ready: false, photos: false, enhance: false });
    const { u } = await run();
    expect(screen.queryByRole("radio", { name: /Review each/ })).toBeNull();
    await u.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("status", { name: "Import finished" }, { timeout: 4000 })).toHaveTextContent("Added 2 recipes from Paprika.");
  });

  it("nothing ticked: Accept waits", async () => {
    setup();
    const { u, list } = await run();
    for (const name of ["apple pie", "Bread", "Waffles"]) await u.click(within(list).getByRole("checkbox", { name }));
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
  });
});
