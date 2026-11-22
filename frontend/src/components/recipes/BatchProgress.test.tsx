import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BatchProgress from "./BatchProgress";
import { fakeServer } from "../../test/fakeServer";

const batch = (status: string, result: object | null) => ({ id: 40, kind: "import-improve", status, source: "My Recipes.paprikarecipes", result, error: null, createdAt: "2026-10-31T14:00:00Z" });

describe("improving imported recipes automatically", () => {
  it("shows how far along it is, and Stop asks it to stop", async () => {
    const server = fakeServer({ "GET /api/imports/40": () => batch("running", { total: 42, done: 17, improved: 15, unchanged: 1, failed: [{ title: "Toast", reason: "The AI didn't answer" }] }), "POST /api/imports/40/stop": () => batch("running", { total: 42, done: 17 }) });
    const u = userEvent.setup();
    render(<BatchProgress job={40} />);
    expect(await screen.findByText("Improving 18 of 42…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Recipes improved" })).toHaveAttribute("aria-valuenow", "17");
    expect(screen.getByText(/From My Recipes\.paprikarecipes/)).toBeInTheDocument();
    expect(screen.getByText("15 improved · 1 needed no changes · 1 couldn't be improved")).toBeInTheDocument();
    expect(screen.getByText("Each recipe's original is kept as v1 in its Version history.")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(server.writes().map((w) => w.path)).toEqual(["/api/imports/40/stop"]));
    expect(await screen.findByText(/Stopping after this recipe/)).toBeInTheDocument();
  });

  it("when it's done: what was improved, and which couldn't be", async () => {
    fakeServer({ "GET /api/imports/40": () => batch("done", { total: 42, done: 42, improved: 39, unchanged: 1, failed: [{ title: "Toast", reason: "The AI didn't answer" }, { title: "Soup", reason: "Timed out" }] }) });
    render(<BatchProgress job={40} />);
    const done = await screen.findByRole("status", { name: "Batch finished" });
    expect(done).toHaveTextContent("Improved 39 of 42 recipes. 1 needed no changes.");
    const failed = within(done).getByRole("list", { name: "Couldn't be improved" });
    expect(failed).toHaveTextContent("Toast: The AI didn't answer");
    expect(failed).toHaveTextContent("Soup: Timed out");
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("stopped early says so", async () => {
    fakeServer({ "GET /api/imports/40": () => batch("done", { total: 42, done: 10, improved: 10, unchanged: 0, failed: [], stopped: true }) });
    render(<BatchProgress job={40} />);
    expect(await screen.findByRole("status", { name: "Batch finished" })).toHaveTextContent("Stopped after 10 of 42 recipes: 10 improved.");
  });

  it("waiting its turn", async () => {
    fakeServer({ "GET /api/imports/40": () => batch("queued", null) });
    render(<BatchProgress job={40} />);
    expect(await screen.findByText("Starting…")).toBeInTheDocument();
  });
});
