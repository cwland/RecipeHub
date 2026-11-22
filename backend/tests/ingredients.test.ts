import { describe, expect, it } from "vitest";
import { formatQuantity, parseIngredient, parseIngredientLines, tidyIngredientLine } from "../src/lib/ingredients.js";

const p = (s: string) => {
  const { raw: _raw, ...rest } = parseIngredient(s);
  return rest;
};

describe("ingredient lines", () => {
  it("reads quantities, units, names and notes", () => {
    expect(p("1 1/2 cups flour, sifted")).toEqual({ quantity: 1.5, quantityMax: null, unit: "cup", name: "flour", note: "sifted" });
    expect(p("2-3 cloves garlic, minced")).toMatchObject({ quantity: 2, quantityMax: 3, unit: "clove", name: "garlic", note: "minced" });
    expect(p("½ tsp salt")).toMatchObject({ quantity: 0.5, unit: "tsp", name: "salt" });
    expect(p("1½ Tbsp olive oil")).toMatchObject({ quantity: 1.5, unit: "tbsp", name: "olive oil" });
    expect(p("2 T butter")).toMatchObject({ quantity: 2, unit: "tbsp", name: "butter" });
    expect(p("1 t vanilla")).toMatchObject({ quantity: 1, unit: "tsp", name: "vanilla" });
    expect(p("200g dark chocolate")).toMatchObject({ quantity: 200, unit: "g", name: "dark chocolate" });
    expect(p("1.5 lbs chicken thighs")).toMatchObject({ quantity: 1.5, unit: "lb", name: "chicken thighs" });
    expect(p("2 cups of milk")).toMatchObject({ quantity: 2, unit: "cup", name: "milk" });
    expect(p("8 fl oz cream")).toMatchObject({ quantity: 8, unit: "fl oz", name: "cream" });
    expect(p("1 to 2 tablespoons honey")).toMatchObject({ quantity: 1, quantityMax: 2, unit: "tbsp", name: "honey" });
  });

  it("keeps a can size and words in brackets as notes", () => {
    expect(p("1 (14 oz) can diced tomatoes")).toMatchObject({ quantity: 1, unit: "can", name: "diced tomatoes", note: "14 oz" });
    expect(p("1 cup butter (softened)")).toMatchObject({ quantity: 1, unit: "cup", name: "butter", note: "softened" });
  });

  it("no quantity, no unit: the name as written", () => {
    expect(p("Salt and pepper to taste")).toMatchObject({ quantity: null, unit: null, name: "Salt and pepper", note: "to taste" });
    expect(p("3 eggs")).toMatchObject({ quantity: 3, unit: null, name: "eggs" });
    expect(p("2 large onions, diced")).toMatchObject({ quantity: 2, unit: null, name: "large onions", note: "diced" });
    // a word that starts like a unit isn't one
    expect(p("2 carrots")).toMatchObject({ unit: null, name: "carrots" });
    expect(p("1 tomato")).toMatchObject({ unit: null, name: "tomato" });
  });

  it("headings and pasted bullets", () => {
    expect(parseIngredient("For the sauce:")).toEqual({ raw: "For the sauce:", section: "For the sauce" });
    expect(parseIngredient("## Topping")).toMatchObject({ section: "Topping" });
    expect(p("- 1 cup sugar")).toMatchObject({ quantity: 1, unit: "cup", name: "sugar" });
    expect(p("▢ 2 tsp cumin")).toMatchObject({ quantity: 2, unit: "tsp", name: "cumin" });
    expect(parseIngredientLines("1 cup rice\n\n  2 cups water  \n")).toHaveLength(2);
  });

  it("writes quantities back as kitchen fractions", () => {
    expect([1.5, 0.333, 2, 0.25, 2.667, 1.1, 0.999].map(formatQuantity)).toEqual(["1 1/2", "1/3", "2", "1/4", "2 2/3", "1.1", "1"]);
  });
});

describe("ingredient lines as recipe sites and cards write them", () => {
  it("a mixed number written with a hyphen is one amount, not a range", () => {
    expect(p("1-1/2 cups flour")).toMatchObject({ quantity: 1.5, quantityMax: null, unit: "cup", name: "flour" });
  });
  it("a space before the fraction character", () => {
    expect(p("2 ½ cups milk")).toMatchObject({ quantity: 2.5, unit: "cup", name: "milk" });
  });
  it("a unit with a period after it", () => {
    expect(p("1 tbsp. olive oil")).toMatchObject({ quantity: 1, unit: "tbsp", name: "olive oil" });
    expect(p("2 oz. cheddar")).toMatchObject({ quantity: 2, unit: "oz", name: "cheddar" });
  });
  it("a weight in brackets after the unit is a note", () => {
    expect(p("1 pound (450g) ground beef")).toMatchObject({ quantity: 1, unit: "lb", name: "ground beef", note: "450g" });
  });
  it("sticks and pinches are units", () => {
    expect(p("2 sticks butter")).toMatchObject({ quantity: 2, unit: "stick", name: "butter" });
    expect(p("1 pinch salt")).toMatchObject({ quantity: 1, unit: "pinch", name: "salt" });
  });
  it("a can size without brackets", () => {
    expect(p("1 15-oz can black beans, drained")).toMatchObject({ quantity: 1, unit: "can", name: "black beans", note: "15-oz; drained" });
  });
});

describe("amounts written as words", () => {
  const p = (line: string) => {
    const { quantity, quantityMax, unit, name, note } = parseIngredient(line);
    return { quantity, quantityMax, unit, name, note };
  };

  it("one, two… twelve", () => {
    expect(p("One pound of ground Italian sausage")).toEqual({ quantity: 1, quantityMax: null, unit: "lb", name: "ground Italian sausage", note: null });
    expect(p("One can of tomato sauce (14 ounces)")).toMatchObject({ quantity: 1, unit: "can", name: "tomato sauce", note: "14 ounces" });
    expect(p("One medium spaghetti squash, about 2 to 3 lbs")).toMatchObject({ quantity: 1, unit: null, name: "medium spaghetti squash", note: "about 2 to 3 lbs" });
    expect(p("three cloves garlic")).toMatchObject({ quantity: 3, unit: "clove", name: "garlic" });
    expect(p("Twelve eggs")).toMatchObject({ quantity: 12, name: "eggs" });
    expect(p("two to three tbsp honey")).toMatchObject({ quantity: 2, quantityMax: 3, unit: "tbsp", name: "honey" });
  });

  it("a or an before a unit or a size; half; one and a half", () => {
    expect(p("a pinch of salt")).toMatchObject({ quantity: 1, unit: "pinch", name: "salt" });
    expect(p("A large onion, diced")).toMatchObject({ quantity: 1, name: "large onion", note: "diced" });
    expect(p("half a cup of milk")).toMatchObject({ quantity: 0.5, unit: "cup", name: "milk" });
    expect(p("one and a half cups flour")).toMatchObject({ quantity: 1.5, unit: "cup", name: "flour" });
    expect(p("a dozen eggs")).toMatchObject({ quantity: 12, name: "eggs" });
  });

  it("words that only look like amounts are left alone", () => {
    expect(p("a little olive oil")).toMatchObject({ quantity: null, name: "a little olive oil" });
    expect(p("Onions, sliced")).toMatchObject({ quantity: null, name: "Onions" });
    expect(p("oneida corn")).toMatchObject({ quantity: null });
  });
});

describe("notes inside and after the name", () => {
  it("a comma inside brackets doesn't split the name", () => {
    expect(parseIngredient("6 tsp Italian seasoning (Oregano, Basil, Thyme) to taste")).toMatchObject({ quantity: 6, unit: "tsp", name: "Italian seasoning", note: "Oregano, Basil, Thyme; to taste" });
  });
  it("to taste, for garnish and optional are notes", () => {
    expect(parseIngredient("Fresh parsley for garnish (optional)")).toMatchObject({ name: "Fresh parsley", note: "optional; for garnish" });
    expect(parseIngredient("Salt to taste")).toMatchObject({ name: "Salt", note: "to taste" });
    expect(parseIngredient("6 tbsp hot pepper relish, optional")).toMatchObject({ name: "hot pepper relish", note: "optional" });
  });
});

describe("tidying a line's amount into numbers (imports and AI)", () => {
  it("number words become digits, and pound of becomes lb", () => {
    expect(tidyIngredientLine("One pound of ground Italian sausage")).toBe("1 lb ground Italian sausage");
    expect(tidyIngredientLine("One can of tomato sauce (14 ounces)")).toBe("1 can tomato sauce (14 ounces)");
    expect(tidyIngredientLine("One medium spaghetti squash, about 2 to 3 lbs")).toBe("1 medium spaghetti squash, about 2 to 3 lbs");
    expect(tidyIngredientLine("half a cup of milk")).toBe("1/2 cup milk");
    expect(tidyIngredientLine("one and a half cups flour")).toBe("1 1/2 cups flour");
    expect(tidyIngredientLine("Two tablespoons olive oil")).toBe("2 tablespoons olive oil");
  });
  it("lines already in numbers, headings and lines with no amount stay as they are", () => {
    for (const line of ["6 tbsp hot pepper relish, optional", "12–18 cloves garlic, whole", "Fresh parsley for garnish (optional)", "For the sauce:", "a little olive oil", "Salt to taste"]) expect(tidyIngredientLine(line)).toBe(line);
  });
});
