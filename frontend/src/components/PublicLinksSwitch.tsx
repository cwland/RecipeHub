import { FeatureSwitch } from "./FeatureSwitch";

// Settings › Recipes (owner): every recipe's public /share/ link
export function PublicLinksSwitch() {
  return (
    <FeatureSwitch
      feature="publicLinks"
      title="Public share links"
      text="Every recipe has its own read-only link (Share › Public link) that anyone can open without signing in. The links are long and random, so only people you send one to can find it. It only works for others if your RecipeHub can be reached from the internet."
      offText="Off: every share link says the recipe isn't shared. The links come back as they were when it's on again."
    >
      {null}
    </FeatureSwitch>
  );
}
