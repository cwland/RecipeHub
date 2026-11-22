/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { existsSync, readFileSync } from "node:fs";

// The app version shown on the sign-in screen and under the account button (from package.json)
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// The API's address for `npm run dev`: API_PROXY_TARGET if set, otherwise the PORT in backend/.env
// (so moving the API to another port is one change), otherwise 4000
const backendEnv = new URL("../backend/.env", import.meta.url);
const apiPort = existsSync(backendEnv) ? readFileSync(backendEnv, "utf8").match(/^PORT=(\d+)/m)?.[1] : undefined;
const apiTarget = process.env.API_PROXY_TARGET ?? `http://localhost:${apiPort ?? 4000}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Two pages: the app, and the Send to RecipeHub relay (receive.html, see src/receiveRelay.ts)
  build: { rollupOptions: { input: { main: new URL("./index.html", import.meta.url).pathname, receive: new URL("./receive.html", import.meta.url).pathname } } },
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Screen tests run in a pretend browser (jsdom); pure-logic tests don't need one
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"] },
  server: {
    port: 5173,
    proxy: {
      // xfwd: pass the browser's address along, so Signed-in devices shows the real IP
      "/api": { target: apiTarget, xfwd: true },
    },
  },
});
