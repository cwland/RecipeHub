CREATE TABLE "discovery_feeds" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"site_url" text,
	"icon_url" text,
	"last_fetched_at" timestamp with time zone,
	"last_error" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_feeds_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "discovery_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"feed_id" integer NOT NULL,
	"guid" text NOT NULL,
	"title" text NOT NULL,
	"link" text,
	"pub_date" timestamp with time zone,
	"author" text,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"content_html" text,
	"thumbnail_url" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_items_feed_guid" UNIQUE("feed_id","guid")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "discovery_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "discovery_feeds" ADD CONSTRAINT "discovery_feeds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_items" ADD CONSTRAINT "discovery_items_feed_id_discovery_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."discovery_feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_items_sort_idx" ON "discovery_items" USING btree ("pub_date","id");