import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { securityHeaders } from "../src/lib/security.js";
import { serveWeb } from "../src/web.js";

// The Send to RecipeHub bookmark opens /receive.html from a recipe site's tab. That page must not
// send Cross-Origin-Opener-Policy, or the browser cuts the link to the tab and the page can't be
// handed over. Everything else keeps it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recipehub-web-"));
fs.writeFileSync(path.join(dir, "index.html"), "<html>app</html>");
fs.writeFileSync(path.join(dir, "receive.html"), "<html>relay</html>");
const app = Fastify();
beforeAll(async () => {
  securityHeaders(app);
  await serveWeb(app, dir);
  app.get("/api/health", async () => ({ ok: true }));
  await app.ready();
});
afterAll(async () => app.close());

describe("the relay page for Send to RecipeHub", () => {
  it("is served without the opener rule, and keeps the other security headers", async () => {
    const r = await app.inject({ method: "GET", url: "/receive.html" });
    expect(r.body).toBe("<html>relay</html>");
    expect(r.headers["cross-origin-opener-policy"]).toBeUndefined();
    expect(r.headers).toMatchObject({ "x-frame-options": "DENY", "content-security-policy": expect.stringContaining("script-src 'self'") });
  });

  it("the app and the API keep it", async () => {
    for (const url of ["/", "/index.html", "/api/health", "/receive.html.bak"]) expect([url, (await app.inject({ method: "GET", url })).headers["cross-origin-opener-policy"]]).toEqual([url, "same-origin"]);
  });
});
