CREATE TABLE "inbox_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"content" text,
	"source_app" text,
	"metadata" jsonb,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"sent_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "inbox_items_status_idx" ON "inbox_items" USING btree ("status","created_at");