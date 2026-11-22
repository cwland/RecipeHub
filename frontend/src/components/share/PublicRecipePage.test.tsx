import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PublicRecipePage, { shareTokenFrom } from "./PublicRecipePage";
import { fakeServer } from "../../test/fakeServer";

// /share/rcp_…: a shared recipe, read-only, for anyone (no sign-in)
const TOKEN = "rcp_0123456789abcdef0123456789abcdef";
const shared = {
  title: "Texas Chili",
  description: "Big and beefy.",
  imageUrl: "/api/photos/abc.webp",
  ingredients: [
    { raw: "2 lb chuck", quantity: 2, quantityMax: null, unit: "lb", name: "chuck", note: null },
    { raw: "salt", quantity: null, quantityMax: null, unit: null, name: "salt", note: null },
    { raw: "2 tbsp chopped fresh cilantro", quantity: 2, quantityMax: null, unit: "tbsp", name: "chopped fresh cilantro", note: null },
  ],
  steps: [{ section: "Cook" }, { text: "Brown the beef." }, { text: "Bake at 350°F for 2 hours." }],
  servings: 4,
  yieldText: null,
  prepMinutes: 20,
  cookMinutes: 120,
  totalMinutes: 140,
  nutrition: { calories: 520, fat: 30, saturatedFat: 12, sodium: 900, carbs: 12, fiber: 3, sugar: 4, addedSugar: null, protein: 45, servingSize: "1½ cups", source: "ai", servings: 4 },
  sourceUrl: "https://food.test/chili",
  sourceName: "Food Test",
  tags: ["spicy"],
  categories: ["Dinner"],
  updatedAt: "2026-10-31T12:00:00Z",
};

describe("the share link's address", () => {
  it("/share/<token> is a share page; anything else isn't", () => {
    expect(shareTokenFrom(`/share/${TOKEN}`)).toBe(TOKEN);
    expect(shareTokenFrom(`/share/${TOKEN}/`)).toBe(TOKEN);
    expect(shareTokenFrom("/share/nope")).toBeNull();
    expect(shareTokenFrom("/")).toBeNull();
  });
});

describe("a shared recipe", () => {
  it("shows the recipe read-only, without signing in", async () => {
    const server = fakeServer({ [`GET /api/public/share/${TOKEN}`]: () => shared });
    render(<PublicRecipePage token={TOKEN} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Texas Chili" })).toBeInTheDocument();
    expect(screen.getByText("Big and beefy.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Texas Chili" })).toHaveAttribute("src", "/api/photos/abc.webp");
    const ingredients = screen.getByRole("region", { name: "Ingredients" });
    expect(within(ingredients).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["2 lb chuck", "salt", "2 tbsp chopped fresh cilantro (2 tsp dried)"]);
    const steps = screen.getByRole("region", { name: "Steps" });
    expect(steps).toHaveTextContent("Cook");
    expect(steps).toHaveTextContent("Brown the beef.");
    expect(screen.getByRole("region", { name: "Nutrition" })).toHaveTextContent("520");
    expect(screen.getByRole("link", { name: /Food Test/ })).toHaveAttribute("href", "https://food.test/chili");
    expect(screen.getByText(/Shared from RecipeHub/)).toBeInTheDocument();
    expect(server.sent[0].headers.authorization).toBeUndefined();
    // nothing to change it with
    expect(screen.queryByRole("button", { name: /edit|delete|organize/i })).toBeNull();
    expect(document.title).toBe("Texas Chili · RecipeHub");
  });

  it("scales, and switches units, like the recipe page", async () => {
    fakeServer({ [`GET /api/public/share/${TOKEN}`]: () => shared });
    const u = userEvent.setup();
    render(<PublicRecipePage token={TOKEN} />);
    await screen.findByRole("heading", { level: 1, name: "Texas Chili" });
    await u.click(screen.getByRole("button", { name: "More servings" }));
    await u.click(screen.getByRole("button", { name: "More servings" }));
    await u.click(screen.getByRole("button", { name: "More servings" }));
    await u.click(screen.getByRole("button", { name: "More servings" }));
    expect(within(screen.getByRole("region", { name: "Ingredients" })).getAllByRole("listitem")[0]).toHaveTextContent("4 lb chuck");
    await u.click(screen.getByRole("radio", { name: "Metric" }));
    expect(within(screen.getByRole("region", { name: "Ingredients" })).getAllByRole("listitem")[0]).toHaveTextContent("kg");
    expect(screen.getByRole("region", { name: "Steps" })).toHaveTextContent("175°C");
  });

  it("downloads: PDF, JSON-LD, Paprika, Meal-Master, CookML, straight from the link", async () => {
    fakeServer({ [`GET /api/public/share/${TOKEN}`]: () => shared });
    render(<PublicRecipePage token={TOKEN} />);
    const menu = await screen.findByRole("region", { name: "Download" });
    const links = within(menu).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["PDF", `/api/public/share/${TOKEN}/export?format=pdf`],
      ["JSON-LD", `/api/public/share/${TOKEN}/export?format=jsonld`],
      ["Paprika", `/api/public/share/${TOKEN}/export?format=paprika`],
      ["Meal-Master", `/api/public/share/${TOKEN}/export?format=mealmaster`],
      ["CookML", `/api/public/share/${TOKEN}/export?format=cookml`],
    ]);
    for (const a of links) expect(a).toHaveAttribute("download");
  });

  it("a link that's been turned off or replaced says so", async () => {
    fakeServer({ [`GET /api/public/share/${TOKEN}`]: () => ({ status: 404, json: { error: "Recipe not found" } }) });
    render(<PublicRecipePage token={TOKEN} />);
    expect(await screen.findByRole("heading", { name: "This recipe isn't shared" })).toBeInTheDocument();
    expect(screen.getByText(/link may have been replaced or turned off/)).toBeInTheDocument();
  });
});

describe("opened from the email's Download links (?download=pdf)", () => {
  it("opens a download window with that format picked", async () => {
    fakeServer({ [`GET /api/public/share/${TOKEN}`]: () => shared });
    window.history.replaceState(null, "", `/share/${TOKEN}?download=paprika`);
    const u = userEvent.setup();
    render(<PublicRecipePage token={TOKEN} />);
    const dlg = await screen.findByRole("dialog", { name: "Download Texas Chili" });
    expect(within(dlg).getByRole("radio", { name: /Paprika/ })).toBeChecked();
    expect(within(dlg).getByRole("link", { name: "Download Paprika" })).toHaveAttribute("href", `/api/public/share/${TOKEN}/export?format=paprika`);
    await u.click(within(dlg).getByRole("radio", { name: /PDF/ }));
    expect(within(dlg).getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", `/api/public/share/${TOKEN}/export?format=pdf`);
    await u.click(within(dlg).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    window.history.replaceState(null, "", "/");
  });

  it("no ?download, or one that isn't a format: no window", async () => {
    fakeServer({ [`GET /api/public/share/${TOKEN}`]: () => shared });
    window.history.replaceState(null, "", `/share/${TOKEN}?download=exe`);
    render(<PublicRecipePage token={TOKEN} />);
    await screen.findByRole("heading", { name: "Texas Chili" });
    expect(screen.queryByRole("dialog")).toBeNull();
    window.history.replaceState(null, "", "/");
  });
});
