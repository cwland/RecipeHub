import { FeatureSwitch } from "./FeatureSwitch";

// Settings › Recipes (owner): Discover checks the household's feeds by itself
export function DiscoveryRefreshSwitch() {
  return (
    <FeatureSwitch
      feature="discoveryRefresh"
      title="Discover checks feeds"
      text="Discover checks the recipe sites you follow every few hours for new recipes, and keeps each post for 60 days."
      offText="Off: feeds are only checked when you press Refresh on the Discover page."
    >
      {null}
    </FeatureSwitch>
  );
}
