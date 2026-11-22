CREATE TABLE "meal_plan" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"slot" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"recipe_id" integer,
	"title" text NOT NULL,
	"servings" integer,
	"note" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meal_plan" ADD CONSTRAINT "meal_plan_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan" ADD CONSTRAINT "meal_plan_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_plan_date_idx" ON "meal_plan" USING btree ("date","slot","position");--> statement-breakpoint
CREATE INDEX "meal_plan_recipe_idx" ON "meal_plan" USING btree ("recipe_id");