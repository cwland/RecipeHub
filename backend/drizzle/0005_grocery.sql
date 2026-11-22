CREATE TABLE "grocery_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_id" integer NOT NULL,
	"name" text NOT NULL,
	"quantity" real,
	"unit" text,
	"note" text,
	"aisle" text DEFAULT 'other' NOT NULL,
	"aisle_by" text DEFAULT 'words' NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"checked_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"added_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grocery_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pantry_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"quantity" real,
	"unit" text,
	"aisle" text DEFAULT 'other' NOT NULL,
	"staple" boolean DEFAULT false NOT NULL,
	"expires_on" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grocery_items" ADD CONSTRAINT "grocery_items_list_id_grocery_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."grocery_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_items" ADD CONSTRAINT "grocery_items_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grocery_items_list_idx" ON "grocery_items" USING btree ("list_id","checked");--> statement-breakpoint
INSERT INTO "grocery_lists" ("name", "sort_order") VALUES ('Groceries', 0);
