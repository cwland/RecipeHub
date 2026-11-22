import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// Share › Send from RecipeHub: the new email (photo, title, summary, times, an Open the recipe button
// to the public link, then the recipe), with a file of the recipe attached if you choose one
let t: TestApp;
beforeAll(async () => (t = await setupTestApp({ email: true })));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const add = async () => {
  const imageUrl = await t.app.photos.save(await sharp({ create: { width: 800, height: 500, channels: 3, background: "#c0602a" } }).png().toBuffer());
  return (await t.api("POST", "/api/recipes", { title: "Weeknight Chili", description: "Smoky & quick", servings: 6, prepMinutes: 15, cookMinutes: 40, ingredients: "2 lb ground beef\n1 cup sour cream", steps: ["Brown the beef.", "Simmer 30 minutes."], notes: "Secret: chocolate", imageUrl })).body;
};
const send = (id: number, body: object) => t.api("POST", `/api/recipes/${id}/email`, { to: "mom@example.com", ...body });
const linkOf = async (id: number) => (await t.api("GET", `/api/recipes/${id}/share-link`)).body;

describe("the shared-recipe email", () => {
  it("photo in the email, title, summary, times, and a button to the public link; the recipe underneath", async () => {
    const r = await add();
    expect((await send(r.id, { note: "Try this!" })).body).toEqual({ sent: 1 });
    const m = t.sent[0];
    expect(m.subject).toBe("Weeknight Chili");
    expect(m.html).toContain('src="cid:recipe-photo"');
    expect(m.attachments).toEqual([expect.objectContaining({ cid: "recipe-photo", contentType: "image/jpeg", contentDisposition: "inline" })]);
    expect(m.html).toContain("Smoky &amp; quick");
    expect(m.html).toContain("Prep 15 min");
    expect(m.html).toContain("Try this!");
    const link = (await linkOf(r.id)).url;
    expect(m.html).toMatch(new RegExp(`<a href="${link}"[^>]*>Open the recipe</a>`));
    expect(m.html).toContain("2 lb ground beef");
    expect(m.html).toContain("Brown the beef.");
    expect(m.text).toContain(link);
    // it goes to someone else: the recipe's notes stay out
    expect(m.html + m.text).not.toContain("chocolate");
  });

  it("at the bottom: View the recipe, and a link for each format (opens the public page ready to download it)", async () => {
    const r = await add();
    await send(r.id, {});
    const m = t.sent[0];
    const link = (await linkOf(r.id)).url;
    expect(m.html).toMatch(new RegExp(`<a href="${link}"[^>]*>View the recipe</a>`));
    for (const [id, name] of [["pdf", "PDF"], ["jsonld", "JSON-LD"], ["paprika", "Paprika"], ["mealmaster", "Meal-Master"], ["cookml", "CookML"]])
      expect(m.html).toMatch(new RegExp(`<a href="${link}\\?download=${id}"[^>]*>${name}</a>`));
    expect(m.text).toContain(`PDF: ${link}?download=pdf`);
  });

  it("with public links off: no button (there's nothing to open), the recipe is all there", async () => {
    const r = await add();
    await t.api("PUT", "/api/settings/features", { publicLinks: false });
    await send(r.id, {});
    expect(t.sent[0].html).not.toContain("Open the recipe");
    expect(t.sent[0].html).not.toContain("?download=");
    expect(t.sent[0].html).toContain("Brown the beef.");
  });

  it("attaches the recipe as the file you choose", async () => {
    const r = await add();
    const files = { pdf: ["weeknight-chili.pdf", "application/pdf"], jsonld: ["weeknight-chili.json", "application/ld+json"], paprika: ["weeknight-chili.paprikarecipe", "application/octet-stream"], mealmaster: ["weeknight-chili.mmf", "text/plain; charset=us-ascii"], cookml: ["weeknight-chili.cml", "application/xml; charset=utf-8"] };
    for (const [attach, [filename, contentType]] of Object.entries(files)) {
      t.sent.length = 0;
      expect([attach, (await send(r.id, { attach })).status]).toEqual([attach, 200]);
      const file = t.sent[0].attachments!.find((a) => a.filename);
      expect([attach, file?.filename, file?.contentType, (file?.content as Buffer).length > 50]).toEqual([attach, filename, contentType, true]);
      expect(t.sent[0].html).toContain(`The recipe is attached as ${filename}`);
    }
    t.sent.length = 0;
    await send(r.id, { attach: "none" });
    expect(t.sent[0].attachments!.filter((a) => a.filename)).toEqual([]);
    expect((await send(r.id, { attach: "docx" })).status).toBe(400);
  });

  it("an attached file leaves the notes out too", async () => {
    const r = await add();
    await send(r.id, { attach: "mealmaster" });
    const file = t.sent[0].attachments!.find((a) => a.filename)!;
    expect(String(file.content)).not.toContain("chocolate");
  });
});
