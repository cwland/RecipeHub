import { beforeEach, describe, expect, it } from "vitest";
import { gridClass, loadDiscoverAcross, loadView, saveDiscoverAcross, saveView } from "./recipeView";

describe("recipe list view setting", () => {
  beforeEach(() => localStorage.clear());

  it("starts as cards, 4 across", () => {
    expect(loadView()).toEqual({ mode: "cards", across: 4 });
  });

  it("remembers what was picked", () => {
    saveView({ mode: "list", across: 6 });
    expect(loadView()).toEqual({ mode: "list", across: 6 });
  });

  it("ignores broken or out-of-range saved values", () => {
    localStorage.setItem("recipehub-recipe-view", "{not json");
    expect(loadView()).toEqual({ mode: "cards", across: 4 });
    localStorage.setItem("recipehub-recipe-view", JSON.stringify({ mode: "huh", across: 40 }));
    expect(loadView()).toEqual({ mode: "cards", across: 8 });
    localStorage.setItem("recipehub-recipe-view", JSON.stringify({ mode: "list", across: 1 }));
    expect(loadView()).toEqual({ mode: "list", across: 2 });
  });

  it("phones keep 2 across; the picked number shows on wider screens", () => {
    expect(gridClass(2)).toBe("grid-cols-2");
    expect(gridClass(4)).toContain("md:grid-cols-4");
    expect(gridClass(4).split(" ")[0]).toBe("grid-cols-2");
    expect(gridClass(6)).toContain("xl:grid-cols-6");
    expect(gridClass(6)).not.toMatch(/(^| )grid-cols-6/);
  });

  it("big screens can go up to 8 across, and smaller screens still cap lower", () => {
    expect(gridClass(7)).toContain("2xl:grid-cols-7");
    expect(gridClass(8)).toContain("2xl:grid-cols-8");
    expect(gridClass(8)).toContain("xl:grid-cols-6");
    expect(gridClass(8)).not.toMatch(/(^| )(sm:|md:|lg:|xl:)?grid-cols-8/);
  });
});

describe("Discover's tiles across", () => {
  beforeEach(() => localStorage.clear());

  it("starts at 4, remembers what was picked, apart from the recipe list", () => {
    expect(loadDiscoverAcross()).toBe(4);
    saveDiscoverAcross(6);
    expect(loadDiscoverAcross()).toBe(6);
    expect(loadView().across).toBe(4);
    saveView({ mode: "cards", across: 2 });
    expect(loadDiscoverAcross()).toBe(6);
  });

  it("ignores broken or out-of-range saved values", () => {
    localStorage.setItem("recipehub-discover-across", "{not json");
    expect(loadDiscoverAcross()).toBe(4);
    localStorage.setItem("recipehub-discover-across", "40");
    expect(loadDiscoverAcross()).toBe(8);
    localStorage.setItem("recipehub-discover-across", "1");
    expect(loadDiscoverAcross()).toBe(2);
  });
});
