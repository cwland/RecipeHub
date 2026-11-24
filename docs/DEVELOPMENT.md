# Developing RecipeHub

```
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL (with recipehub and recipehub_test databases)
cp backend/.env.example backend/.env
npm run setup
npm run dev
```

- Web: http://localhost:5173 (Vite, hot reload)
- API: http://localhost:4000/api/health, docs at http://localhost:4000/api/docs

No Docker? On a Mac: `brew install postgresql@16 && brew services start postgresql@16`, then `createdb recipehub && createdb recipehub_test` and use your username in `DATABASE_URL`.

**Tests:** `npm test` runs the API tests (they use `TEST_DATABASE_URL` and wipe it each run) and the web app tests.

**Changing the database:** edit `backend/src/db/schema.ts`, then `cd backend && npm run db:generate`. The migration in `backend/drizzle/` runs the next time the API starts.

## Project layout

```
backend/            Fastify + TypeScript + Drizzle (PostgreSQL)
  src/app.ts          routes, auth check, API key scopes, security headers, rate limits, OpenAPI
  src/lib/            auth, sessions, passkeys, OAuth, AI (with failover), mail, backups, logs
  src/routes/         one file per area
  drizzle/            database migrations
  tests/              Vitest (against a real PostgreSQL)
frontend/           React + Vite + Tailwind (Figtree), light and dark themes
Dockerfile          one image: the API serves the built web app
.github/workflows/  tests + linux/amd64 image on every push
```

## Versions

What changed in each version is under **What's new** in the app (`frontend/src/changelog.ts`). The version is in `backend/package.json` and `frontend/package.json` (keep them the same).
