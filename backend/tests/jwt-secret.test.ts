import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { Db } from "../src/db/index.js";

// JWT_SECRET signs every sign-in. The example value is published in the repo, so a server running
// with it would let anyone forge a sign-in. The Docker image (NODE_ENV=production) refuses to start;
// development only warns, since backend/.env.example is copied as is to get going.
describe("JWT_SECRET", () => {
  const start = (jwtSecret: string) => () => buildApp({ db: {} as Db, jwtSecret });
  afterEach(() => vi.unstubAllEnvs());

  it("must be set to something long", () => {
    expect(start("")).toThrow("JWT_SECRET must be set to at least 16 characters");
    expect(start("short")).toThrow("JWT_SECRET must be set to at least 16 characters");
  });

  it("the Docker image won't start with the example value", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(start("change-me-to-a-long-random-string")).toThrow("JWT_SECRET is still the example value from .env.example. Set your own: openssl rand -base64 48");
    expect(start(" Change-Me-to-something-else-long ")).toThrow("still the example value");
  });

  it("development only warns", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(start("change-me-to-a-long-random-string")).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("JWT_SECRET is still the example value"));
    warn.mockRestore();
  });
});
