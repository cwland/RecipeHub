import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EnhanceWizard from "./EnhanceWizard";
import { fakeServer, ndjsonStream, recipeJson } from "../../test/fakeServer";
import type { Recipe } from "../../recipes";

const recipe = recipeJson() as unknown as Recipe;
const suggestion = (over: Record<string, unknown> = {}) => ({
  steps: { suggested: ["Brown the beef over medium-high heat, about 8 minutes.", "Simmer for 30 minutes."], changes: ["Added how long to brown the beef."], changed: true },
  ingredients: { suggested: ["1 lb ground beef", "2 tbsp ancho chili powder"], changes: ["Chili powder: ancho, as the steps say."], changed: true },
  nutrition: { suggested: { calories: 410, fat: 22, saturatedFat: 8, carbs: 10, fiber: 3, sugar: 2, protein: 33, sodium: 640, source: "ai", servings: 4, note: null }, changes: ["Estimated from the ingredients."], changed: true },
  organize: { categories: ["Dinner", "Soup"], newCategories: ["Soup"], tags: ["chili"], changes: ["Added Soup.", "Swapped beef for chili."], changed: true },
  ...over,
});
const open = (routes: Record<string, any> = {}) => {
  const server = fakeServer({ "POST /api/recipes/7/enhance": () => suggestion(), "POST /api/recipes/7/enhance/apply": () => recipeJson({ title: "Applied" }), ...routes });
  const onApplied = vi.fn();
  const onClose = vi.fn();
  render(<EnhanceWizard recipe={recipe} onClose={onClose} onApplied={onApplied} />);
  return { server, onApplied, onClose };
};

// The review goes one part at a time: this moves to a part by its name (accepting the ones before)
const goTo = async (u: ReturnType<typeof userEvent.setup>, name: string) => {
  await screen.findByText(/Improve with AI · Step/, undefined, { timeout: 3000 }); // (the suggestions are in)
  for (let i = 0; i < 6 && !screen.queryByRole("region", { name }); i++) await u.click(await screen.findByRole("button", { name: "Accept change" }, { timeout: 3000 }));
  return screen.getByRole("region", { name });
};
const footerButtons = () => within(screen.getByRole("group", { name: "Your choice" })).getAllByRole("button").map((b) => b.textContent);

describe("Improve with AI, one part at a time", () => {
  it("the recipe's name is in the header the whole way, with which step it's on", async () => {
    const u = userEvent.setup();
    open();
    const dlg = await screen.findByRole("dialog", { name: "Weeknight Chili" });
    expect(await within(dlg).findByText("Improve with AI · Step 1 of 4", undefined, { timeout: 3000 })).toBeInTheDocument();
    await u.click(within(dlg).getByRole("button", { name: "Accept change" }));
    expect(within(dlg).getByText("Improve with AI · Step 2 of 4")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Weeknight Chili" })).toBe(dlg);
  });

  it("the bottom has only Reject change and Accept change (and Prior after the first); both move on", async () => {
    const u = userEvent.setup();
    open();
    const ing = await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 });
    expect(within(ing).getByRole("heading", { name: "Original" })).toBeInTheDocument();
    expect(within(ing).getByRole("heading", { name: "AI suggestion" })).toBeInTheDocument();
    expect(within(ing).getByText("2 tbsp ancho chili powder").closest("mark")).not.toBeNull();
    expect(footerButtons()).toEqual(["Reject change", "Accept change"]);
    await u.click(screen.getByRole("button", { name: "Reject change" }));
    expect(screen.getByRole("region", { name: "Instructions" })).toBeInTheDocument();
    expect(footerButtons()).toEqual(["Prior", "Reject change", "Accept change"]);
    await u.click(screen.getByRole("button", { name: "Accept change" }));
    expect(screen.getByRole("region", { name: "Nutrition" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Prior" }));
    expect(screen.getByRole("region", { name: "Instructions" })).toBeInTheDocument();
    for (const gone of ["Next", "Back", "Skip", "Save"]) expect([gone, screen.queryByRole("button", { name: gone })]).toEqual([gone, null]);
  });

  it("the last choice saves the parts you accepted, by itself", async () => {
    const u = userEvent.setup();
    const { server, onApplied } = open();
    await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 });
    await u.click(screen.getByRole("button", { name: "Accept change" })); // ingredients
    await u.click(screen.getByRole("button", { name: "Accept change" })); // instructions
    await u.click(screen.getByRole("button", { name: "Reject change" })); // nutrition
    await u.click(screen.getByRole("button", { name: "Accept change" })); // categories and tags
    await vi.waitFor(() => expect(onApplied).toHaveBeenCalled());
    const body = server.writes().find((w) => w.path === "/api/recipes/7/enhance/apply")!.body;
    expect(Object.keys(body).sort()).toEqual(["categories", "ingredients", "steps", "tags"]);
    expect(body).toMatchObject({ categories: ["Dinner", "Soup"], tags: ["chili"], ingredients: ["1 lb ground beef", "2 tbsp ancho chili powder"] });
    expect(onApplied.mock.calls[0][0]).toMatchObject({ title: "Applied" });
  });

  it("rejecting everything saves nothing and says it's finished", async () => {
    const u = userEvent.setup();
    const server = fakeServer({ "POST /api/recipes/7/enhance": () => suggestion() });
    const onFinished = vi.fn();
    render(<EnhanceWizard recipe={recipe} onClose={() => {}} onApplied={() => {}} onFinished={onFinished} />);
    await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 });
    for (let i = 0; i < 4; i++) await u.click(screen.getByRole("button", { name: "Reject change" }));
    await vi.waitFor(() => expect(onFinished).toHaveBeenCalled());
    expect(server.writes().map((w) => w.path)).toEqual(["/api/recipes/7/enhance"]);
  });

  it("the pencil opens the AI suggestion to edit it; Done ends editing, and until then the choice buttons wait", async () => {
    const u = userEvent.setup();
    const { server, onApplied } = open({ "POST /api/recipes/7/enhance": () => suggestion({ steps: { suggested: [], changes: [], changed: false }, nutrition: { suggested: null, changes: [], changed: false }, organize: { categories: [], newCategories: [], tags: [], changes: [], changed: false } }) });
    const ing = await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 });
    await u.click(within(ing).getByRole("button", { name: "Edit the AI suggestion" }));
    const box = within(ing).getByRole("textbox", { name: "AI suggestion" });
    expect(box).toHaveValue("1 lb ground beef\n2 tbsp ancho chili powder");
    expect(screen.getByRole("button", { name: "Accept change" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject change" })).toBeDisabled();
    await u.clear(box);
    await u.type(box, "1 lb ground chuck\n2 tbsp ancho chili powder");
    await u.click(within(ing).getByRole("button", { name: "Done" }));
    expect(within(ing).getByText("1 lb ground chuck")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Accept change" }));
    await vi.waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(server.writes().find((w) => w.path === "/api/recipes/7/enhance/apply")!.body).toEqual({ ingredients: ["1 lb ground chuck", "2 tbsp ancho chili powder"] });
  });

  it("categories and tags can be edited too", async () => {
    const u = userEvent.setup();
    const { server } = open({ "POST /api/recipes/7/enhance": () => suggestion({ steps: { suggested: [], changes: [], changed: false }, ingredients: { suggested: [], changes: [], changed: false }, nutrition: { suggested: null, changes: [], changed: false } }) });
    const org = await screen.findByRole("region", { name: "Categories and tags" }, { timeout: 3000 });
    await u.click(within(org).getByRole("button", { name: "Edit the AI suggestion" }));
    const tags = within(org).getByRole("textbox", { name: "Tags" });
    await u.clear(tags);
    await u.type(tags, "chili, weeknight");
    await u.click(within(org).getByRole("button", { name: "Done" }));
    await u.click(screen.getByRole("button", { name: "Accept change" }));
    await vi.waitFor(() => expect(server.writes().find((w) => w.path === "/api/recipes/7/enhance/apply")?.body).toMatchObject({ categories: ["Dinner", "Soup"], tags: ["chili", "weeknight"] }));
  });

  it("edited nutrition doesn't keep the AI's per-ingredient breakdown (it no longer adds up to your numbers)", async () => {
    const u = userEvent.setup();
    const nutrition = { suggested: { calories: 410, fat: 22, saturatedFat: 8, carbs: 10, fiber: 3, sugar: 2, protein: 33, sodium: 640, source: "ai", servings: 4, note: null, perIngredient: [{ line: "1 lb ground beef", grams: 454, calories: 1200 }] }, changes: ["Worked out from each ingredient: about 410 kcal per serving."], changed: true };
    const { server } = open({ "POST /api/recipes/7/enhance": () => suggestion({ steps: { suggested: [], changes: [], changed: false }, ingredients: { suggested: [], changes: [], changed: false }, nutrition, organize: { categories: [], newCategories: [], tags: [], changes: [], changed: false } }) });
    const part = await screen.findByRole("region", { name: "Nutrition" }, { timeout: 3000 });
    await u.click(within(part).getByRole("button", { name: "Edit the AI suggestion" }));
    const calories = within(part).getByRole("textbox", { name: /Calories/ });
    await u.clear(calories);
    await u.type(calories, "380");
    await u.click(within(part).getByRole("button", { name: "Done" }));
    await u.click(screen.getByRole("button", { name: "Accept change" }));
    await vi.waitFor(() => expect(server.writes().find((w) => w.path === "/api/recipes/7/enhance/apply")).toBeTruthy());
    const sent = server.writes().find((w) => w.path === "/api/recipes/7/enhance/apply")!.body.nutrition;
    expect(sent.calories).toBe(380);
    expect(sent.perIngredient).toBeUndefined();
  });

  it("nothing to change at all: says so, with a Done", async () => {
    const u = userEvent.setup();
    const none = { suggested: null, changes: [], changed: false };
    const onFinished = vi.fn();
    fakeServer({ "POST /api/recipes/7/enhance": () => ({ steps: { ...none, suggested: [] }, ingredients: { ...none, suggested: [] }, nutrition: none, organize: { categories: [], newCategories: [], tags: [], changes: [], changed: false } }) });
    render(<EnhanceWizard recipe={recipe} onClose={() => {}} onApplied={() => {}} onFinished={onFinished} />);
    expect(await screen.findByText("The AI didn't find anything to change. The recipe looks good as it is.", undefined, { timeout: 3000 })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Done" }));
    expect(onFinished).toHaveBeenCalled();
  });

  it("the ✕ closes without saving anything", async () => {
    const u = userEvent.setup();
    const { server, onClose } = open();
    await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 });
    await u.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(server.writes().map((w) => w.path)).toEqual(["/api/recipes/7/enhance"]);
  });

  it("when the AI fails it says why and Try again asks again", async () => {
    const u = userEvent.setup();
    let calls = 0;
    const { server } = open({
      "POST /api/recipes/7/enhance": () => (++calls === 1 ? { status: 502, json: { error: "OpenRouter's answer couldn't be read. Try again, or try another AI service." } } : suggestion()),
    });
    expect(await screen.findByText(/couldn't be read/, undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept change" })).toBeNull();
    await u.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 })).toBeInTheDocument();
    expect(server.writes().filter((w) => w.path === "/api/recipes/7/enhance")).toHaveLength(2);
  });

  it("a recipe deleted meanwhile: saving shows the message instead of crashing", async () => {
    const u = userEvent.setup();
    const { onApplied } = open({ "POST /api/recipes/7/enhance/apply": () => ({ status: 404, json: { error: "Recipe not found" } }) });
    await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 });
    for (let i = 0; i < 4; i++) await u.click(screen.getByRole("button", { name: "Accept change" }));
    expect(await screen.findByText("Recipe not found")).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("in a batch: which recipe it is, and Stop reviewing up top", async () => {
    const u = userEvent.setup();
    fakeServer({ "POST /api/recipes/7/enhance": () => suggestion() });
    const onStop = vi.fn();
    render(<EnhanceWizard recipe={recipe} onClose={() => {}} onApplied={() => {}} position={{ n: 3, of: 42 }} onStop={onStop} />);
    expect(await screen.findByText("Recipe 3 of 42 · Improve with AI · Step 1 of 4", undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(footerButtons()).toEqual(["Reject change", "Accept change"]);
    await u.click(screen.getByRole("button", { name: "Stop reviewing" }));
    expect(onStop).toHaveBeenCalled();
  });
});

describe("AI check progress and fuller instructions", () => {
  it("shows what the AI is doing as it happens, then the suggestions", async () => {
    const live = ndjsonStream();
    const { server } = open({ "POST /api/recipes/7/enhance": () => live.response });
    live.push({ type: "step", text: "Reading “Weeknight Chili”: 2 ingredients, 2 steps" });
    live.push({ type: "step", text: "Asking Home AI (qwen3-vl:32b)…", waiting: true });
    const log = await screen.findByRole("log", { name: "AI check progress" });
    await within(log).findByText("Asking Home AI (qwen3-vl:32b)…");
    expect(within(log).getByText("Reading “Weeknight Chili”: 2 ingredients, 2 steps")).toBeInTheDocument();
    expect(within(log).getByText("0:00")).toBeInTheDocument(); // the timer on the line still going
    expect(screen.getByText(/The AI was asked to/)).toBeInTheDocument();
    expect(server.sent.find((s) => s.path === "/api/recipes/7/enhance")!.headers.accept).toMatch(/application\/x-ndjson/);
    live.push({ type: "step", text: "Answer received from Home AI" });
    live.push({ type: "step", text: "Instructions: 1 step filled in or fixed" });
    live.push({ type: "result", enhancement: suggestion() });
    live.end();
    expect(await screen.findByRole("region", { name: "Ingredients" })).toBeInTheDocument();
    // done: the list folds away behind a ">", and opens again on click
    expect(screen.queryByRole("log", { name: "AI check progress" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: /What the AI did/ }));
    const done = within(screen.getByRole("log", { name: "AI check progress" }));
    expect(done.getByText("Instructions: 1 step filled in or fixed")).toBeInTheDocument();
    expect(done.getByText("Asked Home AI (qwen3-vl:32b)")).toBeInTheDocument(); // finished: past tense, with how long it took
    expect(done.getByText(/^took \d+:\d\d$/)).toBeInTheDocument();
    expect(screen.queryByText(/The AI was asked to/)).toBeNull();
  });

  it("says when brief steps were expanded, with each step's label in bold", async () => {
    const steps = ["# Prep and Season", "Pat dry: Pat the chops dry so they sear well.", "# Sear", "Brown: Sear 3–5 minutes per side."];
    open({ "POST /api/recipes/7/enhance": () => suggestion({ steps: { suggested: steps, changes: ["Expanded the steps."], changed: true, mode: "expanded" } }) });
    const sec = await goTo(userEvent.setup(), "Instructions");
    expect(within(sec).getByText("Expanded")).toBeInTheDocument();
    expect(within(sec).getByText("Prep and Season")).toBeInTheDocument();
    expect(within(sec).getByText("Pat dry:").tagName).toBe("STRONG");
  });

  it("a failure in the middle shows the reason; a refusal (AI Enhance off) has no Try again", async () => {
    const live = ndjsonStream();
    open({ "POST /api/recipes/7/enhance": () => live.response });
    live.push({ type: "step", text: "Asking Home AI (qwen3-vl:32b)…", waiting: true });
    live.push({ type: "error", status: 409, error: "AI Enhance is turned off. Turn it on in Settings › AI." });
    live.end();
    expect(await screen.findByText(/AI Enhance is turned off/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("a slow AI service", () => {
  it("shows the AI thinking, then writing with a word count, on the line still going", async () => {
    const live = ndjsonStream();
    open({ "POST /api/recipes/7/enhance": () => live.response });
    live.push({ type: "step", text: "Asking Home AI (qwen3-vl:32b)…", waiting: true });
    live.push({ type: "status", text: "Home AI is thinking…" });
    const log = await screen.findByRole("log", { name: "AI check progress" });
    expect(await within(log).findByText("Home AI is thinking…")).toBeInTheDocument();
    live.push({ type: "status", text: "Home AI is writing… 42 words" });
    expect(await within(log).findByText("Home AI is writing… 42 words")).toBeInTheDocument();
    expect(within(log).queryByText("Home AI is thinking…")).toBeNull(); // replaced, not added
  });

  it("Skip stops waiting for that service and asks the next one", async () => {
    const u = userEvent.setup();
    const live = ndjsonStream();
    const { server } = open({
      "POST /api/recipes/7/enhance": (_b: unknown, path: string) => (path.includes("skip=home") ? suggestion() : live.response),
    });
    live.push({ type: "step", text: "Reading “Weeknight Chili”: 2 ingredients, 2 steps" });
    live.push({ type: "step", text: "Asking Home AI (qwen3-vl:32b)…", waiting: true, skip: { id: "home", name: "Home AI" } });
    await u.click(await screen.findByRole("button", { name: "Skip Home AI" }));
    expect(await screen.findByRole("region", { name: "Ingredients" })).toBeInTheDocument();
    const calls = server.sent.filter((s) => s.path.startsWith("/api/recipes/7/enhance"));
    expect(calls.map((c) => c.path)).toEqual(["/api/recipes/7/enhance", "/api/recipes/7/enhance?skip=home"]);
    expect(calls[0].signal?.aborted).toBe(true); // the first request was stopped
    await u.click(screen.getByRole("button", { name: /What the AI did/ }));
    const log = within(screen.getByRole("log", { name: "AI check progress" }));
    expect(log.getByText("Skipped Home AI")).toBeInTheDocument();
    expect(log.getAllByText(/^Reading/)).toHaveLength(1);
  });

  it("no Skip button when there's no other service to ask", async () => {
    const live = ndjsonStream();
    open({ "POST /api/recipes/7/enhance": () => live.response });
    live.push({ type: "step", text: "Asking Home AI (qwen3-vl:32b)…", waiting: true });
    await screen.findByText("Asking Home AI (qwen3-vl:32b)…");
    expect(screen.queryByRole("button", { name: /^Skip/ })).toBeNull();
  });
});

describe("AI check nutrition", () => {
  it("shows added sugars and the serving size it suggests", async () => {
    const withMore = suggestion({ nutrition: { suggested: { calories: 410, fat: 22, saturatedFat: 8, carbs: 10, fiber: 3, sugar: 2, addedSugar: 1, protein: 33, sodium: 640, source: "ai", servings: 4, servingSize: "About 1 cup", note: null }, changes: [], changed: true } });
    open({ "POST /api/recipes/7/enhance": () => withMore });
    const nut = await goTo(userEvent.setup(), "Nutrition");
    expect(within(nut).getByText("Added sugars")).toBeInTheDocument();
    expect(within(nut).getByText("1 g")).toBeInTheDocument();
    expect(within(nut).getByText("Serving size")).toBeInTheDocument();
    expect(within(nut).getByText("About 1 cup")).toBeInTheDocument();
  });
});


describe("The name, servings, serving size and Makes on the first step", () => {
  it("a pencil by the name at the top renames the recipe on the first step", async () => {
    const u = userEvent.setup();
    const server = fakeServer({ "POST /api/recipes/7/enhance": () => suggestion(), "PATCH /api/recipes/7": () => recipeJson({ title: "Best Chili" }) });
    const onChanged = vi.fn();
    render(<EnhanceWizard recipe={recipe} onClose={() => {}} onApplied={() => {}} onChanged={onChanged} />);
    await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 });
    await u.click(screen.getByRole("button", { name: "Rename the recipe" }));
    const name = screen.getByRole("textbox", { name: "Recipe name" });
    await u.clear(name);
    await u.type(name, "Best Chili{Enter}");
    await screen.findByRole("dialog", { name: "Best Chili" });
    expect(server.writes().find((w) => w.path === "/api/recipes/7" && w.method === "PATCH")!.body).toEqual({ title: "Best Chili" });
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ title: "Best Chili" }));
  });

  it("the name's pencil is only on the first step", async () => {
    const u = userEvent.setup();
    open();
    await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 });
    expect(screen.getByRole("button", { name: "Rename the recipe" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Accept change" }));
    expect(screen.queryByRole("button", { name: "Rename the recipe" })).toBeNull();
  });

  it("shows servings, serving size and Makes; one that isn't filled in can be typed in and saved", async () => {
    const u = userEvent.setup();
    const server = fakeServer({ "POST /api/recipes/7/enhance": () => suggestion(), "PATCH /api/recipes/7": () => recipeJson({ yieldText: "8 bowls" }) });
    render(<EnhanceWizard recipe={recipe} onClose={() => {}} onApplied={() => {}} />);
    await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 });
    const details = screen.getByRole("group", { name: "Recipe details" });
    expect(within(details).getByText("Servings")).toBeInTheDocument();
    expect(within(details).getByText("4")).toBeInTheDocument();
    expect(within(details).getByText("Serving size")).toBeInTheDocument();
    await u.type(within(details).getByRole("textbox", { name: "Makes" }), "8 bowls");
    await u.click(within(details).getByRole("button", { name: "Save details" }));
    await vi.waitFor(() => expect(server.writes().find((w) => w.method === "PATCH")?.body).toEqual({ yieldText: "8 bowls" }));
    expect(await within(details).findByText("8 bowls")).toBeInTheDocument();
  });

  it("the details pencil edits servings; the serving size typed in goes with the nutrition you accept", async () => {
    const u = userEvent.setup();
    const { server } = open({ "PATCH /api/recipes/7": () => recipeJson({ servings: 6 }) });
    await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 });
    const details = screen.getByRole("group", { name: "Recipe details" });
    await u.click(within(details).getByRole("button", { name: "Edit servings and size" }));
    const servings = within(details).getByRole("textbox", { name: "Servings" });
    await u.clear(servings);
    await u.type(servings, "6");
    await u.type(within(details).getByRole("textbox", { name: "Serving size" }), "1½ cups");
    await u.click(within(details).getByRole("button", { name: "Save details" }));
    await vi.waitFor(() => expect(server.writes().find((w) => w.method === "PATCH")?.body).toEqual({ servings: 6 }));
    for (let i = 0; i < 4; i++) await u.click(await screen.findByRole("button", { name: "Accept change" }));
    await vi.waitFor(() => expect(server.writes().find((w) => w.path === "/api/recipes/7/enhance/apply")).toBeTruthy());
    expect(server.writes().find((w) => w.path === "/api/recipes/7/enhance/apply")!.body.nutrition).toMatchObject({ servingSize: "1½ cups" });
  });

  it("later steps still show the servings and Makes, without editing", async () => {
    const u = userEvent.setup();
    fakeServer({ "POST /api/recipes/7/enhance": () => suggestion() });
    render(<EnhanceWizard recipe={{ ...recipe, yieldText: "8 bowls" }} onClose={() => {}} onApplied={() => {}} />);
    await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 });
    await u.click(screen.getByRole("button", { name: "Accept change" }));
    expect(screen.queryByRole("group", { name: "Recipe details" })).toBeNull();
    expect(screen.getByText(/Serves 4 · Makes 8 bowls/)).toBeInTheDocument();
  });
});

describe("A recipe with no servings: asked first, before the AI check", () => {
  const portions = { totalGrams: 480, options: [{ servings: 16, servingSize: "2 tbsp (30 g)", yieldText: "2 cups" }, { servings: 8, servingSize: "¼ cup (60 g)", yieldText: "2 cups" }] };
  const noServings = { ...recipe, servings: null } as Recipe;

  it("asks how many servings first; the AI check starts only once they're saved", async () => {
    const u = userEvent.setup();
    const server = fakeServer({
      "POST /api/recipes/7/portions": () => portions,
      "PATCH /api/recipes/7": () => recipeJson({ servings: 16, yieldText: "2 cups" }),
      "POST /api/recipes/7/enhance": () => suggestion(),
    });
    const onChanged = vi.fn();
    render(<EnhanceWizard recipe={noServings} onClose={() => {}} onApplied={() => {}} onChanged={onChanged} />);
    const ask = await screen.findByRole("region", { name: "How many servings?" });
    expect(server.sent.some((s) => s.path.startsWith("/api/recipes/7/enhance"))).toBe(false);
    expect(screen.queryByRole("log", { name: "AI check progress" })).toBeNull(); // (nothing's being checked yet)
    await u.click(await within(ask).findByRole("radio", { name: /16 servings|2 cups.*2 tbsp/ }));
    await u.click(within(ask).getByRole("button", { name: "Save and continue" }));
    await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 });
    const paths = server.writes().map((w) => w.path);
    expect(paths.indexOf("/api/recipes/7")).toBeLessThan(paths.findIndex((p) => p.startsWith("/api/recipes/7/enhance")));
    expect(server.writes().find((w) => w.method === "PATCH")!.body).toEqual({ servings: 16, yieldText: "2 cups" });
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ servings: 16 }));
  });

  it("the serving size picked goes with the AI's nutrition", async () => {
    const u = userEvent.setup();
    const server = fakeServer({
      "POST /api/recipes/7/portions": () => portions,
      "PATCH /api/recipes/7": () => recipeJson({ servings: 16, yieldText: "2 cups" }),
      "POST /api/recipes/7/enhance": () => suggestion(),
      "POST /api/recipes/7/enhance/apply": () => recipeJson(),
    });
    render(<EnhanceWizard recipe={noServings} onClose={() => {}} onApplied={() => {}} />);
    await u.click(await screen.findByRole("radio", { name: /2 tbsp/ }));
    await u.click(screen.getByRole("button", { name: "Save and continue" }));
    for (let i = 0; i < 4; i++) await u.click(await screen.findByRole("button", { name: "Accept change" }, { timeout: 3000 }));
    await vi.waitFor(() => expect(server.writes().find((w) => w.path === "/api/recipes/7/enhance/apply")).toBeTruthy());
    expect(server.writes().find((w) => w.path === "/api/recipes/7/enhance/apply")!.body.nutrition).toMatchObject({ servingSize: "2 tbsp (30 g)" });
  });

  it("Cancel closes the wizard without checking anything", async () => {
    const u = userEvent.setup();
    const server = fakeServer({ "POST /api/recipes/7/portions": () => portions });
    const onClose = vi.fn();
    render(<EnhanceWizard recipe={noServings} onClose={onClose} onApplied={() => {}} />);
    await u.click(await within(await screen.findByRole("region", { name: "How many servings?" })).findByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(server.sent.some((s) => s.path.startsWith("/api/recipes/7/enhance"))).toBe(false);
  });
});

describe("Changing servings in the wizard after the check", () => {
  it("divides the AI's nutrition again: per serving follows the new count", async () => {
    const u = userEvent.setup();
    const { server } = open({ "PATCH /api/recipes/7": () => recipeJson({ servings: 8 }) });
    await screen.findByRole("region", { name: "Ingredients" }, { timeout: 3000 });
    const details = screen.getByRole("group", { name: "Recipe details" });
    await u.click(within(details).getByRole("button", { name: "Edit servings and size" }));
    const servings = within(details).getByRole("textbox", { name: "Servings" });
    await u.clear(servings);
    await u.type(servings, "8");
    await u.click(within(details).getByRole("button", { name: "Save details" }));
    await vi.waitFor(() => expect(server.writes().find((w) => w.method === "PATCH")).toBeTruthy());
    for (let i = 0; i < 4; i++) await u.click(await screen.findByRole("button", { name: "Accept change" }));
    await vi.waitFor(() => expect(server.writes().find((w) => w.path === "/api/recipes/7/enhance/apply")).toBeTruthy());
    // suggested for 4 servings: 410 kcal, 640 mg sodium; for 8 servings, half
    expect(server.writes().find((w) => w.path === "/api/recipes/7/enhance/apply")!.body.nutrition).toMatchObject({ servings: 8, calories: 205, sodium: 320, protein: 16.5 });
  });
});
