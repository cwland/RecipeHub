import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecipeChatSwitch } from "./RecipeChatSettings";
import { fakeServer } from "../test/fakeServer";
import { forgetAiStatus } from "../ai";

beforeEach(() => forgetAiStatus());
const on = (services: { id: string; name: string }[]) => ({
  "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true, recipeChat: true }),
  "GET /api/settings/features": () => ({ ai: true, recipeChat: true }),
  "GET /api/settings/ai/recipe-chat": () => ({ notes: "", serviceId: null, services }),
  "PUT /api/settings/ai/recipe-chat": (body: any) => ({ notes: body.notes ?? "", serviceId: body.serviceId ?? null, services }),
});

describe("Recipe chat settings", () => {
  it("saves the household notes when you leave the box", async () => {
    const server = fakeServer(on([{ id: "a", name: "Home AI" }]));
    const u = userEvent.setup();
    render(<RecipeChatSwitch />);
    const box = await screen.findByRole("textbox", { name: /Household notes/ });
    await u.type(box, "We're dairy-free.");
    await u.tab();
    await waitFor(() => expect(server.writes().find((w) => w.path === "/api/settings/ai/recipe-chat")?.body).toEqual({ notes: "We're dairy-free." }));
  });

  it("hides the AI picker when only one service is set up", async () => {
    fakeServer(on([{ id: "a", name: "Home AI" }]));
    render(<RecipeChatSwitch />);
    await screen.findByRole("textbox", { name: /Household notes/ });
    expect(screen.queryByRole("combobox", { name: /AI for recipe chat/ })).not.toBeInTheDocument();
  });

  it("with two services, offers the usual order first and saves the pick", async () => {
    const server = fakeServer(on([{ id: "a", name: "Home AI" }, { id: "b", name: "Claude" }]));
    const u = userEvent.setup();
    render(<RecipeChatSwitch />);
    const pick = await screen.findByRole("combobox", { name: /AI for recipe chat/ });
    expect(within(pick).getAllByRole("option").map((o) => o.textContent)).toEqual(["Same as other AI features", "Home AI", "Claude"]);
    await u.selectOptions(pick, "Claude");
    await waitFor(() => expect(server.writes().find((w) => w.path === "/api/settings/ai/recipe-chat")?.body).toEqual({ serviceId: "b" }));
  });
});
