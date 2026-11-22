CREATE TABLE "recipe_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" integer NOT NULL,
	"number" integer NOT NULL,
	"source" text NOT NULL,
	"summary" text NOT NULL,
	"data" jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_versions_number" UNIQUE("recipe_id","number")
);
--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_versions_one_active" ON "recipe_versions" USING btree ("recipe_id") WHERE "recipe_versions"."active";--> statement-breakpoint
-- Every recipe saved before versions: v1 is the recipe as it is now. If it has an "Undo AI changes"
-- point, v1 is the recipe from before that AI change instead (only the parts the AI changed; an
-- older undo point that doesn't say puts back steps, ingredients and nutrition), and v2 below is now.
INSERT INTO "recipe_versions" ("recipe_id", "number", "source", "summary", "data", "created_by", "created_at", "active")
SELECT r."id", 1,
	CASE WHEN r."source_url" IS NOT NULL THEN 'import' ELSE 'created' END,
	CASE WHEN r."source_url" IS NOT NULL THEN 'Imported' ELSE 'Added' END,
	jsonb_build_object(
		'title', r."title",
		'description', r."description",
		'ingredients', CASE WHEN s."recipe_id" IS NOT NULL AND (s."data"->'applied' IS NULL OR s."data"->'applied' ? 'ingredients') THEN s."data"->'ingredients' ELSE r."ingredients" END,
		'steps', CASE WHEN s."recipe_id" IS NOT NULL AND (s."data"->'applied' IS NULL OR s."data"->'applied' ? 'steps') THEN s."data"->'steps' ELSE r."steps" END,
		'servings', r."servings",
		'yieldText', r."yield_text",
		'prepMinutes', r."prep_minutes",
		'cookMinutes', r."cook_minutes",
		'totalMinutes', r."total_minutes",
		'notes', r."notes",
		'nutrition', CASE WHEN s."recipe_id" IS NOT NULL AND (s."data"->'applied' IS NULL OR s."data"->'applied' ? 'nutrition') THEN s."data"->'nutrition' ELSE r."nutrition" END
	),
	r."created_by", r."created_at", s."recipe_id" IS NULL
FROM "recipes" r LEFT JOIN "recipe_snapshots" s ON s."recipe_id" = r."id";
--> statement-breakpoint
INSERT INTO "recipe_versions" ("recipe_id", "number", "source", "summary", "data", "created_by", "created_at", "active")
SELECT r."id", 2, 'ai', 'AI check',
	jsonb_build_object(
		'title', r."title",
		'description', r."description",
		'ingredients', r."ingredients",
		'steps', r."steps",
		'servings', r."servings",
		'yieldText', r."yield_text",
		'prepMinutes', r."prep_minutes",
		'cookMinutes', r."cook_minutes",
		'totalMinutes', r."total_minutes",
		'notes', r."notes",
		'nutrition', r."nutrition"
	),
	NULL, s."created_at", true
FROM "recipes" r JOIN "recipe_snapshots" s ON s."recipe_id" = r."id";
