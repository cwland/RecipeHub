import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteData } from "./WipeRecipes";
import { fakeServer } from "../test/fakeServer";

describe("Delete data › Delete all recipes (Settings › Data)", () => {
  it("says what goes and what stays; the button only works once DELETE is typed", async () => {
    const server = fakeServer({ "POST /api/wipe/recipes": () => ({ recipes: 42, backup: "recipehub-2026-10-31-180000-before-wipe.tar.gz" }) });
    const u = userEvent.setup();
    render(<DeleteData />);
    const card = screen.getByRole("region", { name: "Delete all recipes" });
    expect(card).toHaveTextContent(/versions, ratings, notes, photos/);
    expect(card).toHaveTextContent(/tags and collections/);
    expect(card).toHaveTextContent(/categories, grocery list, pantry and settings stay/);
    const go = within(card).getByRole("button", { name: "Delete all recipes" });
    expect(go).toBeDisabled();
    await u.type(within(card).getByLabelText("Type DELETE to confirm"), "delete");
    expect(go).toBeDisabled(); // it has to be DELETE
    await u.clear(within(card).getByLabelText("Type DELETE to confirm"));
    await u.type(within(card).getByLabelText("Type DELETE to confirm"), "DELETE");
    await u.click(go);
    await waitFor(() => expect(server.writes()[0]).toMatchObject({ path: "/api/wipe/recipes", body: { confirm: "DELETE" } }));
    expect(await within(card).findByRole("status")).toHaveTextContent("Deleted 42 recipes. A backup was made first (recipehub-2026-10-31-180000-before-wipe.tar.gz): restore it above to bring them back.");
    expect(within(card).getByLabelText("Type DELETE to confirm")).toHaveValue("");
  });

  it("shows the server's message when it fails", async () => {
    fakeServer({ "POST /api/wipe/recipes": () => ({ status: 500, json: { error: "Couldn't make the backup" } }) });
    const u = userEvent.setup();
    render(<DeleteData />);
    const card = screen.getByRole("region", { name: "Delete all recipes" });
    await u.type(within(card).getByLabelText("Type DELETE to confirm"), "DELETE");
    await u.click(within(card).getByRole("button", { name: "Delete all recipes" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("Couldn't make the backup");
  });
});

describe("Delete data › Reset the entire app", () => {
  it("one section with both choices", () => {
    fakeServer({});
    render(<DeleteData />);
    const box = screen.getByRole("region", { name: "Delete data" });
    expect(within(box).getByRole("region", { name: "Delete all recipes" })).toBeInTheDocument();
    expect(within(box).getByRole("region", { name: "Reset the entire app" })).toBeInTheDocument();
  });

  it("says everything goes and the backups stay; only works once RESET is typed; then signs out to the first-run screen", async () => {
    const reload = vi.fn();
    const server = fakeServer({ "POST /api/wipe/all": () => ({ ok: true, backup: "recipehub-2026-11-05-before-reset.tar.gz" }) });
    const u = userEvent.setup();
    localStorage.setItem("recipehub.token", "abc");
    render(<DeleteData onReset={reload} />);
    const card = screen.getByRole("region", { name: "Reset the entire app" });
    expect(card).toHaveTextContent(/people, passkeys/);
    expect(card).toHaveTextContent(/backup is made first, and your backups are kept/i);
    const go = within(card).getByRole("button", { name: "Reset the entire app" });
    await u.type(within(card).getByLabelText("Type RESET to confirm"), "DELETE");
    expect(go).toBeDisabled();
    await u.clear(within(card).getByLabelText("Type RESET to confirm"));
    await u.type(within(card).getByLabelText("Type RESET to confirm"), "RESET");
    await u.click(go);
    await waitFor(() => expect(server.writes()[0]).toMatchObject({ path: "/api/wipe/all", body: { confirm: "RESET" } }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(localStorage.getItem("recipehub.token")).toBeNull();
  });
});
