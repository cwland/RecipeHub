import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveWeb } from "../src/web.js";

// A share link pasted into Messages, WhatsApp, Slack…: the page carries the recipe's title,
// summary and photo (Open Graph), so the preview card shows the recipe
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recipehub-web-"));
fs.writeFileSync(path.join(dir, "index.html"), '<!doctype html><html><head><meta charset="UTF-8" /><title>RecipeHub</title></head><body><div id="root"></div></body></html>');
const TOKEN = "rcp_0123456789abcdef0123456789abcdef";
const app = Fastify();
beforeAll(async () => {
  await serveWeb(app, dir, {
    preview: async (token) => (token === TOKEN ? { title: 'Chili "Texas" <style>', description: "Smoky & quick", image: "https://recipes.test/api/photos/a.webp", url: `https://recipes.test/share/${TOKEN}` } : null),
  });
  await app.ready();
});
afterAll(async () => app.close());

describe("share link previews", () => {
  it("the page has the recipe's title, summary and photo, escaped", async () => {
    const html = (await app.inject({ method: "GET", url: `/share/${TOKEN}` })).body;
    expect(html).toContain("<title>Chili &quot;Texas&quot; &lt;style&gt; · RecipeHub</title>");
    expect(html).toContain('<meta property="og:title" content="Chili &quot;Texas&quot; &lt;style&gt;" />');
    expect(html).toContain('<meta property="og:description" content="Smoky &amp; quick" />');
    expect(html).toContain('<meta property="og:image" content="https://recipes.test/api/photos/a.webp" />');
    expect(html).toContain(`<meta property="og:url" content="https://recipes.test/share/${TOKEN}" />`);
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).toContain('<div id="root"></div>');
  });

  it("an unknown or turned-off link, and every other page: the plain app page", async () => {
    for (const url of ["/share/rcp_ffffffffffffffffffffffffffffffff", "/", "/#/recipes"]) {
      const html = (await app.inject({ method: "GET", url })).body;
      expect([url, html.includes("og:title")]).toEqual([url, false]);
    }
  });
});
