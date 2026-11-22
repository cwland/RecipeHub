CREATE TABLE "recipe_snapshots" (
	"recipe_id" integer NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_snapshots_recipe_id_unique" UNIQUE("recipe_id")
);
--> statement-breakpoint
ALTER TABLE "recipe_snapshots" ADD CONSTRAINT "recipe_snapshots_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;