import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NutritionCard } from "./NutritionCard";
import { fakeServer, ndjsonStream, recipeJson } from "../../test/fakeServer";
import { forgetAiStatus } from "../../ai";
import type { Nutrition } from "../../recipes";

const facts = (over: Partial<Nutrition> = {}): Nutrition => ({ calories: 410, fat: 20, saturatedFat: 7, carbs: 30, fiber: 6, sugar: 14, addedSugar: 12, protein: 33, sodium: 640, source: "ai", servings: 4, servingSize: "About 1½ cups (340 g)", note: null, ...over });
const card = (value: Nutrition | null, more: { updating?: boolean; onChange?: (n: Nutrition | null) => void } = {}) =>
  render(<NutritionCard recipeId={7} servings={4} value={value} updating={more.updating} onChange={more.onChange ?? (() => {})} />);

beforeEach(() => {
  forgetAiStatus();
});

describe("nutrition facts", () => {
  it("worked out per ingredient: shows the calories of each, biggest first", () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }) });
    card(facts({ perIngredient: [{ line: "1 (5-pound) pork butt", grams: 2268, calories: 5600 }, { line: "3 tbsp brown sugar", grams: 36, calories: 140 }] }));
    const by = screen.getByRole("list", { name: "Calories by ingredient" });
    expect(within(by).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1 (5-pound) pork butt5,600 kcal", "3 tbsp brown sugar140 kcal"]);
  });

  it("no per-ingredient numbers (typed in, from the site), or the ingredients changed since: no list", () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }) });
    const { unmount } = card(facts());
    expect(screen.queryByRole("list", { name: "Calories by ingredient" })).toBeNull();
    unmount();
    card(facts({ outdated: true, perIngredient: [{ line: "1 onion", grams: 110, calories: 44 }] }));
    expect(screen.queryByRole("list", { name: "Calories by ingredient" })).toBeNull();
  });

  it("shows added sugars under total sugars, with its daily value", async () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }) });
    card(facts());
    const row = screen.getByRole("row", { name: /Includes 12 g added sugars/ });
    expect(within(row).getByText("24%")).toBeInTheDocument();
  });

  it("no added sugars known: that line isn't shown", () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }) });
    card(facts({ addedSugar: null }));
    expect(screen.queryByText(/added sugars/)).toBeNull();
  });

  it("shows the serving size", () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }) });
    card(facts());
    expect(screen.getByText("Serving size")).toBeInTheDocument();
    expect(screen.getByText("About 1½ cups (340 g)")).toBeInTheDocument();
  });

  it("says when nutrition is being worked out", () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }) });
    card(null, { updating: true });
    expect(screen.getByRole("status")).toHaveTextContent("Updating nutrition…");
    expect(screen.queryByText("No nutrition facts yet.")).toBeNull();
  });

  it("out of date (the recipe changed since): says so, and Re-calculate nutrition updates it", async () => {
    const server = fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }), "POST /api/recipes/7/nutrition": () => facts() });
    const onChange = vi.fn();
    const u = userEvent.setup();
    card(facts({ source: "you", outdated: true }), { onChange });
    expect(screen.getByRole("note")).toHaveTextContent("This recipe has been updated since nutrition was entered, so it may be out of date.");
    await u.click(await screen.findByRole("button", { name: "Re-calculate nutrition" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(facts()));
    expect(server.writes().map((w) => w.path)).toEqual(["/api/recipes/7/nutrition"]);
  });

  it("out of date without AI: says so, and points to editing it", async () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: false, photos: false, enhance: false }) });
    card(facts({ outdated: true }));
    expect(screen.getByRole("note")).toHaveTextContent(/updated since nutrition was calculated, so it may be out of date\. Edit the numbers/);
  });

  it("typing them in includes added sugars and the serving size", async () => {
    const server = fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }), "PUT /api/recipes/7/nutrition": () => ({}) });
    const u = userEvent.setup();
    card(null);
    await u.click(screen.getByRole("button", { name: "Type it in" }));
    await u.type(screen.getByLabelText("Calories"), "300");
    await u.type(screen.getByLabelText("Added sugars (g)"), "9");
    await u.type(screen.getByLabelText("Serving size"), "1 bowl");
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(server.writes()[0].body).toMatchObject({ calories: 300, addedSugar: 9, servingSize: "1 bowl" });
  });
});

describe("nutrition panel buttons", () => {
  it("Re-calculate nutrition is a button at the top (it's been worked out before); Edit is the pencil", async () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }) });
    card(facts());
    const top = screen.getByRole("toolbar", { name: "Nutrition actions" });
    expect((await within(top).findByRole("button", { name: "Re-calculate nutrition" })).textContent).toMatch(/Re-calculate nutrition/);
    expect(within(top).getByRole("button", { name: "Edit nutrition" })).toHaveAttribute("title", "Edit nutrition");
  });

  it("none yet: Calculate nutrition", async () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }) });
    card(null);
    expect(await screen.findByRole("button", { name: "Calculate nutrition" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Re-calculate nutrition" })).toBeNull();
  });

  it("AI off or not set up: no AI buttons; edit and Type it in still are", async () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: false, photos: false, enhance: false }) });
    const { unmount } = card(facts());
    const top = screen.getByRole("toolbar", { name: "Nutrition actions" });
    await waitFor(() => expect(within(top).getByRole("button", { name: "Edit nutrition" })).toBeInTheDocument());
    expect(within(top).queryByRole("button", { name: /calculate nutrition/i })).toBeNull();
    unmount();
    card(null);
    expect(screen.getByRole("button", { name: "Type it in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /calculate nutrition/i })).toBeNull();
  });

  it("calculating: a popup with a spinner and one line of what it's doing; it closes and updates when done", async () => {
    const s = ndjsonStream();
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }), "POST /api/recipes/7/nutrition": () => s.response });
    const onChange = vi.fn();
    const u = userEvent.setup();
    card(facts(), { onChange });
    await u.click(await screen.findByRole("button", { name: "Re-calculate nutrition" }));
    const dlg = await screen.findByRole("dialog", { name: "Calculating nutrition" });
    expect(within(dlg).getByRole("progressbar")).toBeInTheDocument();
    s.push({ type: "step", text: "Reading 2 ingredients" });
    expect(await within(dlg).findByRole("status")).toHaveTextContent("Reading 2 ingredients");
    s.push({ type: "step", text: "Asking OpenAI (tiny)…" });
    await waitFor(() => expect(within(dlg).getByRole("status")).toHaveTextContent("Asking OpenAI (tiny)…"));
    s.push({ type: "result", nutrition: facts({ calories: 500 }) });
    s.end();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Calculating nutrition" })).toBeNull());
    expect(onChange).toHaveBeenCalledWith(facts({ calories: 500 }));
  });

  it("it didn't work: the popup closes and says why", async () => {
    const s = ndjsonStream();
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }), "POST /api/recipes/7/nutrition": () => s.response });
    const u = userEvent.setup();
    card(facts());
    await u.click(await screen.findByRole("button", { name: "Re-calculate nutrition" }));
    s.push({ type: "error", status: 502, error: "The AI service didn't answer." });
    s.end();
    expect(await screen.findByRole("alert")).toHaveTextContent("The AI service didn't answer.");
    expect(screen.queryByRole("dialog", { name: "Calculating nutrition" })).toBeNull();
  });

  it("Edit nutrition opens the form", async () => {
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }) });
    const u = userEvent.setup();
    card(facts());
    await u.click(screen.getByRole("button", { name: "Edit nutrition" }));
    expect(await screen.findByRole("dialog", { name: "Nutrition per serving" })).toBeInTheDocument();
  });
});

describe("Calculate nutrition on a recipe with no servings", () => {
  const portions = {
    totalGrams: 1150,
    options: [
      { servings: 46, servingSize: "1 cookie (25 g)", yieldText: "46 cookies" },
      { servings: 28, servingSize: "1 cookie (40 g)", yieldText: "28 cookies" },
    ],
  };
  const noServings = (routes: Record<string, any> = {}) => {
    const server = fakeServer({
      "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }),
      "POST /api/recipes/7/portions": () => portions,
      "PATCH /api/recipes/7": (b: any) => recipeJson({ servings: b.servings, yieldText: b.yieldText ?? null }),
      "POST /api/recipes/7/nutrition": () => facts({ servings: 28, servingSize: "1 cookie (40 g)" }),
      ...routes,
    });
    const onChange = vi.fn();
    const onRecipe = vi.fn();
    render(<NutritionCard recipeId={7} servings={null} yieldText={null} value={null} onChange={onChange} onRecipe={onRecipe} />);
    return { server, onChange, onRecipe };
  };

  it("asks how many it makes first, with the AI's suggestions from the ingredients", async () => {
    const u = userEvent.setup();
    const { server } = noServings();
    await u.click(await screen.findByRole("button", { name: "Calculate nutrition" }));
    const dlg = await screen.findByRole("dialog", { name: "How many servings?" });
    expect(await within(dlg).findByRole("radio", { name: /46 cookies.*1 cookie \(25 g\)/ })).toBeInTheDocument();
    expect(within(dlg).getByRole("radio", { name: /28 cookies.*1 cookie \(40 g\)/ })).toBeInTheDocument();
    expect(within(dlg).getByText(/about 1,150 g/)).toBeInTheDocument();
    expect(server.writes().map((w) => w.path)).toEqual(["/api/recipes/7/portions"]); // nothing calculated yet
  });

  it("while the AI works out the portions, only that shows: no choices or buttons until they're in", async () => {
    const u = userEvent.setup();
    let answer: (v: unknown) => void = () => {};
    noServings({ "POST /api/recipes/7/portions": () => new Promise((r) => (answer = r)) });
    await u.click(await screen.findByRole("button", { name: "Calculate nutrition" }));
    const dlg = await screen.findByRole("dialog", { name: "How many servings?" });
    expect(within(dlg).getByRole("status")).toHaveTextContent(/Working out/);
    expect(within(dlg).queryByRole("radio")).toBeNull();
    expect(within(dlg).queryByRole("button", { name: "Save and calculate" })).toBeNull();
    answer(portions);
    expect(await within(dlg).findByRole("radio", { name: "Something else" })).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "Save and calculate" })).toBeInTheDocument();
    expect(within(dlg).queryByRole("status")).toBeNull();
  });

  it("picking one saves the servings and Makes on the recipe, then calculates with that serving size", async () => {
    const u = userEvent.setup();
    const { server, onChange, onRecipe } = noServings();
    await u.click(await screen.findByRole("button", { name: "Calculate nutrition" }));
    await u.click(await screen.findByRole("radio", { name: /28 cookies/ }));
    await u.click(screen.getByRole("button", { name: "Save and calculate" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const writes = server.writes();
    expect(writes.find((w) => w.method === "PATCH")!.body).toEqual({ servings: 28, yieldText: "28 cookies" });
    expect(writes.find((w) => w.path === "/api/recipes/7/nutrition")!.body).toEqual({ servingSize: "1 cookie (40 g)" });
    expect(onRecipe).toHaveBeenCalledWith(expect.objectContaining({ servings: 28, yieldText: "28 cookies" }));
    expect(screen.queryByRole("dialog", { name: "How many servings?" })).toBeNull();
  });

  it("or type your own: servings, a serving size and what it makes", async () => {
    const u = userEvent.setup();
    const { server } = noServings();
    await u.click(await screen.findByRole("button", { name: "Calculate nutrition" }));
    const dlg = await screen.findByRole("dialog", { name: "How many servings?" });
    await u.click(within(dlg).getByRole("radio", { name: "Something else" }));
    await u.type(within(dlg).getByRole("textbox", { name: "Servings" }), "10");
    await u.type(within(dlg).getByRole("textbox", { name: "Serving size" }), "1 slice");
    await u.type(within(dlg).getByRole("textbox", { name: "Makes" }), "1 loaf");
    await u.click(within(dlg).getByRole("button", { name: "Save and calculate" }));
    await waitFor(() => expect(server.writes().find((w) => w.path === "/api/recipes/7/nutrition")).toBeTruthy());
    expect(server.writes().find((w) => w.method === "PATCH")!.body).toEqual({ servings: 10, yieldText: "1 loaf" });
    expect(server.writes().find((w) => w.path === "/api/recipes/7/nutrition")!.body).toEqual({ servingSize: "1 slice" });
  });

  it("no suggestions (the AI couldn't): says so, and typing your own still works", async () => {
    const u = userEvent.setup();
    noServings({ "POST /api/recipes/7/portions": () => ({ status: 502, json: { error: "The AI didn't suggest any portions." } }) });
    await u.click(await screen.findByRole("button", { name: "Calculate nutrition" }));
    const dlg = await screen.findByRole("dialog", { name: "How many servings?" });
    expect(await within(dlg).findByText(/couldn't suggest portions/i)).toBeInTheDocument();
    expect(within(dlg).getByRole("textbox", { name: "Servings" })).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "Save and calculate" })).toBeDisabled();
  });

  it("a recipe that has servings calculates straight away", async () => {
    const u = userEvent.setup();
    fakeServer({ "GET /api/ai/status": () => ({ ready: true, photos: false, enhance: true }), "POST /api/recipes/7/nutrition": () => facts() });
    const onChange = vi.fn();
    card(null, { onChange });
    await u.click(await screen.findByRole("button", { name: "Calculate nutrition" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "How many servings?" })).toBeNull();
  });
});
