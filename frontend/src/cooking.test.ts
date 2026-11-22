import { describe, expect, it } from "vitest";
import { convert, convertTemperatures, driedEquivalent, findTimers, formatAmount, ingredientLine, recipeUnits, scale, stepUses } from "./cooking";
import type { Ingredient } from "./recipes";

const ing = (quantity: number | null, unit: string | null, name: string, extra: Partial<Ingredient> = {}): Ingredient => ({ raw: `${quantity ?? ""} ${unit ?? ""} ${name}`.trim(), quantity, unit, name, ...extra });
const amount = (i: Ingredient, factor: number, units: "original" | "metric" | "us") => formatAmount(convert(scale(i, factor), units));

describe("scaling", () => {
  it("multiplies amounts and keeps kitchen fractions", () => {
    expect(amount(ing(1.5, "cup", "flour"), 2, "original")).toBe("3 cups");
    expect(amount(ing(1, "cup", "flour"), 0.5, "original")).toBe("½ cup");
    expect(amount(ing(2, "clove", "garlic", { quantityMax: 3 }), 2, "original")).toBe("4–6 cloves");
    expect(amount(ing(3, null, "eggs"), 1.5, "original")).toBe("4½");
  });
  it("leaves lines without amounts as written", () => {
    expect(ingredientLine({ raw: "Salt to taste", name: "Salt to taste", quantity: null, unit: null }, 2, "metric")).toMatchObject({ plain: true, name: "Salt to taste" });
    expect(ingredientLine({ raw: "Sauce:", section: "Sauce" }, 2, "metric")).toMatchObject({ plain: true, name: "Sauce" });
  });
});

describe("units", () => {
  it("US to metric, rounded the way a scale or jug reads", () => {
    expect(amount(ing(1, "cup", "milk"), 1, "metric")).toBe("240 ml");
    expect(amount(ing(4, "cup", "stock"), 1, "metric")).toBe("950 ml");
    expect(amount(ing(5, "cup", "stock"), 1, "metric")).toBe("1.18 l");
    expect(amount(ing(8, "oz", "cheese"), 1, "metric")).toBe("225 g");
    expect(amount(ing(2, "lb", "beef"), 1, "metric")).toBe("905 g");
    expect(amount(ing(1, "tbsp", "oil"), 1, "metric")).toBe("1 tbsp"); // spoons are spoons everywhere
  });
  it("metric to US", () => {
    expect(amount(ing(500, "g", "pasta"), 1, "us")).toBe("1⅛ lb");
    expect(amount(ing(450, "g", "pasta"), 1, "us")).toBe("1 lb");
    expect(amount(ing(200, "g", "chocolate"), 1, "us")).toBe("7 oz");
    expect(amount(ing(250, "ml", "cream"), 1, "us")).toBe("1 cup");
    expect(amount(ing(30, "ml", "lemon juice"), 1, "us")).toBe("2 tbsp");
    expect(amount(ing(1.5, "l", "water"), 1, "us")).toBe("1⅝ qt");
  });
  it("scale first, then convert; counts never change", () => {
    expect(amount(ing(100, "g", "butter"), 2, "us")).toBe("7 oz");
    expect(amount(ing(2, "can", "tomatoes"), 1, "metric")).toBe("2 cans");
  });
  it("knows which way a recipe leans", () => {
    expect(recipeUnits([ing(500, "g", "pasta"), ing(200, "ml", "cream"), ing(1, "cup", "x")])).toBe("metric");
    expect(recipeUnits([ing(1, "cup", "flour")])).toBe("us");
    expect(recipeUnits([ing(3, null, "eggs")])).toBeNull();
  });
});

describe("temperatures", () => {
  it("shows the other scale", () => {
    expect(convertTemperatures("Heat the oven to 350°F.", "metric")).toBe("Heat the oven to 175°C.");
    expect(convertTemperatures("Bake at 200 C for 20 minutes", "us")).toBe("Bake at 390°F for 20 minutes");
    expect(convertTemperatures("Bake at 400 degrees F", "metric")).toBe("Bake at 205°C");
    expect(convertTemperatures("Heat to 350°F", "original")).toBe("Heat to 350°F");
    expect(convertTemperatures("Heat to 180°C", "metric")).toBe("Heat to 180°C");
    expect(convertTemperatures("Add 2 C of flour", "us")).toBe("Add 2 C of flour");
  });
});

describe("timers in steps", () => {
  const t = (s: string) => findTimers(s).map((x) => [s.slice(x.start, x.end), x.label, x.seconds]);
  it("finds times, ranges and combinations", () => {
    expect(t("Simmer for 15 minutes, stirring.")).toEqual([["15 minutes", "15 min", 900]]);
    expect(t("Bake 6 to 8 minutes.")).toEqual([["6 to 8 minutes", "6–8 min", 360]]);
    expect(t("Roast for 1 hour 30 minutes")).toEqual([["1 hour 30 minutes", "1 hr 30 min", 5400]]);
    expect(t("Rest 1½ hours")).toEqual([["1½ hours", "1 hr 30 min", 5400]]);
    expect(t("Chill for an hour and a half")).toEqual([["an hour and a half", "1 hr 30 min", 5400]]);
    expect(t("Microwave 30 seconds, then 10m more")).toEqual([["30 seconds", "30 sec", 30], ["10m", "10 min", 600]]);
    expect(t("Cook 2-3 hrs")).toEqual([["2-3 hrs", "2–3 hr", 7200]]);
    expect(t("Add a minute or two of resting, about five minutes")).toEqual([["a minute", "1 min", 60], ["five minutes", "5 min", 300]]);
  });
  it("ignores things that aren't times", () => {
    expect(findTimers("Add 2 cups and stir. Serves 4 people. Mix a m s.")).toEqual([]);
    expect(findTimers("Stir in 3 tbsp butter")).toEqual([]);
  });
});

describe("which ingredients a step uses", () => {
  it("matches the ingredient's main word", () => {
    const step = "Stir in the beans and crushed tomatoes, then drizzle with oil.";
    expect(stepUses(step, ing(1, "can", "kidney beans"))).toBe(true);
    expect(stepUses(step, ing(1, "can", "San Marzano tomatoes"))).toBe(true);
    expect(stepUses(step, ing(2, "tbsp", "olive oil"))).toBe(true);
    expect(stepUses(step, ing(1, "lb", "ground beef"))).toBe(false);
    expect(stepUses(step, { raw: "Sauce:", section: "Sauce" })).toBe(false);
  });
});

describe("fresh herbs: the dried amount, worked out at this size and in these units", () => {
  const ing = (raw: string, quantity: number | null, unit: string | null, name: string, note: string | null = null) => ({ raw, quantity, quantityMax: null, unit, name, note });
  const basil = ing("1 tbsp fresh basil", 1, "tbsp", "fresh basil");

  it("spoons and cups: 3 fresh to 1 dried, scaled", () => {
    expect(driedEquivalent(basil, 1, "original")).toBe("1 tsp dried");
    expect(driedEquivalent(basil, 2, "original")).toBe("2 tsp dried");
    expect(driedEquivalent(ing("3 tbsp fresh parsley, chopped", 3, "tbsp", "fresh parsley", "chopped"), 1, "original")).toBe("1 tbsp dried");
    expect(driedEquivalent(ing("1/4 cup chopped cilantro", 0.25, "cup", "chopped cilantro"), 1, "original")).toBe("1⅓ tbsp dried");
    expect(driedEquivalent(ing("1 cup fresh basil leaves", 1, "cup", "fresh basil leaves"), 1, "original")).toBe("⅓ cup dried");
    expect(driedEquivalent(ing("2 tsp fresh thyme leaves", 2, "tsp", "fresh thyme leaves"), 1, "original")).toBe("⅔ tsp dried");
  });

  it("sprigs and bunches: an estimate", () => {
    const thyme = ing("3 sprigs fresh thyme", 3, "sprig", "fresh thyme");
    expect(driedEquivalent(thyme, 1, "original")).toBe("about ¾ tsp dried");
    expect(driedEquivalent(thyme, 2, "original")).toBe("about 1½ tsp dried");
    expect(driedEquivalent(ing("2 sprigs rosemary", 2, "sprig", "rosemary"), 1, "original")).toBe("about 1 tsp dried");
    expect(driedEquivalent(ing("1 bunch cilantro", 1, "bunch", "cilantro"), 1, "original")).toBe("about ⅓ cup dried");
  });

  it("in metric: millilitres for the bigger amounts; spoons stay spoons", () => {
    expect(driedEquivalent(ing("1 bunch cilantro", 1, "bunch", "cilantro"), 1, "metric")).toBe("about 80 ml dried");
    expect(driedEquivalent(basil, 1, "metric")).toBe("1 tsp dried");
    expect(driedEquivalent(ing("45 ml fresh dill", 45, "ml", "fresh dill"), 1, "original")).toBe("1 tbsp dried");
  });

  it("not for dried or ground herbs, other ingredients, or herbs without an amount", () => {
    for (const i of [
      ing("1 tsp dried oregano", 1, "tsp", "dried oregano"),
      ing("1 tsp ground sage", 1, "tsp", "ground sage"),
      ing("2 bay leaves", 2, null, "bay leaves"),
      ing("1 tbsp fresh ginger", 1, "tbsp", "fresh ginger"),
      ing("2 tbsp butter", 2, "tbsp", "butter"),
      ing("fresh basil, for serving", null, null, "fresh basil", "for serving"),
      ing("10 fresh basil leaves", 10, null, "fresh basil leaves"),
    ])
      expect([i.raw, driedEquivalent(i, 1, "original")]).toEqual([i.raw, null]);
  });

  it("the ingredient line carries it", () => {
    expect(ingredientLine(basil, 2, "original")).toMatchObject({ amount: "2 tbsp", name: "fresh basil", dried: "2 tsp dried" });
    expect(ingredientLine(ing("2 tbsp butter", 2, "tbsp", "butter"), 1, "original").dried).toBeNull();
  });
});

describe("metric: cups and spoons to grams (weights table first, then the AI's)", () => {
  const line = (q: number, unit: string, name: string, factor = 1, grams?: number | null) => ingredientLine(ing(q, unit, name), factor, "metric", grams);
  it("a dry ingredient the table knows: about how many grams, with the measure it was", () => {
    expect(line(2, "cup", "all-purpose flour")).toMatchObject({ amount: "≈240 g", was: "2 cups", estimate: "table" });
    expect(line(2, "tbsp", "brown sugar")).toMatchObject({ amount: "≈25 g", was: "2 tbsp" });
    expect(line(1, "cup", "butter, softened")).toMatchObject({ amount: "≈225 g", was: "1 cup" });
    expect(line(1, "cup", "granulated sugar", 2)).toMatchObject({ amount: "≈400 g", was: "2 cups" });
  });

  it("the right one when names overlap", () => {
    expect(line(1, "cup", "peanut butter").amount).toBe("≈260 g");
    expect(line(1, "cup", "powdered sugar").amount).toBe("≈120 g");
    expect(line(1, "cup", "almond flour").amount).toBe("≈95 g");
    expect(line(1, "cup", "sour cream").amount).toBe("≈230 g");
    expect(line(1, "cup", "milk chocolate chips").amount).toBe("≈170 g");
  });

  it("liquids stay in millilitres (and spoons of them stay spoons)", () => {
    expect(line(1, "cup", "whole milk")).toMatchObject({ amount: "240 ml", was: null });
    expect(line(2, "tbsp", "olive oil")).toMatchObject({ amount: "2 tbsp", was: null });
    expect(line(1, "cup", "buttermilk").amount).toBe("240 ml");
  });

  it("small amounts (under 5 g) stay in spoons: a scale can't read them", () => {
    expect(line(1, "tsp", "baking soda")).toMatchObject({ amount: "1 tsp", was: null });
    expect(line(0.5, "tsp", "salt")).toMatchObject({ amount: "½ tsp", was: null });
  });

  it("not in the table: the AI's weight for that line (from nutrition), scaled", () => {
    expect(line(2, "tbsp", "chili powder", 1, 16)).toMatchObject({ amount: "≈16 g", was: "2 tbsp", estimate: "ai" });
    expect(line(2, "tbsp", "chili powder", 2, 16)).toMatchObject({ amount: "≈30 g", was: "4 tbsp" });
    // nothing known: as before
    expect(line(2, "tbsp", "chili powder")).toMatchObject({ amount: "2 tbsp", was: null, estimate: null });
    expect(line(1, "cup", "mystery mix").amount).toBe("240 ml");
  });

  it("counted things never turn into grams", () => {
    expect(ingredientLine(ing(2, null, "eggs"), 1, "metric", 100)).toMatchObject({ amount: "2", was: null });
    expect(ingredientLine(ing(3, "clove", "garlic"), 1, "metric", 15)).toMatchObject({ was: null });
  });

  it("as is and US: unchanged", () => {
    expect(ingredientLine(ing(2, "cup", "all-purpose flour"), 1, "original")).toMatchObject({ amount: "2 cups", was: null });
    expect(ingredientLine(ing(2, "cup", "all-purpose flour"), 1, "us")).toMatchObject({ amount: "2 cups", was: null });
  });
});

describe("US: grams of a dry ingredient to cups and spoons", () => {
  it("the table knows it: about how many cups, with the weight it was", () => {
    expect(ingredientLine(ing(250, "g", "all-purpose flour"), 1, "us")).toMatchObject({ amount: "≈2 cups", was: "250 g", estimate: "table" });
    expect(ingredientLine(ing(25, "g", "sugar"), 1, "us")).toMatchObject({ amount: "≈2 tbsp", was: "25 g" });
  });
  it("not in the table: ounces, as before", () => {
    expect(ingredientLine(ing(250, "g", "ground beef"), 1, "us")).toMatchObject({ amount: "9 oz", was: null });
  });
});
