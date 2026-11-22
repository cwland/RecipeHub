import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// Categories and collections: A–Z, Z–A, or your own order (Manual), for every list in the app
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});

const names = async (path: string) => (await t.api("GET", path)).body.map((x: any) => x.name);

describe("sorting categories and collections", () => {
  it("Manual (your order) by default; A–Z and Z–A sort by name; Manual keeps the order you set", async () => {
    expect((await t.api("GET", "/api/organize/sort")).body).toEqual({ categories: "manual", collections: "manual" });
    const manual = await names("/api/categories");
    expect(manual[0]).toBe("Breakfast"); // the seeded order
    await t.api("PUT", "/api/organize/sort", { categories: "az" });
    const az = await names("/api/categories");
    expect(az).toEqual([...manual].sort((a, b) => a.localeCompare(b)));
    await t.api("PUT", "/api/organize/sort", { categories: "za" });
    expect(await names("/api/categories")).toEqual([...az].reverse());
    await t.api("PUT", "/api/organize/sort", { categories: "manual" });
    expect(await names("/api/categories")).toEqual(manual);
  });

  it("collections too, on their own", async () => {
    for (const name of ["Quick Meals", "air fryer", "Holidays"]) await t.api("POST", "/api/collections", { name });
    await t.api("PUT", "/api/organize/sort", { collections: "az" });
    expect(await names("/api/collections")).toEqual(["air fryer", "Holidays", "Quick Meals"]);
    expect((await t.api("GET", "/api/organize/sort")).body).toEqual({ categories: "manual", collections: "az" });
  });

  it("only A–Z, Z–A or Manual", async () => {
    expect((await t.api("PUT", "/api/organize/sort", { categories: "random" })).status).toBe(400);
  });
});
