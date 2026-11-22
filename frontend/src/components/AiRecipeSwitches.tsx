import { FeatureSwitch } from "./FeatureSwitch";

// Settings › Recipes: the two AI features for recipes. They need AI: off and unchangeable without it.
// They come on by themselves the first time AI is set up.
export function AiEnhanceSwitch() {
  return (
    <FeatureSwitch
      feature="aiEnhance"
      needsAi
      title="AI Enhance"
      text="After a recipe is added, offer to check it with AI: fill gaps in the steps, catch ingredient mistakes, estimate nutrition and suggest categories and tags. You see the changes side by side and choose what to keep."
      offText="Off: recipes aren't offered an AI check, and the Improve with AI button is hidden."
    >
      {null}
    </FeatureSwitch>
  );
}

export function AutoNutritionSwitch() {
  return (
    <FeatureSwitch
      feature="autoNutrition"
      needsAi
      title="Auto nutrition"
      text="Work out nutrition by itself: for a new recipe once its AI check is done or skipped, and again whenever its ingredients change. Numbers you typed in are never replaced; the recipe says when they're out of date."
      offText="Off: nutrition is only worked out when you press Calculate nutrition. Recipes still say when their nutrition may be out of date."
    >
      {null}
    </FeatureSwitch>
  );
}
