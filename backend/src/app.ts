import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { eq } from "drizzle-orm";
import type { Db } from "./db/index.js";
import { apiKeys, users } from "./db/schema.js";
import { logEvent } from "./lib/appLog.js";
import logRoutes from "./routes/logs.js";
import featureRoutes from "./routes/features.js";
import updateRoutes from "./routes/updates.js";
import { UpdateService, type UpdateFetch } from "./lib/updates.js";
import { isOn } from "./lib/features.js";
import passkeyRoutes from "./routes/passkeys.js";
import oauthRoutes from "./routes/oauth.js";
import { backupKeyFromEnv, type BackupSecrets } from "./lib/settingsBackup.js";
import { keyAllows, keyDenied, type KeyAccess } from "./lib/keyAccess.js";
import { HttpError } from "./lib/errors.js";
import { hashApiKey, verifyToken } from "./lib/auth.js";
import authRoutes from "./routes/auth.js";
import keyRoutes from "./routes/keys.js";
import exportRoutes from "./routes/export.js";
import profileRoutes from "./routes/profile.js";
import settingsRoutes from "./routes/settings.js";
import recipeRoutes from "./routes/recipes.js";
import importRoutes from "./routes/imports.js";
import householdRoutes from "./routes/household.js";
import planRoutes from "./routes/plan.js";
import groceryRoutes from "./routes/grocery.js";
import eventRoutes, { EventBus } from "./lib/events.js";
import multipart from "@fastify/multipart";
import { JobQueue } from "./lib/jobs.js";
import { Photos } from "./lib/photos.js";
import { registerNutritionJob } from "./lib/nutrition.js";
import { registerBatchImprove } from "./lib/improve.js";
import { registerFileImport, registerImportJobs, registerPhotoImport } from "./lib/importJobs.js";
import { registerAisleSorting } from "./lib/aiHelpers.js";
import aiRoutes from "./routes/ai.js";
import shareRoutes from "./routes/share.js";
import inboxRoutes from "./routes/inbox.js";
import discoveryRoutes from "./routes/discovery.js";
import type { FetchImpl, FetchOptions, Resolve } from "./lib/fetchPage.js";
import organizeRoutes from "./routes/organize.js";
import { MailService, type EmailConfig, type TransportFactory } from "./lib/mail.js";
import { AiService, type AiFetch } from "./lib/ai.js";
import { sessionForToken } from "./lib/sessions.js";
import { APP_VERSION } from "./lib/version.js";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { DEFAULT_RATE_LIMIT, rateLimits, securityHeaders, type RateLimitOptions } from "./lib/security.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    jwtSecret: string;
    backupDir: string;
    backupKey: { key: string | null; problem: string | null };
    backupSecrets: () => BackupSecrets;
    oauthFetch?: typeof fetch;
    backupKeep: number;
    mail: MailService;
    ai: AiService;
    updates: UpdateService;
    now: () => Date; // the clock (tests set the date)
    jobs: JobQueue;
    photos: Photos;
    events: EventBus;
    fetchOptions: FetchOptions; // how pages and feeds are fetched (tests swap in a pretend web)
  }
  interface FastifyRequest {
    auth?: { method: "token"; userId: number; sessionId: number; role: "owner" | "member" } | { method: "apiKey"; keyId: number };
  }
}

export interface AppOptions {
  db: Db;
  jwtSecret: string;
  logger?: boolean;
  backupDir?: string;
  backupKey?: string; // BACKUP_KEY: encrypts saved keys and passwords inside backups
  oauthFetch?: typeof fetch; // tests: a fake OAuth provider
  backupKeep?: number;
  emailEnv?: EmailConfig | null; // email settings from .env (used when none are saved in the app)
  mailTransport?: TransportFactory; // tests swap in a fake
  aiFetch?: AiFetch; // tests swap in a fake AI
  aiTimeScale?: number; // tests shrink AI waits (0.01: 3 minutes becomes 1.8 seconds)
  updateFetch?: UpdateFetch; // tests swap in a fake GitHub
  updateRepo?: string; // where releases are published (UPDATE_REPO)
  githubToken?: string | null; // GITHUB_TOKEN: needed while that repository is private
  now?: () => Date; // tests set "today"
  rateLimit?: RateLimitOptions | false; // limits on sign-in routes and unknown API keys (tests turn it off)
  photoDir?: string; // where recipe photos are kept (<data>/photos)
  importFetch?: FetchImpl; // tests swap in fake web pages
  importResolve?: Resolve; // tests skip DNS
}

// Everything RecipeHub keeps on disk lives under DATA_DIR (/app/data in Docker; <repo>/data otherwise)
export const defaultDataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
// Backups go in <data>/backups unless BACKUP_DIR says otherwise
export const defaultBackupDir = path.join(process.env.DATA_DIR || defaultDataDir, "backups");

// Only the owner (not other household members) can use these
const OWNER_ONLY = ["/api/settings/email", "/api/settings/ai", "/api/settings/features", "/api/settings/oauth", "/api/keys", "/api/logs", "/api/backups", "/api/export", "/api/import", "/api/wipe", "/api/updates/check", "/api/updates/settings", "/api/household/members"];
export function ownerOnly(method: string, path: string) {
  if (path === "/api/household/members" && method === "GET") return false; // everyone can see who's in the household
  return OWNER_ONLY.some((p) => path === p || path.startsWith(p + "/"));
}

// Routes anyone can call without logging in
const PUBLIC_ROUTES = new Set([
  "GET /api/photos/:name",
  "GET /api/health",
  "GET /api/public/share/:token", // a recipe's read-only share link
  "GET /api/public/share/:token/export", // …and its downloads
  "GET /api/auth/status",
  "POST /api/auth/setup",
  "POST /api/auth/login",
  "POST /api/auth/forgot",
  "POST /api/auth/reset",
  "POST /api/auth/passkey/login/options",
  "POST /api/auth/passkey/login/verify",
  "POST /api/auth/oauth/start",
  "GET /api/auth/oauth/callback",
  "POST /api/auth/oauth/finish",
]);

export function buildApp({ db, jwtSecret, logger = false, backupDir = defaultBackupDir, backupKeep = 30, backupKey = process.env.BACKUP_KEY, oauthFetch, emailEnv = null, mailTransport, aiFetch, aiTimeScale = 1, updateFetch, updateRepo = process.env.UPDATE_REPO || "cwland/RecipeHub", githubToken = process.env.GITHUB_TOKEN || null, now = () => new Date(), rateLimit = DEFAULT_RATE_LIMIT, photoDir = path.join(process.env.DATA_DIR || defaultDataDir, "photos"), importFetch, importResolve }: AppOptions): FastifyInstance {
  if (!jwtSecret || jwtSecret.length < 16) {
    throw new Error("JWT_SECRET must be set to at least 16 characters");
  }
  // The example value is public (it's in the repo): anyone could forge a sign-in with it
  if (jwtSecret.trim().toLowerCase().startsWith("change-me")) {
    const msg = "JWT_SECRET is still the example value from .env.example. Set your own: openssl rand -base64 48";
    if (process.env.NODE_ENV === "production") throw new Error(msg);
    console.warn(`${msg} (allowed in development only)`);
  }

  // Behind a proxy on this machine or the local network (Vite in development, a reverse proxy in
  // Docker), take the visitor's address from X-Forwarded-For so devices show their real IP
  const app = Fastify({ logger, trustProxy: process.env.TRUST_PROXY ?? "loopback, linklocal, uniquelocal" });
  app.decorate("db", db);
  app.decorate("jwtSecret", jwtSecret);
  app.decorate("backupDir", backupDir);
  app.decorate("oauthFetch", oauthFetch);
  const bk = backupKeyFromEnv(backupKey);
  app.decorate("backupKey", bk);
  app.decorate("backupSecrets", () => ({ jwtSecret, backupKey: bk.key }));
  app.decorate("backupKeep", backupKeep);
  app.decorate("mail", new MailService(db, jwtSecret, emailEnv, mailTransport));
  app.decorate("ai", new AiService(db, jwtSecret, aiFetch, aiTimeScale));
  app.decorate("now", now);
  app.decorate("updates", new UpdateService(db, updateRepo, githubToken, updateFetch, now));
  app.decorate("photos", new Photos(photoDir));
  app.decorate("events", new EventBus());
  app.decorate("jobs", new JobQueue(db));
  const jobDeps = { db, ai: app.ai, photos: app.photos, jobs: app.jobs, events: app.events, fetchOptions: { fetchImpl: importFetch, resolve: importResolve } };
  app.decorate("fetchOptions", jobDeps.fetchOptions);
  registerImportJobs(app.jobs, jobDeps);
  registerPhotoImport(app.jobs, jobDeps);
  registerFileImport(app.jobs, jobDeps);
  registerAisleSorting(app.jobs, { db, ai: app.ai, events: app.events });
  registerNutritionJob(app.jobs, { db, ai: app.ai, events: app.events });
  registerBatchImprove(app.jobs, { db, ai: app.ai, jobs: app.jobs, events: app.events });
  app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

  securityHeaders(app);
  const limits = rateLimits(app, rateLimit);

  // OpenAPI: every route listed at /api/docs (the spec itself at /api/docs/json), for scripts,
  // Home Assistant and n8n. Open without signing in; calling a route still needs a token or key.
  app.register(swagger, {
    openapi: {
      info: { title: "RecipeHub API", version: APP_VERSION, description: "Send `Authorization: Bearer <token>` (from signing in) or `X-API-Key: <key>` (Settings › API keys)." },
      components: { securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "X-API-Key" }, bearer: { type: "http", scheme: "bearer" } } },
      security: [{ apiKey: [] }, { bearer: [] }],
    },
  });
  app.register(swaggerUi, { routePrefix: "/api/docs" });

  // Every /api route needs a login token or an API key, except the public ones
  app.addHook("onRequest", async (req) => {
    const route = `${req.method} ${req.routeOptions.url ?? req.url}`;
    if (!req.url.startsWith("/api/") || PUBLIC_ROUTES.has(route) || req.url === "/api/docs" || req.url.startsWith("/api/docs/")) return;

    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      const claims = verifyToken(header.slice(7), jwtSecret);
      if (claims) {
        // Tokens issued before the last "sign out everywhere" / password change no longer work
        const [user] = await db.select({ tv: users.tokenVersion, role: users.role }).from(users).where(eq(users.id, claims.userId));
        // ...and its device hasn't been signed out
        const session = user && user.tv === claims.tokenVersion ? await sessionForToken(db, req, header.slice(7), claims, app.now()) : null;
        if (session) {
          req.auth = { method: "token", userId: claims.userId, sessionId: session.id, role: user.role };
          // Server settings, API keys, backups and members are the owner's
          if (user.role !== "owner" && ownerOnly(req.method, req.routeOptions.url ?? req.url.split("?")[0])) throw new HttpError(403, "Only the household owner can do this");
          return;
        }
      }
    }

    const key = req.headers["x-api-key"];
    if (typeof key === "string" && key) {
      const [found] = await db
        .select({ id: apiKeys.id, name: apiKeys.name, access: apiKeys.access })
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, hashApiKey(key)));
      if (found) {
        // Settings > API keys switched off: every key is refused (the keys are kept)
        if (!(await isOn(db, "apiKeys"))) {
          await logEvent(db, { category: "api", level: "warning", source: `API key "${found.name}"`, event: `Refused ${req.method} ${req.url.split("?")[0]}: API keys are turned off`, detail: "Turn them back on in Settings › API keys" });
          throw new HttpError(403, "API keys are turned off in Settings");
        }
        const access = found.access as KeyAccess;
        const path = req.routeOptions.url ?? req.url.split("?")[0];
        if (!keyAllows(access, req.method, path)) {
          await logEvent(db, { category: "api", level: "warning", source: `API key "${found.name}"`, event: `Refused ${req.method} ${path}: not allowed for this key`, detail: keyDenied(access, req.method) });
          throw new HttpError(403, keyDenied(access, req.method));
        }
        req.auth = { method: "apiKey", keyId: found.id };
        await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, found.id));
        return;
      }
      await logEvent(db, { category: "api", level: "warning", source: req.ip, event: `Refused ${req.method} ${req.url.split("?")[0]}: unknown API key`, detail: `The key started with ${key.slice(0, 6)}…` });
      await limits.badKey(req.ip);
    }

    throw new HttpError(401, "Not logged in");
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: "Invalid request",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: (err as Error).message });
    }
    req.log.error(err);
    void logEvent(db, { category: "api", level: "error", source: `${req.method} ${req.routeOptions.url ?? req.url.split("?")[0]}`, event: "Server error", detail: (err as Error).message });
    return reply.status(500).send({ error: "Something went wrong" });
  });

  // (in a plugin, so they're registered after Swagger and listed in /api/docs)
  app.register(async (a) => {
    a.get("/api/health", async () => ({ status: "ok", app: "RecipeHub" }));
    // Signed in or with a key: what the server is and how you're calling it (handy for scripts)
    a.get("/api/info", async (req) => ({ app: "RecipeHub", version: APP_VERSION, auth: req.auth?.method }));
  });

  app.register(authRoutes);
  app.register(keyRoutes);
  app.register(logRoutes);
  app.register(featureRoutes);
  app.register(updateRoutes);
  app.register(passkeyRoutes);
  app.register(oauthRoutes);
  app.register(exportRoutes);
  app.register(profileRoutes);
  app.register(settingsRoutes);
  app.register(recipeRoutes);
  app.register(importRoutes);
  app.register(aiRoutes);
  app.register(shareRoutes);
  app.register(householdRoutes);
  app.register(planRoutes);
  app.register(groceryRoutes);
  app.register(eventRoutes);
  app.register(organizeRoutes);
  app.register(inboxRoutes);
  app.register(discoveryRoutes);

  return app;
}
