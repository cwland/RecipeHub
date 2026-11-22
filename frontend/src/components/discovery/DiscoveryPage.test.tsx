import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DiscoveryPage from "./DiscoveryPage";
import { fakeServer } from "../../test/fakeServer";

// Discovery: recipes from the household's RSS feeds, as cards; your tags; one post as the feed sent it
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const feeds = [
  { id: 1, url: "https://kitchen.example.com/feed", title: "Test Kitchen", siteUrl: "https://kitchen.example.com/", iconUrl: null, lastFetchedAt: ago(1), lastError: null, items: 2 },
  { id: 2, url: "https://other.example.com/feed", title: "Other Eats", siteUrl: null, iconUrl: null, lastFetchedAt: ago(2), lastError: "That page couldn't be reached (404)", items: 1 },
];
const item = (id: number, title: string, more: object = {}) => ({ id, feedId: 1, feedTitle: "Test Kitchen", feedIcon: null, title, link: `https://kitchen.example.com/p${id}`, pubDate: ago(48), author: "Deb", categories: [], description: `${title}, the post.`, thumbnailUrl: `https://cdn.example.com/${id}.jpg`, matchedTags: [], recipeId: null, ...more });
const job = (over: object) => ({ id: 40, kind: "import-url", status: "queued", source: "https://kitchen.example.com/p5", result: null, error: null, createdAt: ago(0), ...over });
const pork = { title: "Pork Roast", description: null, ingredients: ["1 (5-pound) pork butt", "3 tbsp brown sugar", "For the glaze:", "1 cup apple butter"], steps: ["Rub the pork.", { section: "To finish" }, "Roast at 300°F for 4 hours."], servings: 8, yieldText: null, prepMinutes: 15, cookMinutes: 240, totalMinutes: 255, imageUrl: null, sourceUrl: "https://kitchen.example.com/p5", sourceName: "Test Kitchen", nutrition: null };
const preview = (over: object = {}) => ({ recipe: pork, how: "schema.org", from: "site", problem: null, canAi: true, ...over });
const facts = { calories: 717.5, fat: 40, saturatedFat: 14, carbs: 4.5, fiber: 0, sugar: 4.5, protein: 50, sodium: 120, source: "ai", servings: 8, servingSize: null, note: null, perIngredient: [{ line: "1 (5-pound) pork butt", grams: 2268, calories: 5600 }, { line: "3 tbsp brown sugar", grams: 36, calories: 140 }] };
const page = (items: object[], more = false) => ({ items, more, next: more ? "1700000000000_9" : null, tags: [] });
const routes = (more: Record<string, any> = {}) =>
  fakeServer({
    "GET /api/discovery/feeds": () => feeds,
    "GET /api/discovery/tags": () => ({ tags: ["keto"] }),
    "PUT /api/discovery/tags": (b: any) => ({ tags: b.tags }),
    "GET /api/discovery/items": (_: unknown, path: string) => (path.includes("tags=keto") ? page([item(3, "Keto Pancakes", { matchedTags: ["keto"] })]) : path.includes("before=") ? page([item(9, "An older one")]) : page([item(5, "Crispy Air Fryer Chicken"), item(3, "Keto Pancakes", { matchedTags: ["keto"], thumbnailUrl: null })], true)),
    "POST /api/discovery/feeds": (b: any) => ({ status: 201, json: { ...feeds[0], id: 7, url: b.url, title: "New Feed", items: 4 } }),
    "DELETE /api/discovery/feeds/:id": () => ({ status: 204 }),
    "POST /api/discovery/refresh": () => ({ feeds: 2, added: 3, failed: 1 }),
    "GET /api/discovery/items/5/recipe": () => preview(),
    "GET /api/discovery/items/5": () => ({ ...item(5, "Crispy Air Fryer Chicken"), feedSite: "https://kitchen.example.com/", contentHtml: '<p>Pat the thighs <strong>dry</strong>.</p><img src="https://cdn.example.com/in.jpg" alt="In the pan">' }),
    ...more,
  });
const cards = async () => within(await screen.findByRole("list", { name: "Recipes from your feeds" })).getAllByRole("listitem");
beforeEach(() => (window.location.hash = "#/discover"));

describe("the Discovery page", () => {
  it("a post already in your recipes says so on its card", async () => {
    routes({ "GET /api/discovery/items": () => page([item(5, "Crispy Air Fryer Chicken", { recipeId: 31 }), item(3, "Keto Pancakes")]) });
    render(<DiscoveryPage />);
    const [saved, notYet] = await cards();
    expect(within(saved).getByText("In your recipes")).toBeInTheDocument();
    expect(within(notYet).queryByText("In your recipes")).toBeNull();
  });

  it("shows posts from every feed as cards: picture, title, feed and when", async () => {
    routes();
    render(<DiscoveryPage />);
    const [first, second] = await cards();
    expect(first).toHaveTextContent(/Crispy Air Fryer Chicken.*Test Kitchen.*2 days ago/);
    expect(first.querySelector("img")).toHaveAttribute("src", "https://cdn.example.com/5.jpg");
    expect(second.querySelector("img")).toBeNull(); // no picture in the feed: the drawn one
    expect(within(first).getByRole("link")).toHaveAttribute("href", "#/discover/5");
  });

  it("one feed at a time", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    await cards();
    await u.selectOptions(screen.getByRole("combobox", { name: "Feed" }), "Other Eats");
    await waitFor(() => expect(s.sent.some((r) => r.method === "GET" && r.path.startsWith("/api/discovery/items?") && r.path.includes("feed=2"))).toBe(true));
  });

  it("your tags: add and remove chips (saved for you)", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    const tags = await screen.findByRole("list", { name: "Your tags" });
    expect(within(tags).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["keto×"]);
    // the chips are under the box you add them with
    expect(screen.getByRole("textbox", { name: "Add a tag" }).compareDocumentPosition(tags) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await u.type(screen.getByRole("textbox", { name: "Add a tag" }), "air fryer{Enter}");
    await waitFor(() => expect(s.writes().at(-1)).toMatchObject({ method: "PUT", path: "/api/discovery/tags", body: { tags: ["keto", "air fryer"] } }));
    await u.click(within(tags).getByRole("button", { name: "Remove keto" }));
    await waitFor(() => expect(s.writes().at(-1)?.body).toEqual({ tags: ["air fryer"] }));
  });

  it("pasting a list adds each tag", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    await screen.findByRole("list", { name: "Your tags" });
    await u.click(screen.getByRole("textbox", { name: "Add a tag" }));
    await u.paste("air fryer, chicken,");
    await waitFor(() => expect(s.writes().at(-1)?.body).toEqual({ tags: ["keto", "air fryer", "chicken"] }));
    expect(screen.getByRole("textbox", { name: "Add a tag" })).toHaveValue("");
  });

  it("click a tag to filter by it (highlighted), click again for everything; no Show all / Filter switch", async () => {
    localStorage.clear();
    const s = routes();
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    expect(await cards()).toHaveLength(2);
    expect(screen.queryByRole("radio")).toBeNull();
    const keto = screen.getByRole("button", { name: "keto", pressed: false });
    await u.click(keto);
    expect(screen.getByRole("button", { name: "keto", pressed: true })).toBeInTheDocument();
    await waitFor(() => expect(s.sent.some((r) => r.path.includes("tags=keto"))).toBe(true));
    await waitFor(async () => expect(await cards()).toHaveLength(1));
    expect(within((await cards())[0]).getByText("keto")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "keto", pressed: true }));
    await waitFor(async () => expect(await cards()).toHaveLength(2));
    expect(s.sent.filter((r) => r.path.startsWith("/api/discovery/items?")).at(-1)!.path).not.toContain("tags=");
  });

  it("several tags highlighted: posts matching any of them", async () => {
    localStorage.clear();
    const s = routes({ "GET /api/discovery/tags": () => ({ tags: ["keto", "air fryer", "chicken"] }) });
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    await cards();
    await u.click(screen.getByRole("button", { name: "keto" }));
    await u.click(screen.getByRole("button", { name: "chicken" }));
    await waitFor(() => expect(s.sent.some((r) => decodeURIComponent(r.path).includes("tags=keto,chicken"))).toBe(true));
    expect(screen.getByRole("button", { name: "air fryer", pressed: false })).toBeInTheDocument();
  });

  it("removing a highlighted tag stops filtering by it", async () => {
    localStorage.clear();
    const s = routes();
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    await cards();
    await u.click(screen.getByRole("button", { name: "keto" }));
    await waitFor(() => expect(s.sent.some((r) => r.path.includes("tags=keto"))).toBe(true));
    await u.click(screen.getByRole("button", { name: "Remove keto" }));
    await waitFor(() => expect(s.sent.filter((r) => r.path.startsWith("/api/discovery/items?")).at(-1)!.path).not.toContain("tags="));
  });

  it("Show more loads the next page", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    await cards();
    await u.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(async () => expect(await cards()).toHaveLength(3));
    expect(s.sent.some((r) => r.path.includes("before=1700000000000_9"))).toBe(true);
  });

  it("Refresh checks the feeds now, and says what came in", async () => {
    routes();
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    await cards();
    await u.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("status")).toHaveTextContent("3 new posts · 1 feed couldn't be checked");
  });

  it("no feeds yet: says how to start, and Add a feed adds one", async () => {
    const s = routes({ "GET /api/discovery/feeds": () => [], "GET /api/discovery/items": () => page([]) });
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    expect(await screen.findByText(/Follow your favorite recipe sites/)).toBeInTheDocument();
    await u.click(screen.getAllByRole("button", { name: /Add a feed/ })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Your feeds" });
    await u.type(within(dialog).getByRole("textbox", { name: "Feed or website address" }), "https://newfeed.example.com");
    await u.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(s.writes().find((w) => w.path === "/api/discovery/feeds")?.body).toEqual({ url: "https://newfeed.example.com" }));
    expect(await within(dialog).findByText(/Added “New Feed”: 4 posts/)).toBeInTheDocument();
  });

  it("Your feeds lists each, says when one failed, and removes one", async () => {
    const s = routes();
    const u = userEvent.setup();
    render(<DiscoveryPage />);
    await cards();
    await u.click(screen.getByRole("button", { name: "Feeds" }));
    const dialog = await screen.findByRole("dialog", { name: "Your feeds" });
    const rows = within(within(dialog).getByRole("list", { name: "Feeds" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(/Test Kitchen.*2 posts/);
    expect(rows[1]).toHaveTextContent(/Other Eats.*couldn't be reached \(404\)/);
    await u.click(within(rows[1]).getByRole("button", { name: "Remove Other Eats" }));
    await u.click(within(rows[1]).getByRole("button", { name: "Remove it" }));
    await waitFor(() => expect(s.writes().at(-1)).toMatchObject({ method: "DELETE", path: "/api/discovery/feeds/2" }));
  });
});

describe("one post", () => {
  it("the feed's description is under the picture and title, above the recipe preview", async () => {
    routes();
    window.location.hash = "#/discover/5";
    render(<DiscoveryPage />);
    const summary = await screen.findByText("Crispy Air Fryer Chicken, the post.");
    const title = screen.getByRole("heading", { level: 1 });
    const preview = await screen.findByRole("region", { name: "Recipe preview" });
    expect(title.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(summary.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText("Crispy Air Fryer Chicken, the post.")).toHaveLength(1);
  });

  it("only a description from the feed: shown once, under the title", async () => {
    routes({ "GET /api/discovery/items/5": () => ({ ...item(5, "Crispy Air Fryer Chicken"), contentHtml: null }) });
    window.location.hash = "#/discover/5";
    render(<DiscoveryPage />);
    expect(await screen.findAllByText("Crispy Air Fryer Chicken, the post.")).toHaveLength(1);
    expect(screen.queryByRole("article", { name: "The post" })).toBeNull();
  });

  it("picture, title, author, feed, date and Open original site; the feed's post isn't repeated at the bottom", async () => {
    routes();
    window.location.hash = "#/discover/5";
    render(<DiscoveryPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "Crispy Air Fryer Chicken" })).toBeInTheDocument();
    expect(screen.getByText(/Deb · Test Kitchen · 2 days ago/)).toBeInTheDocument();
    await screen.findByRole("region", { name: "Recipe preview" });
    expect(screen.queryByRole("article", { name: "The post" })).toBeNull();
    expect(screen.queryByText("From the feed")).toBeNull();
    expect(screen.getByRole("link", { name: /Open original site/ })).toHaveAttribute("href", "https://kitchen.example.com/p5");
    expect(screen.getByRole("link", { name: /Open original site/ })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: /Discover/ })).toHaveAttribute("href", "#/discover");
  });

  it("a post without a link (no recipe to preview): the feed's post is shown, made safe", async () => {
    routes({ "GET /api/discovery/items/5": () => ({ ...item(5, "Crispy Air Fryer Chicken"), link: null, contentHtml: '<p>Pat the thighs <strong>dry</strong>.</p><img src="https://cdn.example.com/in.jpg" alt="In the pan">' }) });
    window.location.hash = "#/discover/5";
    render(<DiscoveryPage />);
    const post = await screen.findByRole("article", { name: "The post" });
    expect(within(post).getByText("dry").tagName).toBe("STRONG");
    expect(within(post).getByRole("img", { name: "In the pan" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recipe preview" })).toBeNull();
  });

  describe("Import Recipe", () => {
    const openPost = (more: Record<string, any>, post: object = {}) => {
      const s = routes({ "GET /api/discovery/items/5": () => ({ ...item(5, "Crispy Air Fryer Chicken"), contentHtml: "<p>Hi</p>", ...post }), ...more });
      window.location.hash = "#/discover/5";
      render(<DiscoveryPage />);
      return s;
    };

    it("imports it, then goes straight to the new recipe and its AI check wizard", async () => {
      let polls = 0;
      const s = openPost({
        "POST /api/discovery/items/5/import": () => ({ status: 202, json: job({}) }),
        "GET /api/imports/:id": () => (++polls > 1 ? job({ status: "done", result: { recipeId: 31, title: "Crispy Air Fryer Chicken" } }) : job({ status: "running" })),
      });
      const u = userEvent.setup();
      await u.click(await screen.findByRole("button", { name: "Import Recipe" }));
      expect(await screen.findByText(/Importing/)).toBeInTheDocument();
      await waitFor(() => expect(window.location.hash).toBe("#/recipes/31?imported=1"), { timeout: 4000 });
      expect(s.writes().map((w) => w.path)).toEqual(["/api/discovery/items/5/import"]);
    });

    it("already in your recipes: says so, with the link", async () => {
      openPost({ "POST /api/discovery/items/5/import": () => ({ status: 202, json: job({}) }), "GET /api/imports/:id": () => job({ status: "done", result: { duplicateOf: 8, title: "Crispy Air Fryer Chicken" } }) });
      const u = userEvent.setup();
      await u.click(await screen.findByRole("button", { name: "Import Recipe" }));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Already in your recipes"), { timeout: 4000 });
      expect(screen.getByRole("link", { name: "Open the recipe" })).toHaveAttribute("href", "#/recipes/8");
    });

    it("it couldn't be imported: says why, and can be tried again", async () => {
      openPost({ "POST /api/discovery/items/5/import": () => ({ status: 202, json: job({}) }), "GET /api/imports/:id": () => job({ status: "failed", error: "That page couldn't be reached (404). The feed's copy of the post didn't have the recipe either." }) });
      const u = userEvent.setup();
      await u.click(await screen.findByRole("button", { name: "Import Recipe" }));
      expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent(/feed's copy of the post didn't have the recipe either/);
      expect(screen.getByRole("button", { name: "Import Recipe" })).toBeEnabled();
    });

    it("a post already in your recipes: In your recipes, with the link, instead of Import", async () => {
      openPost({}, { recipeId: 31 });
      expect(await screen.findByText("In your recipes")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open the recipe" })).toHaveAttribute("href", "#/recipes/31");
      expect(screen.queryByRole("button", { name: "Import Recipe" })).toBeNull();
    });

    it("a post without a link can't be imported", async () => {
      openPost({}, { link: null });
      await screen.findByRole("heading", { level: 1 });
      expect(screen.queryByRole("button", { name: "Import Recipe" })).toBeNull();
    });
  });

  describe("the recipe preview", () => {
    const open = (more: Record<string, any> = {}, post: object = {}) => {
      const s = routes({ "GET /api/discovery/items/5": () => ({ ...item(5, "Crispy Air Fryer Chicken"), contentHtml: "<p>The story of this roast.</p>", ...post }), ...more });
      window.location.hash = "#/discover/5";
      render(<DiscoveryPage />);
      return s;
    };
    const region = () => screen.findByRole("region", { name: "Recipe preview" });

    it("shows the recipe read from its page: ingredients, steps, servings and times, and says how it was read", async () => {
      const s = open();
      const r = await region();
      await within(r).findByText("Read from the recipe's site, without AI");
      expect(within(r).getByRole("heading", { name: "Pork Roast" })).toBeInTheDocument();
      expect(within(r).getByText("Serves 8 · Prep 15 min · Cook 4 hr")).toBeInTheDocument();
      const ing = within(r).getByRole("list", { name: "Ingredients" });
      expect(within(ing).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1 (5-pound) pork butt", "3 tbsp brown sugar", "1 cup apple butter"]);
      expect(within(ing).getByText("For the glaze")).toBeInTheDocument();
      const steps = within(r).getByRole("list", { name: "Steps" });
      expect(within(steps).getAllByRole("listitem").map((li) => li.lastChild!.textContent)).toEqual(["Rub the pork.", "Roast at 300°F for 4 hours."]);
      expect(within(r).getByText("To finish")).toBeInTheDocument();
      // nothing saved, nothing sent; the feed's post is still below
      expect(s.writes()).toEqual([]);
      expect(screen.getByRole("button", { name: "Import Recipe" })).toBeInTheDocument();
      expect(screen.queryByRole("article", { name: "The post" })).toBeNull(); // not repeated below the preview
    });

    it("read from the feed's post: says so, and why the site couldn't be used", async () => {
      open({ "GET /api/discovery/items/5/recipe": () => preview({ how: "text", from: "feed", problem: "That page couldn't be reached (403)." }) });
      const r = await region();
      expect(await within(r).findByText("Read from the feed's post, without AI")).toBeInTheDocument();
      expect(within(r).getByText(/That page couldn't be reached \(403\)/)).toBeInTheDocument();
    });

    it("read from a saved copy (the site kept RecipeHub out): says which, when, and links to it", async () => {
      open({ "GET /api/discovery/items/5/recipe": () => preview({ how: "schema.org", from: "copy", savedCopy: { from: "Wayback Machine", url: "https://web.archive.org/web/20251201185510/https://kitchen.example.com/p5", date: "2025-12-01" }, problem: "www.allrecipes.com turned the request away (402). Some sites block apps." }) });
      const r = await region();
      expect(await within(r).findByText("Read from a saved copy (Wayback Machine, Dec 1, 2025), without AI")).toBeInTheDocument();
      expect(within(r).getByRole("link", { name: "Open the saved copy" })).toHaveAttribute("href", "https://web.archive.org/web/20251201185510/https://kitchen.example.com/p5");
      expect(within(r).getByText(/turned the request away \(402\)/)).toBeInTheDocument();
    });

    it("read with AI from a saved copy", async () => {
      open({ "GET /api/discovery/items/5/recipe": () => preview({ how: "ai", from: "copy", savedCopy: { from: "archive.ph", url: "https://archive.ph/Xy12" }, problem: "kept out" }) });
      expect(await within(await region()).findByText("Read with AI from a saved copy (archive.ph)")).toBeInTheDocument();
    });

    it("no recipe on the page: says why, and Read with AI reads it when asked; Import only once there's a recipe", async () => {
      const s = open({
        "GET /api/discovery/items/5/recipe": () => preview({ recipe: null, how: null, from: null, problem: "The recipe's page has no recipe data RecipeHub can read without AI." }),
        "POST /api/discovery/items/5/recipe/ai": () => preview({ how: "ai" }),
      });
      const r = await region();
      expect(await within(r).findByText(/no recipe data RecipeHub can read without AI/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Import Recipe" })).toBeNull();
      await userEvent.setup().click(within(r).getByRole("button", { name: "Read with AI" }));
      expect(await within(r).findByText("Read with AI from the recipe's site")).toBeInTheDocument();
      expect(within(r).getByRole("list", { name: "Ingredients" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Import Recipe" })).toBeInTheDocument();
      expect(s.writes().map((w) => w.path)).toEqual(["/api/discovery/items/5/recipe/ai"]);
    });

    it("no recipe and AI off: no Read with AI, and says where to turn it on", async () => {
      open({ "GET /api/discovery/items/5/recipe": () => preview({ recipe: null, how: null, from: null, problem: "The recipe's page has no recipe data RecipeHub can read without AI.", canAi: false }) });
      const r = await region();
      expect(await within(r).findByText(/Turn on AI in Settings › AI/)).toBeInTheDocument();
      expect(within(r).queryByRole("button", { name: "Read with AI" })).toBeNull();
    });

    it("Read with AI fails: says why", async () => {
      open({
        "GET /api/discovery/items/5/recipe": () => preview({ recipe: null, how: null, from: null, problem: "No recipe data." }),
        "POST /api/discovery/items/5/recipe/ai": () => ({ status: 422, json: { error: "No recipe was found there." } }),
      });
      const r = await region();
      await userEvent.setup().click(await within(r).findByRole("button", { name: "Read with AI" }));
      expect(await within(r).findByRole("alert")).toHaveTextContent("No recipe was found there.");
    });

    it("Calculate nutrition: each ingredient's calories and the label per serving", async () => {
      const s = open({ "POST /api/discovery/items/5/recipe/nutrition": () => preview({ recipe: { ...pork, nutrition: facts } }) });
      const r = await region();
      await userEvent.setup().click(await within(r).findByRole("button", { name: "Calculate nutrition" }));
      const n = await within(r).findByRole("region", { name: "Nutrition" });
      expect(within(n).getByText("718")).toBeInTheDocument();
      expect(within(n).getByText(/per serving, 8 servings/)).toBeInTheDocument();
      const by = within(n).getByRole("list", { name: "Calories by ingredient" });
      expect(within(by).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1 (5-pound) pork butt5,600 kcal", "3 tbsp brown sugar140 kcal"]);
      expect(within(r).getByRole("button", { name: "Re-calculate nutrition" })).toBeInTheDocument();
      expect(s.writes().map((w) => w.path)).toEqual(["/api/discovery/items/5/recipe/nutrition"]);
    });

    it("Calculate nutrition isn't offered with AI off", async () => {
      open({ "GET /api/discovery/items/5/recipe": () => preview({ canAi: false }) });
      const r = await region();
      await within(r).findByRole("list", { name: "Ingredients" });
      expect(within(r).queryByRole("button", { name: "Calculate nutrition" })).toBeNull();
    });

    it("Calculate nutrition fails: says why", async () => {
      open({ "POST /api/discovery/items/5/recipe/nutrition": () => ({ status: 422, json: { error: "The AI didn't give a calorie estimate. Try again." } }) });
      const r = await region();
      await userEvent.setup().click(await within(r).findByRole("button", { name: "Calculate nutrition" }));
      expect(await within(r).findByRole("alert")).toHaveTextContent("calorie estimate");
    });

    it("the page couldn't be read at all: says why", async () => {
      open({ "GET /api/discovery/items/5/recipe": () => ({ status: 500, json: { error: "Something went wrong" } }) });
      const r = await region();
      expect(await within(r).findByRole("alert")).toHaveTextContent("Something went wrong");
    });
  });
});

describe("Discover's tiles across", () => {
  beforeEach(() => localStorage.clear());

  it("starts 4 across; + and − change it, like the recipe list, and it sticks", async () => {
    routes();
    const u = userEvent.setup();
    const { unmount } = render(<DiscoveryPage />);
    await cards();
    const grid = () => screen.getByRole("list", { name: "Recipes from your feeds" });
    expect(grid()).toHaveAttribute("data-across", "4");
    expect(grid().className).toContain("md:grid-cols-4");
    await u.click(screen.getByRole("button", { name: "More tiles across" }));
    expect(grid()).toHaveAttribute("data-across", "5");
    expect(grid().className).toContain("xl:grid-cols-5");
    await u.click(screen.getByRole("button", { name: "More tiles across" }));
    expect(screen.getByRole("button", { name: "More tiles across" })).toBeDisabled();
    for (let i = 0; i < 4; i++) await u.click(screen.getByRole("button", { name: "Fewer tiles across" }));
    expect(grid()).toHaveAttribute("data-across", "2");
    expect(screen.getByRole("button", { name: "Fewer tiles across" })).toBeDisabled();
    await u.click(screen.getByRole("button", { name: "More tiles across" }));
    unmount();
    render(<DiscoveryPage />);
    await cards();
    expect(grid()).toHaveAttribute("data-across", "3");
    expect(localStorage.getItem("recipehub-recipe-view")).toBeNull(); // the recipe list keeps its own
  });
});
