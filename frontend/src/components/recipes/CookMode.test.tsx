import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CookMode from "./CookMode";
import { SessionContext, type User } from "../../session";
import { fakeServer, recipeJson } from "../../test/fakeServer";

const chili = recipeJson({
  steps: [{ text: "Brown the ground beef." }, { section: "Simmer", text: "Simmer" }, { text: "Stir in the chili powder." }, { text: "Simmer for 30 minutes." }],
});
const open = async () => {
  fakeServer({ "GET /api/recipes/7": () => chili, "GET /api/recipes/7/me": () => ({}) });
  const view = render(<CookMode id={7} />);
  await screen.findByText(/Step 1 of 3/);
  return view;
};

describe("Cook Mode", () => {
  it("walks the steps with Next and Back, and Done shows the finish", async () => {
    const u = userEvent.setup();
    await open();
    expect(screen.getByText("Brown the ground beef.")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText(/Step 2 of 3/)).toHaveTextContent("Simmer"); // the heading labels the step
    await u.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /Next/ }));
    await u.click(screen.getByRole("button", { name: /Next/ }));
    await u.click(screen.getByRole("button", { name: /Done/ }));
    expect(screen.getByText("All done. Enjoy!")).toBeInTheDocument();
  });

  it("arrow keys move between steps and Escape leaves", async () => {
    const u = userEvent.setup();
    await open();
    await u.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByText(/Step 3 of 3/)).toBeInTheDocument();
    await u.keyboard("{ArrowLeft}");
    expect(screen.getByText(/Step 2 of 3/)).toBeInTheDocument();
    await u.keyboard("{Escape}");
    expect(window.location.hash).toBe("#/recipes/7");
  });

  it("closing and reopening mid-cook picks up at the same step", async () => {
    const u = userEvent.setup();
    const first = await open();
    await u.keyboard("{ArrowRight}");
    first.unmount();
    await open().catch(() => {});
    expect(await screen.findByText(/Step 2 of 3/)).toBeInTheDocument();
  });

  it("cooking it again after finishing starts at step 1, not on the finish screen", async () => {
    const u = userEvent.setup();
    const first = await open();
    await u.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(screen.getByText("All done. Enjoy!")).toBeInTheDocument();
    first.unmount(); // left with the X, not "Back to the recipe"
    fakeServer({ "GET /api/recipes/7": () => chili });
    render(<CookMode id={7} />);
    expect(await screen.findByText(/Step 1 of 3/)).toBeInTheDocument();
  });

  it("Start over unticks the ingredients you ticked", async () => {
    const u = userEvent.setup();
    await open();
    const beef = screen.getAllByRole("button", { name: /ground beef/ })[0];
    await u.click(beef);
    expect(beef).toHaveAttribute("aria-pressed", "true");
    await u.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    await u.click(screen.getByRole("button", { name: "Start over" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /ground beef/ })[0]).toHaveAttribute("aria-pressed", "false"));
  });
});

describe("fresh herbs in Cook Mode", () => {
  it("the checklist shows the dried amount too", async () => {
    fakeServer({ "GET /api/recipes/7": () => recipeJson({ ingredients: [{ raw: "3 sprigs fresh thyme", quantity: 3, quantityMax: null, unit: "sprig", name: "fresh thyme", note: null }] }), "GET /api/recipes/7/me": () => ({}) });
    render(<CookMode id={7} />);
    expect(await screen.findByRole("list", { name: "Ingredients checklist" })).toHaveTextContent("(about ¾ tsp dried)");
  });
});

describe("keeping the screen awake", () => {
  const lock = () => {
    const request = vi.fn(async () => ({ release: vi.fn(async () => {}), addEventListener: vi.fn() }));
    Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    return request;
  };
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).wakeLock;
  });
  const as = (keepAwake: boolean) => {
    fakeServer({ "GET /api/recipes/7": () => chili, "GET /api/recipes/7/me": () => ({}) });
    const user = { id: 1, username: "alex", displayName: null, email: null, role: "owner", keepAwake } as User;
    render(
      <SessionContext.Provider value={{ user, setUser: () => {}, replaceToken: () => {}, signOut: () => {}, signOutEverywhere: async () => {} }}>
        <CookMode id={7} />
      </SessionContext.Provider>,
    );
  };

  it("on (the default): the screen is kept on", async () => {
    const request = lock();
    as(true);
    expect(await screen.findByText("Screen stays on")).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("screen");
  });

  it("switched off in your preferences: the screen may sleep, and says where to change it", async () => {
    const request = lock();
    as(false);
    expect(await screen.findByText("Screen may sleep (your choice)")).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
});

describe("Cook Mode ingredient order", () => {
  it("A to Z in your preferences: the checklist is sorted, and ticking still ticks the right one", async () => {
    const r = recipeJson({ ingredients: [{ raw: "1 lb ground beef" }, { raw: "2 tbsp chili powder" }, { raw: "1 cup beans" }] as any, steps: [{ text: "Cook." }] });
    fakeServer({ "GET /api/recipes/7": () => r, "GET /api/recipes/7/me": () => ({}) });
    const user = { id: 1, username: "alex", displayName: "Alex", email: null, role: "owner", ingredientOrder: "alpha" } as User;
    const u = userEvent.setup();
    render(
      <SessionContext.Provider value={{ user, setUser: () => {}, replaceToken: () => {}, signOut: () => {}, signOutEverywhere: async () => {} }}>
        <CookMode id={7} />
      </SessionContext.Provider>,
    );
    const list = await screen.findByRole("list", { name: "Ingredients checklist" });
    const items = within(list).getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toMatch(/beans/);
    expect(items[2]).toMatch(/ground beef/);
    await u.click(within(list).getAllByRole("checkbox")[0]);
    expect(within(list).getAllByRole("checkbox")[0]).toBeChecked();
    expect(within(list).getAllByRole("checkbox")[2]).not.toBeChecked();
  });
});


describe("a scaled recipe in Cook Mode", () => {
  it("the step's own amounts match the scaled checklist", async () => {
    localStorage.setItem("recipehub-cook-prefs", JSON.stringify({ scale: { 7: 1.5 } }));
    fakeServer({
      "GET /api/recipes/7": () =>
        recipeJson({
          ingredients: [
            { raw: "2 cans white beans, 15 oz.", quantity: 2, quantityMax: null, unit: "can", name: "white beans", note: "15 oz." },
            { raw: "4 cups chicken broth", quantity: 4, quantityMax: null, unit: "cup", name: "chicken broth", note: null },
          ],
          steps: [{ text: "Add 2 (15 oz.) cans white beans and 4 cups chicken broth." }],
        }),
      "GET /api/recipes/7/me": () => ({}),
    });
    render(<CookMode id={7} />);
    expect(await screen.findByText("Add 3 (15 oz.) cans white beans and 6 cups chicken broth.")).toBeInTheDocument();
    localStorage.removeItem("recipehub-cook-prefs");
  });
});
