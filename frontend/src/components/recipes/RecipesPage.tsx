import { useEffect, useRef, useState } from "react";
import { recipeRoute, type RecipeRoute } from "../../recipes";
import RecipeList from "./RecipeList";
import RecipeView from "./RecipeView";
import RecipeEditor from "./RecipeEditor";
import CookMode from "./CookMode";
import ReviewImport from "./ReviewImport";
import BatchProgress from "./BatchProgress";
import ReceivePage from "./ReceivePage";

// #/recipes (the list), #/recipes/12 (a recipe), #/recipes/12/edit, #/recipes/new
export default function RecipesPage() {
  const [route, setRoute] = useState<RecipeRoute>(recipeRoute);
  useEffect(() => {
    const onHash = () => setRoute(recipeRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // A new page opens at its top; the list places itself (back from a recipe: where you left it)
  // (braces: scrollTo returns a promise in newer browsers, and an effect may only return a cleanup function)
  useEffect(() => {
    if (route.view !== "list") window.scrollTo(0, 0);
  }, [route.view, "id" in route ? route.id : "job" in route ? route.job : 0]);
  // Which page was showing before this one (set after each render)
  const before = useRef<RecipeRoute["view"] | null>(null);
  const cameBack = before.current === "recipe" || before.current === "edit" || before.current === "cook";
  useEffect(() => {
    before.current = route.view;
  });

  if (route.view === "away") return null;
  if (route.view === "recipe") return <RecipeView key={route.id} id={route.id} />;
  // (the edit screen is gone: an old edit link opens the recipe with its details ready to edit)
  if (route.view === "edit") return <RecipeView key={`edit-${route.id}`} id={route.id} startEditing />;
  if (route.view === "cook") return <CookMode key={`cook-${route.id}`} id={route.id} />;
  if (route.view === "new") return <RecipeEditor key="new" />;
  if (route.view === "review") return <ReviewImport key={`review-${route.job}`} job={route.job} />;
  if (route.view === "receive") return <ReceivePage key="receive" />;
  if (route.view === "improving") return <BatchProgress key={`improving-${route.job}`} job={route.job} />;
  return <RecipeList params={route.params} restore={cameBack} />;
}
