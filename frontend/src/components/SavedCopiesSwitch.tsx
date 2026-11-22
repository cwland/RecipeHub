import { FeatureSwitch } from "./FeatureSwitch";

// Settings › Recipes (owner): when a site keeps a recipe from an import, look for a saved copy
export function SavedCopiesSwitch() {
  return (
    <FeatureSwitch
      feature="savedCopies"
      title="Saved copies"
      text="When a site blocks an import (a security check, a paywall, or it turns RecipeHub away), look for a saved copy of the page on the Wayback Machine, then archive.ph. The recipe keeps its own link, and the import says it came from a saved copy."
      offText="Off: a blocked import just says why. You can still paste the recipe or add it from a photo."
    >
      {null}
    </FeatureSwitch>
  );
}
