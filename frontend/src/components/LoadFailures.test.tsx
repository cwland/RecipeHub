import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import OrganizeSettings from "./OrganizeSettings";
import RecipeList from "./recipes/RecipeList";
import RecipeEditor from "./recipes/RecipeEditor";
import { fakeServer } from "../test/fakeServer";

// When the server can't answer (restarting, a network blip), screens say so or carry on without
// the extras: a failed load is never left unhandled (that also stops the CI build)
const down = () => ({ status: 503, json: { error: "The server is restarting" } });
const settle = () => new Promise((r) => setTimeout(r, 100));

describe("loads that fail", () => {
  it("Settings › Recipes: a list that can't load says so", async () => {
    fakeServer({ "GET /api/organize/sort": down, "GET /api/categories": down, "GET /api/collections": down, "GET /api/tags": down, "GET /api/plan/settings": down });
    render(<OrganizeSettings />);
    expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent(/The server is restarting/);
    await settle();
  });

  it("the recipe list still lists recipes without its tags and categories", async () => {
    fakeServer({ "GET /api/tags": down, "GET /api/categories": down, "GET /api/collections": down, "GET /api/recipes": () => ({ total: 1, recipes: [{ id: 1, title: "Chili", imageUrl: null, totalMinutes: null, rating: null, favorite: false, pinned: false, tags: [], categories: [] }] }) });
    render(<RecipeList params={new URLSearchParams()} />);
    expect(await screen.findByRole("heading", { name: "Chili" })).toBeInTheDocument();
    await settle();
  });

  it("a new recipe can still be typed in without the category and tag lists", async () => {
    fakeServer({ "GET /api/tags": down, "GET /api/categories": down, "GET /api/collections": down });
    render(<RecipeEditor />);
    expect(await screen.findByLabelText("Source link")).toBeInTheDocument();
    await settle();
  });
});
