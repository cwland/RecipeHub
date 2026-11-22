-- Culury became RecipeHub and the version restarted at 1.0.0: forget the What's new version
-- each person dismissed under the old numbering, so RecipeHub's notes show.
UPDATE "users" SET "seen_version" = NULL;
