import { FeatureSwitch } from "./FeatureSwitch";

// Settings › Recipes (owner): keep a version history of every recipe
export function RecipeVersionSwitch() {
  return (
    <FeatureSwitch
      feature="recipeVersions"
      title="Recipe versioning"
      text="Keep every version of each recipe. An import or a new recipe is v1; an AI check that changes steps or ingredients makes a new version; when you edit a recipe, you choose to save to the current version or as a new one. Any version can be set active again from the recipe's Version history tab."
      offText="Off: edits save over the recipe without asking and no new versions are made. The versions you have are kept for when it's back on."
    >
      {null}
    </FeatureSwitch>
  );
}
