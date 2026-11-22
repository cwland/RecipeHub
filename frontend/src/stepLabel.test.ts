import { describe, expect, it } from "vitest";
import { stepLabel } from "./recipes";

describe("a step's short label", () => {
  it("finds labels, including accented words, and leaves ordinary sentences alone", () => {
    expect(stepLabel("Pat dry: Pat the chops dry.")).toEqual(["Pat dry:", " Pat the chops dry."]);
    expect(stepLabel("Sauté the garlic: Stir for 30 seconds.")).toEqual(["Sauté the garlic:", " Stir for 30 seconds."]);
    expect(stepLabel("Check the temperature: 145°F inside.")?.[0]).toBe("Check the temperature:");
    expect(stepLabel("Add the stock and simmer: about 20 minutes, covered, until the beans are soft and creamy.")).toBeNull(); // too long to be a label
    expect(stepLabel("Heat oven to 350°F.")).toBeNull();
    expect(stepLabel("Note:")).toBeNull();
  });
});
