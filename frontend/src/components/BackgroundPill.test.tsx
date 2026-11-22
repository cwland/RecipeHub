import { describe, expect, it } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BackgroundPill, startedInBackground } from "./BackgroundPill";
import { fakeServer } from "../test/fakeServer";

// The floating pill at the top of every screen: what's running in the background
const job = (over: object) => ({ id: 40, kind: "import-improve", status: "running", source: "My Recipes.paprikarecipes", result: { total: 42, done: 17, improved: 15, unchanged: 1, failed: [] }, error: null, createdAt: "2026-11-01T20:00:00Z", ...over });

describe("the background status pill", () => {
  it("an AI batch: a spinner and how far along; tapping it opens the progress", async () => {
    fakeServer({ "GET /api/imports/active": () => [job({})] });
    render(<BackgroundPill />);
    const pill = await screen.findByRole("status", { name: "In the background" });
    expect(pill).toHaveTextContent("Improving 18 of 42…");
    expect(within(pill).getByRole("link")).toHaveAttribute("href", "#/recipes/improving/40");
    expect(pill.querySelector(".animate-spin")).not.toBeNull();
  });

  it("a file being imported", async () => {
    fakeServer({ "GET /api/imports/active": () => [job({ id: 41, kind: "import-file", status: "running", result: null })] });
    render(<BackgroundPill />);
    expect(await screen.findByRole("status", { name: "In the background" })).toHaveTextContent("Importing My Recipes.paprikarecipes…");
  });

  it("a batch that just finished says so, and can be dismissed", async () => {
    fakeServer({ "GET /api/imports/active": () => [job({ status: "done", result: { total: 10, done: 10, improved: 9, unchanged: 1, failed: [] } })] });
    const u = userEvent.setup();
    render(<BackgroundPill />);
    const pill = await screen.findByRole("status", { name: "In the background" });
    expect(pill).toHaveTextContent("Improved 9 of 10 recipes");
    expect(pill.querySelector(".animate-spin")).toBeNull();
    await u.click(within(pill).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status", { name: "In the background" })).toBeNull();
  });

  it("two things at once: the first, and how many more", async () => {
    fakeServer({ "GET /api/imports/active": () => [job({}), job({ id: 41, kind: "import-file", result: null })] });
    render(<BackgroundPill />);
    expect(await screen.findByRole("status", { name: "In the background" })).toHaveTextContent("Improving 18 of 42… +1 more");
  });

  it("nothing in the background: no pill", async () => {
    const server = fakeServer({ "GET /api/imports/active": () => [] });
    render(<BackgroundPill />);
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
    expect(server.sent.some((s) => s.path === "/api/imports/active")).toBe(true);
    expect(screen.queryByRole("status", { name: "In the background" })).toBeNull();
  });

  it("starting one shows Import started straight away", async () => {
    fakeServer({ "GET /api/imports/active": () => [] });
    render(<BackgroundPill />);
    await act(async () => startedInBackground(job({ status: "queued", result: { total: 42, done: 0 } }) as never));
    expect(screen.getByRole("status", { name: "In the background" })).toHaveTextContent("Import started");
  });
});
