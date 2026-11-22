import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { recipeFromJsonLd } from "../src/lib/importRecipe.js";
import { sendDueReminders } from "../src/lib/reminders.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const chili = {
  title: "Weeknight Chili",
  description: "Smoky & quick",
  servings: 6,
  prepMinutes: 15,
  cookMinutes: 40,
  ingredients: "2 lb ground beef\nTopping:\n1 cup <b>sour cream</b>",
  steps: "Soak the beans overnight.\n\n# Cook\n\nBrown the beef.\n\nSimmer 30 minutes.",
  imageUrl: "/api/photos/0e0d2c6f-1a2b-4c3d-8e9f-001122334455.webp",
  tags: ["beef"],
  sourceUrl: "https://example.com/chili",
  sourceName: "Example Kitchen",
};

describe("sharing a recipe", () => {
  it("as schema.org JSON-LD that imports back in", async () => {
    const r = (await t.api("POST", "/api/recipes", chili)).body;
    await t.api("PUT", `/api/recipes/${r.id}/nutrition`, { calories: 420, protein: 30 });
    const res = await t.app.inject({ method: "GET", url: `/api/recipes/${r.id}/jsonld`, headers: { authorization: `Bearer ${t.getToken()}` } });
    expect(res.headers["content-type"]).toMatch(/application\/ld\+json/);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="weeknight-chili.json"');
    const ld = res.json();
    expect(ld).toMatchObject({ "@type": "Recipe", name: "Weeknight Chili", image: "http://recipes.test/api/photos/0e0d2c6f-1a2b-4c3d-8e9f-001122334455.webp", prepTime: "PT15M", cookTime: "PT40M", totalTime: "PT55M", recipeYield: "6 servings", nutrition: { calories: "420 calories", proteinContent: "30 g" } });
    expect(ld.recipeInstructions[1]).toMatchObject({ "@type": "HowToSection", name: "Cook" });
    // another app (or this one) reads it
    const back = recipeFromJsonLd(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`, "https://x.test/");
    expect(back).toMatchObject({ title: "Weeknight Chili", ingredients: ["2 lb ground beef", "1 cup sour cream"], totalMinutes: 55 });
    expect(back!.nutrition).toMatchObject({ calories: 420, protein: 30 });
  });

  it("as a page to print, escaped", async () => {
    const r = (await t.api("POST", "/api/recipes", chili)).body;
    const res = await t.app.inject({ method: "GET", url: `/api/recipes/${r.id}/print`, headers: { authorization: `Bearer ${t.getToken()}` } });
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain("<title>Weeknight Chili</title>");
    expect(res.body).toContain("1 cup &lt;b&gt;sour cream&lt;/b&gt;");
    expect(res.body).toContain("@media print");
  });

  it("by email, from a signed-in person only", async () => {
    const r = (await t.api("POST", "/api/recipes", chili)).body;
    const res = await t.api("POST", `/api/recipes/${r.id}/email`, { to: "mom@example.com, dad@example.com", note: "Try this!" });
    expect(res.body).toEqual({ sent: 2 });
    expect(t.sent.map((m) => m.to)).toEqual(["mom@example.com", "dad@example.com"]);
    const m = t.sent[0];
    expect(m.subject).toBe("Weeknight Chili");
    expect(m.html).toContain("Try this!");
    expect(m.html).toContain('src="http://recipes.test/api/photos/');
    expect(m.html).toContain("http://recipes.test/#/recipes/");
    expect(m.text).toContain("1. Soak the beans overnight.");
    expect((await t.api("POST", `/api/recipes/${r.id}/email`, { to: "not an email" })).status).toBe(400);
    const key = (await t.api("POST", "/api/keys", { name: "n8n", access: "write" })).body.key;
    t.setToken("");
    expect((await t.api("POST", `/api/recipes/${r.id}/email`, { to: "a@b.co" }, { "x-api-key": key })).status).toBe(403);
  });
});

describe("emailing the grocery list", () => {
  it("goes to you by default, grouped by aisle, only what's left", async () => {
    await t.api("PATCH", "/api/profile", { email: "alex@example.com" });
    const list = (await t.api("GET", "/api/grocery/lists")).body[0].id;
    await t.api("POST", `/api/grocery/lists/${list}/items`, { text: "2.25 cups flour, bananas, milk" });
    const milk = (await t.api("GET", `/api/grocery/lists/${list}/items`)).body.find((i: any) => i.name === "milk");
    await t.api("PATCH", `/api/grocery/items/${milk.id}`, { checked: true });
    expect((await t.api("POST", `/api/grocery/lists/${list}/email`, {})).body).toEqual({ sent: 1 });
    const m = t.sent[0];
    expect(m.to).toBe("alex@example.com");
    expect(m.subject).toBe("Grocery list: Groceries");
    expect(m.text).toBe("Groceries\n\nProduce\n[ ] bananas\n\nPantry\n[ ] 2¼ cup flour\n");
  });
});

describe("daily meal plan email", () => {
  it("sends once a day at your time, with what to start ahead", async () => {
    await t.api("PATCH", "/api/profile", { email: "alex@example.com" });
    const r = (await t.api("POST", "/api/recipes", chili)).body;
    await t.api("POST", "/api/plan", { date: "2026-11-02", slot: "dinner", title: "Tacos" });
    await t.api("POST", "/api/plan", { date: "2026-11-03", slot: "dinner", recipeId: r.id });
    t.clock.date = new Date(2026, 10, 2, 9, 0);
    expect((await t.api("PUT", "/api/profile/reminder", { remindAt: "17:30" })).body).toEqual({ remindAt: "17:30" });
    expect((await t.api("GET", "/api/auth/me")).body.user.remindAt).toBe("17:30");
    expect(await sendDueReminders(t.app.db, t.app.mail, new Date(2026, 10, 2, 17, 0))).toBe(0); // not yet
    expect(await sendDueReminders(t.app.db, t.app.mail, new Date(2026, 10, 2, 17, 35))).toBe(1);
    expect(await sendDueReminders(t.app.db, t.app.mail, new Date(2026, 10, 2, 18, 0))).toBe(0); // once a day
    const m = t.sent[0];
    expect(m.subject).toBe("Meal plan: Tacos… (start something tonight)");
    expect(m.text).toContain("Today, Monday, November 2\n- Dinner: Tacos");
    expect(m.text).toContain("Tomorrow, Tuesday, November 3\n- Dinner: Weeknight Chili");
    expect(m.text).toContain("Start ahead for tomorrow\n- Weeknight Chili: Soak the beans overnight.");
    // nothing planned: no email
    expect(await sendDueReminders(t.app.db, t.app.mail, new Date(2026, 10, 9, 18, 0))).toBe(0);
    expect(t.sent).toHaveLength(1);
    await t.api("PUT", "/api/profile/reminder", { remindAt: null });
    expect(await sendDueReminders(t.app.db, t.app.mail, new Date(2026, 10, 3, 18, 0))).toBe(0);
  });
});
