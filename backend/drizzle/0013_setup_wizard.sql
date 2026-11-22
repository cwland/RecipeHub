ALTER TABLE "users" ADD COLUMN "units" text DEFAULT 'original' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "setup_done_at" timestamp with time zone;--> statement-breakpoint
-- Accounts from before the setup wizard have been set up already
UPDATE "users" SET "setup_done_at" = now();
