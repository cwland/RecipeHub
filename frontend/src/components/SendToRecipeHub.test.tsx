import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SendToRecipeHub } from "./SendToRecipeHub";

describe("Send to RecipeHub (Settings › Recipes)", () => {
  it("a bookmark to drag to the bookmarks bar, for this RecipeHub, and how to use it", () => {
    render(<SendToRecipeHub />);
    const card = screen.getByRole("region", { name: "Send to RecipeHub" });
    const link = within(card).getByRole("link", { name: "Send to RecipeHub" });
    expect(link.getAttribute("href")).toMatch(/^javascript:/);
    expect(decodeURIComponent(link.getAttribute("href")!)).toContain(`var C="${window.location.origin}"`);
    expect(card).toHaveTextContent("Drag");
    expect(card).toHaveTextContent("security check");
    expect(within(card).getByRole("button", { name: "Copy the bookmark" })).toBeInTheDocument();
  });
});
