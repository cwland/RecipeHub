import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";

// Production: serve the built web app (frontend/dist) from the API, so Docker runs one container.
// The app uses #/ addresses, so every page is index.html; anything that isn't a file or /api is too.
// A share link's preview card (Messages, WhatsApp, Slack read these without running the app)
export interface SharePreview {
  title: string;
  description: string | null;
  image: string | null; // a full address
  url: string;
}
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function withPreview(html: string, p: SharePreview) {
  const tags = [
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="RecipeHub" />`,
    `<meta property="og:title" content="${attr(p.title)}" />`,
    p.description && `<meta property="og:description" content="${attr(p.description)}" />`,
    p.description && `<meta name="description" content="${attr(p.description)}" />`,
    p.image && `<meta property="og:image" content="${attr(p.image)}" />`,
    `<meta property="og:url" content="${attr(p.url)}" />`,
    `<meta name="twitter:card" content="${p.image ? "summary_large_image" : "summary"}" />`,
    `<meta name="robots" content="noindex" />`,
  ].filter(Boolean);
  return html.replace(/<title>[^<]*<\/title>/, `<title>${attr(p.title)} · RecipeHub</title>`).replace("</head>", `${tags.join("\n    ")}\n  </head>`);
}

export async function serveWeb(app: FastifyInstance, dir: string, opts: { preview?: (token: string, base: string) => Promise<SharePreview | null> } = {}) {
  if (!fs.existsSync(path.join(dir, "index.html"))) {
    app.log.warn(`WEB_DIR=${dir} has no index.html: the web app isn't served`);
    return;
  }
  await app.register(fastifyStatic, {
    root: dir,
    wildcard: false,
    cacheControl: false, // set below instead
    // Built files in assets/ have a hash in their name and never change; everything else
    // (index.html, the icon, the manifest) is checked each time
    setHeaders: (res, file) => res.setHeader("Cache-Control", file.startsWith(path.join(dir, "assets") + path.sep) ? "public, max-age=31536000, immutable" : "no-cache"),
  });
  app.get("/*", async (req, reply) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    // A share link: the app page with the recipe's preview tags
    const token = rel.match(/^share\/(rcp_[0-9a-f]{32})\/?$/)?.[1];
    if (token && opts.preview) {
      const p = await opts.preview(token, `${req.protocol}://${req.host}`).catch(() => null);
      if (p) return reply.header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(withPreview(fs.readFileSync(path.join(dir, "index.html"), "utf8"), p));
    }
    const file = path.join(dir, rel);
    if (rel && file.startsWith(dir + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return reply.sendFile(rel);
    return reply.header("Cache-Control", "no-cache").sendFile("index.html");
  });
}
