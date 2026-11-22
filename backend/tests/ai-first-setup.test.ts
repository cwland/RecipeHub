import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// The first time AI is set up, AI Enhance and Auto nutrition come on with it
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
});
const aiOn = () => t.api("PUT", "/api/settings/ai", { services: [{ provider: "openai", model: "tiny", apiKey: "k" }], maxPerRun: 50 });

describe("AI set up for the first time", () => {
  it("turns on AI Enhance and Auto nutrition, even if they were switched off before", async () => {
    await t.api("PUT", "/api/settings/features", { aiEnhance: false, autoNutrition: false });
    await aiOn();
    expect((await t.api("GET", "/api/settings/features")).body).toMatchObject({ ai: true, aiEnhance: true, autoNutrition: true });
  });

  it("saving AI settings again later leaves your choices alone", async () => {
    await aiOn();
    await t.api("PUT", "/api/settings/features", { autoNutrition: false });
    await aiOn();
    expect((await t.api("GET", "/api/settings/features")).body).toMatchObject({ aiEnhance: true, autoNutrition: false });
  });
});
