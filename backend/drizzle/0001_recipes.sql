CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "collection_recipes" (
	"collection_id" integer NOT NULL,
	"recipe_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_recipes_collection_id_recipe_id_pk" PRIMARY KEY("collection_id","recipe_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "recipe_categories" (
	"recipe_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	CONSTRAINT "recipe_categories_recipe_id_category_id_pk" PRIMARY KEY("recipe_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "recipe_tags" (
	"recipe_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "recipe_tags_recipe_id_tag_id_pk" PRIMARY KEY("recipe_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "recipe_user" (
	"recipe_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"rating" integer,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_user_recipe_id_user_id_pk" PRIMARY KEY("recipe_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"ingredients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"servings" integer,
	"yield_text" text,
	"prep_minutes" integer,
	"cook_minutes" integer,
	"total_minutes" integer,
	"source_url" text,
	"source_name" text,
	"image_url" text,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_vector" "tsvector"
);
--> statement-breakpoint
CREATE TABLE "substitutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" integer NOT NULL,
	"user_id" integer,
	"original" text NOT NULL,
	"replacement" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "collection_recipes" ADD CONSTRAINT "collection_recipes_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_recipes" ADD CONSTRAINT "collection_recipes_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_categories" ADD CONSTRAINT "recipe_categories_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_categories" ADD CONSTRAINT "recipe_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_tags" ADD CONSTRAINT "recipe_tags_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_tags" ADD CONSTRAINT "recipe_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_user" ADD CONSTRAINT "recipe_user_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_user" ADD CONSTRAINT "recipe_user_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_recipes_recipe_idx" ON "collection_recipes" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_categories_category_idx" ON "recipe_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "recipe_tags_tag_idx" ON "recipe_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "recipe_user_user_idx" ON "recipe_user" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recipes_search_idx" ON "recipes" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "recipes_updated_idx" ON "recipes" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "substitutions_recipe_idx" ON "substitutions" USING btree ("recipe_id");--> statement-breakpoint
INSERT INTO "categories" ("name", "sort_order") VALUES ('Breakfast', 0), ('Lunch', 1), ('Dinner', 2), ('Side', 3), ('Snack', 4), ('Dessert', 5), ('Drink', 6);
