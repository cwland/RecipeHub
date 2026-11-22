import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LOG_CATEGORIES, recentLogs } from "../lib/appLog.js";
import { HttpError } from "../lib/errors.js";

export default async function logRoutes(app: FastifyInstance) {
  // Settings > Logs (signed in, or a Full admin API key)
  app.get("/api/logs", async (req) => {
    // Signed in, or a Full admin API key (other keys are stopped before this; see lib/keyAccess.ts)
    if (!req.auth) throw new HttpError(403, "Log in to see the logs");
    const q = z
      .object({ category: z.enum(LOG_CATEGORIES).optional(), problems: z.enum(["true", "false"]).optional() })
      .parse(req.query);
    return recentLogs(app.db, { category: q.category, problemsOnly: q.problems === "true" });
  });
}
