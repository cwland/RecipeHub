# RecipeHub: one image with the API and the built web app.
# Build for the homelab (x86_64, any CPU with SSE4.2; AVX isn't needed):  docker buildx build --platform linux/amd64 -t recipehub .

# ---- web app ----
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- API (compiled once, on the build machine; the output is plain JavaScript) ----
FROM --platform=$BUILDPLATFORM node:22-alpine AS api
WORKDIR /src/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# ---- runtime (the target platform, e.g. linux/amd64) ----
# Debian (glibc), not Alpine: the image processing and PDF libraries' Alpine builds can need newer
# CPU instructions (AVX2) and crash with "illegal instruction" on older homelab CPUs. These run on any
# x86-64 CPU with SSE4.2 (tested on an emulated CPU with no AVX at all).
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/app/data \
    BACKUP_DIR=/app/data/backups \
    WEB_DIR=/app/web
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force \
 # In the image the server tools run the compiled files: docker compose exec recipehub npm run reset-password
 && npm pkg set scripts.reset-password="node dist/cli/reset-password.js" scripts.auth:reset="node dist/cli/auth-reset.js"
COPY --from=api /src/backend/dist ./dist
COPY backend/drizzle ./drizzle
COPY --from=web /src/frontend/dist ./web
RUN mkdir -p /app/data/backups && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Database migrations run automatically when the server starts
CMD ["node", "dist/index.js"]
