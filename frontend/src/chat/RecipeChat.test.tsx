import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecipeChat from "./RecipeChat";
import { fakeServer, recipeJson } from "../test/fakeServer";
import type { Recipe } from "../recipes";

const chili = recipeJson() as unknown as Recipe;
const msg = (id: number, role: "user" | "assistant", content: string, canSave = false) => ({ id, role, content, canSave, timestamp: "2026-11-24T06:00:00.000Z" });

beforeEach(() => sessionStorage.clear());
afterEach(() => sessionStorage.clear());

const openChat = async (routes: Record<string, (body: any) => unknown>) => {
  const server = fakeServer({ "GET /api/recipes/7/chat": () => ({ messages: [] }), ...routes });
  const u = userEvent.setup();
  render(<RecipeChat recipe={chili} factor={2} units="metric" />);
  await u.click(screen.getByRole("button", { name: "Open recipe chat" }));
  const win = await screen.findByRole("dialog", { name: "Recipe chat" });
  return { server, u, win };
};

describe("Recipe chat", () => {
  it("opens with the recipe's name and the five starter ideas", async () => {
    const { win } = await openChat({});
    expect(within(win).getByText("Weeknight Chili")).toBeInTheDocument();
    for (const idea of ["Substitute a missing ingredient", "Reduce calories", "Make this recipe healthier", "Adapt for dietary restrictions", "Scale or adjust serving size"])
      expect(await within(win).findByRole("button", { name: idea })).toBeInTheDocument();
  });

  it("sends a starter idea with how the recipe is shown, and shows the answer", async () => {
    let answer!: (v: unknown) => void;
    const { server, u, win } = await openChat({
      "POST /api/recipes/7/chat": () => new Promise((r) => (answer = r)),
    });
    await u.click(await within(win).findByRole("button", { name: "Reduce calories" }));
    expect(server.writes()[0].body).toEqual({ message: "Reduce calories", view: { factor: 2, units: "metric" } });
    // waiting: the typing dots, and Send can't be pressed again
    expect(within(win).getByRole("status", { name: "The assistant is typing" })).toBeInTheDocument();
    expect(within(win).getByRole("button", { name: "Send" })).toBeDisabled();
    answer({ userMessage: msg(1, "user", "Reduce calories"), reply: msg(2, "assistant", "- Use **lean** beef") });
    expect(await within(win).findByText("lean")).toBeInTheDocument();
    expect(within(win).queryByRole("status", { name: "The assistant is typing" })).not.toBeInTheDocument();
  });

  it("says plainly when the assistant took too long, and Try again sends the same question", async () => {
    let saved: ReturnType<typeof msg>[] = [];
    let calls = 0;
    const { server, u, win } = await openChat({
      "GET /api/recipes/7/chat": () => ({ messages: saved }),
      "POST /api/recipes/7/chat": () => {
        if (++calls === 1) {
          saved = [msg(5, "user", "Out of beef?")]; // the server keeps the question
          return { status: 504, json: { error: "slow", kind: "timeout" } };
        }
        return { userMessage: msg(5, "user", "Out of beef?"), reply: msg(6, "assistant", "Use turkey.") };
      },
    });
    await u.type(within(win).getByRole("textbox", { name: "Message" }), "Out of beef?");
    await u.click(within(win).getByRole("button", { name: "Send" }));
    expect(await within(win).findByText("The assistant didn't answer in time. Try again?")).toBeInTheDocument();
    await u.click(within(win).getByRole("button", { name: "Try again" }));
    expect(await within(win).findByText("Use turkey.")).toBeInTheDocument();
    expect(server.writes().at(-1)?.body).toEqual({ retryOf: 5, view: { factor: 2, units: "metric" } });
    expect(within(win).getAllByText("Out of beef?")).toHaveLength(1);
  });

  it("offers to save a suggested change as a new recipe, and opens it in the editor", async () => {
    const { u, win } = await openChat({
      "GET /api/recipes/7/chat": () => ({ messages: [msg(1, "user", "Lighter?"), msg(2, "assistant", "- Greek yogurt for sour cream", true)] }),
      "POST /api/recipes/7/chat/2/recipe": () => ({ title: "Weeknight Chili (lighter)", description: null, ingredients: ["1 lb beef"], steps: ["Brown it."], servings: 4, yieldText: null, prepMinutes: null, cookMinutes: null, totalMinutes: null, tags: [], notes: "Made from Weeknight Chili with recipe chat." }),
    });
    expect(await within(win).findByText("Save as new recipe?")).toBeInTheDocument();
    await u.click(within(win).getByRole("button", { name: "Yes, save it" }));
    await waitFor(() => expect(window.location.hash).toBe("#/recipes/new?draft=chat"));
    expect(JSON.parse(sessionStorage.getItem("recipehub-chat-draft")!).title).toBe("Weeknight Chili (lighter)");
  });

  it("No keeps chatting and hides the offer", async () => {
    const { u, win } = await openChat({
      "GET /api/recipes/7/chat": () => ({ messages: [msg(1, "user", "Lighter?"), msg(2, "assistant", "- Greek yogurt", true)] }),
    });
    await u.click(await within(win).findByRole("button", { name: "No, keep chatting" }));
    expect(within(win).queryByText("Save as new recipe?")).not.toBeInTheDocument();
  });

  it("Clear chat asks first, then empties it and shows the ideas again", async () => {
    const { server, u, win } = await openChat({
      "GET /api/recipes/7/chat": () => ({ messages: [msg(1, "user", "Hi"), msg(2, "assistant", "Hello there")] }),
      "DELETE /api/recipes/7/chat": () => ({ status: 204 }),
    });
    await within(win).findByText("Hello there");
    await u.click(within(win).getByRole("button", { name: "Clear chat" }));
    expect(within(win).getByText("Clear this chat? This can't be undone.")).toBeInTheDocument();
    await u.click(within(win).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(server.writes().some((w) => w.method === "DELETE")).toBe(true));
    expect(await within(win).findByRole("button", { name: "Reduce calories" })).toBeInTheDocument();
    expect(within(win).queryByText("Hello there")).not.toBeInTheDocument();
  });

  it("Minimize goes back to the bubble", async () => {
    const { u, win } = await openChat({});
    await u.click(within(win).getByRole("button", { name: "Minimize" }));
    expect(screen.queryByRole("dialog", { name: "Recipe chat" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open recipe chat" })).toBeInTheDocument();
  });

  it("closing the chat while it's answering doesn't lose the wait or allow a second question", async () => {
    let answer!: (v: unknown) => void;
    const { server, u, win } = await openChat({ "POST /api/recipes/7/chat": () => new Promise((r) => (answer = r)) });
    await u.click(await within(win).findByRole("button", { name: "Reduce calories" }));
    await u.click(within(win).getByRole("button", { name: "Minimize" }));
    await u.click(screen.getByRole("button", { name: "Open recipe chat" }));
    const again = await screen.findByRole("dialog", { name: "Recipe chat" });
    expect(within(again).getByRole("status", { name: "The assistant is typing" })).toBeInTheDocument();
    expect(within(again).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    answer({ userMessage: msg(1, "user", "Reduce calories"), reply: msg(2, "assistant", "Use lean beef.") });
    expect(await within(again).findByText("Use lean beef.")).toBeInTheDocument();
    expect(server.writes().filter((w) => w.method === "POST")).toHaveLength(1);
  });

  it("on a short screen (a phone on its side) it opens as a panel, not a window taller than the screen", async () => {
    const h = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { value: 390, configurable: true });
    try {
      const { win } = await openChat({});
      expect(win.style.height).toBe("85vh");
    } finally {
      Object.defineProperty(window, "innerHeight", { value: h, configurable: true });
    }
  });

  it("keeps working when the browser's scrollIntoView returns a promise (current Chrome)", async () => {
    const proto = Element.prototype as unknown as { scrollIntoView?: unknown };
    const before = proto.scrollIntoView;
    proto.scrollIntoView = () => Promise.resolve();
    try {
      const { u, win } = await openChat({ "POST /api/recipes/7/chat": () => ({ userMessage: msg(1, "user", "Reduce calories"), reply: msg(2, "assistant", "Use lean beef.") }) });
      await u.click(await within(win).findByRole("button", { name: "Reduce calories" }));
      expect(await within(win).findByText("Use lean beef.")).toBeInTheDocument();
      await u.click(within(win).getByRole("button", { name: "Minimize" }));
      expect(screen.getByRole("button", { name: "Open recipe chat" })).toBeInTheDocument();
    } finally {
      proto.scrollIntoView = before;
    }
  });
});
