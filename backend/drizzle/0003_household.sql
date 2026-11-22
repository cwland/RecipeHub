ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
-- Whoever set the server up so far is its owner
UPDATE "users" SET "role" = 'owner';
