import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../lib/errors.js";
import { logEvent } from "../lib/appLog.js";
import { getFeatures, setFeatures } from "../lib/features.js";

const NAMES = { ai: "AI", apiKeys: "API keys", aiEnhance: "AI Enhance", autoNutrition: "Auto nutrition", recipeVersions: "Recipe versioning", savedCopies: "Saved copies", publicLinks: "Public share links", discoveryRefresh: "Discovery refresh" } as const;

export default async function featureRoutes(app: FastifyInstance) {
  const requireLogin = (req: { auth?: { method: string } }) => {
    if (req.auth?.method !== "token") throw new HttpError(403, "Sign in to do this");
  };

  // The on/off switches on Settings > AI and API keys (signed in only; never with an API key)
  app.get("/api/settings/features", async (req) => {
    requireLogin(req);
    return getFeatures(app.db);
  });

  app.put("/api/settings/features", async (req) => {
    requireLogin(req);
    const changes = z.object({ ai: z.boolean(), apiKeys: z.boolean(), aiEnhance: z.boolean(), autoNutrition: z.boolean(), recipeVersions: z.boolean(), savedCopies: z.boolean(), publicLinks: z.boolean(), discoveryRefresh: z.boolean() }).partial().strict().parse(req.body);
    const before = await getFeatures(app.db);
    const after = await setFeatures(app.db, changes);
    for (const k of Object.keys(changes) as (keyof typeof NAMES)[]) {
      if (before[k] !== after[k])
        await logEvent(app.db, { category: k === "apiKeys" ? "api" : k === "recipeVersions" || k === "savedCopies" || k === "publicLinks" || k === "discoveryRefresh" ? "import" : "ai", level: "info", source: "Settings", event: `${NAMES[k]} turned ${after[k] ? "on" : "off"}` });
    }
    return after;
  });
}
