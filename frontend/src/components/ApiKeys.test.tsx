import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiKeys } from "./SecuritySettings";
import { fakeServer } from "../test/fakeServer";

// Settings › API keys: an "Inbox only" key, for the RecipeHub Companion extension
describe("API key types", () => {
  it("offers Inbox only, which can push to the inbox and nothing else", async () => {
    const s = fakeServer({
      "GET /api/keys": () => [],
      "POST /api/keys": (b: any) => ({ status: 201, json: { id: 1, name: b.name, prefix: "cul_ab", access: b.access, key: "cul_abcdef" } }),
    });
    const u = userEvent.setup();
    render(<ApiKeys />);
    const inbox = await screen.findByRole("radio", { name: /Inbox only/ });
    expect(screen.getByText(/Send links and notes to the inbox/)).toBeInTheDocument();
    await u.type(screen.getByLabelText("Key name"), "RecipeHub Companion");
    await u.click(inbox);
    await u.click(screen.getByRole("button", { name: "Create key" }));
    await waitFor(() => expect(s.writes().find((w) => w.path === "/api/keys")?.body).toEqual({ name: "RecipeHub Companion", access: "inbox_push" }));
    expect(await screen.findByText(/Inbox only/, { selector: "p" })).toBeInTheDocument();
  });
});
