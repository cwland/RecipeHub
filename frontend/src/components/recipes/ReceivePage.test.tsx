import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReceivePage from "./ReceivePage";
import { fakeServer } from "../../test/fakeServer";

// #/recipes/receive: the page the Send to RecipeHub bookmark sent (kept by /receive.html)
const URL_ = "https://kitchen.example.com/recipes/13647-slow-cooker-apple-cider-pork";
const page = '<!DOCTYPE html><html><head><title>Slow-Cooker Apple Cider Pork | Example Kitchen</title></head><body><h1>Pork</h1></body></html>';
const keep = () => localStorage.setItem("recipehub-sent-page", JSON.stringify({ url: URL_, html: page, at: Date.now() }));
const job = (over: object) => ({ id: 51, kind: "import-url", status: "queued", source: URL_, result: null, error: null, createdAt: "2026-10-31T20:00:00Z", ...over });

describe("a page sent from your browser", () => {
  afterEach(() => {
    localStorage.clear();
    window.location.hash = "";
  });

  it("asks before importing (any site could send one)", async () => {
    keep();
    const server = fakeServer({ "GET /api/ai/status": () => ({ ready: false, photos: false }) });
    render(<ReceivePage />);
    expect(await screen.findByText("Import the recipe from kitchen.example.com?")).toBeInTheDocument();
    expect(screen.getByText("Slow-Cooker Apple Cider Pork | Example Kitchen")).toBeInTheDocument();
    expect(server.writes()).toHaveLength(0);
  });

  it("Import sends the page with its link, and follows the import", async () => {
    keep();
    window.location.hash = "#/recipes/receive";
    const server = fakeServer({
      "GET /api/ai/status": () => ({ ready: false, photos: false }),
      "POST /api/recipes/import": () => ({ status: 202, json: job({}) }),
      "GET /api/imports/51": () => job({ status: "done", result: { recipeId: 9, title: "Pork", how: "schema.org", sent: true } }),
    });
    const u = userEvent.setup();
    render(<ReceivePage />);
    await u.click(await screen.findByRole("button", { name: "Import" }));
    await waitFor(() => expect(server.writes()[0]).toMatchObject({ path: "/api/recipes/import", body: { url: URL_, html: page } }));
    await waitFor(() => expect(window.location.hash).toBe("#/recipes/9?imported=1"), { timeout: 4000 });
  });

  it("nothing sent (opened by hand): says how to use the bookmark", () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: false, photos: false }) });
    render(<ReceivePage />);
    expect(screen.getByText(/Send to RecipeHub bookmark/)).toBeInTheDocument();
  });

  it("too big to send: says so, and what to do instead", () => {
    window.location.hash = "#/recipes/receive?too-big=1";
    fakeServer({ "GET /api/ai/status": () => ({ ready: false, photos: false }) });
    render(<ReceivePage />);
    expect(screen.getByRole("alert")).toHaveTextContent("That page is too big to send. Copy the recipe and use Paste the recipe instead.");
  });
});
