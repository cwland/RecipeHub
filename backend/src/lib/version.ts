import fs from "node:fs";

// The app's version, from backend/package.json (kept in step with frontend/package.json)
const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
export const APP_VERSION = pkg.version;
