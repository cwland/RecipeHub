ALTER TABLE "substitutions" ALTER COLUMN "original" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "substitutions" ADD COLUMN "kind" text DEFAULT 'swap' NOT NULL;--> statement-breakpoint
ALTER TABLE "substitutions" ADD COLUMN "line" text;--> statement-breakpoint
ALTER TABLE "substitutions" ADD COLUMN "amount" text;--> statement-breakpoint
ALTER TABLE "substitutions" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "substitutions" ADD COLUMN "item" text;--> statement-breakpoint
ALTER TABLE "substitutions" ADD COLUMN "applied_version" integer;--> statement-breakpoint
ALTER TABLE "substitutions" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ingredient_order" text DEFAULT 'entered' NOT NULL;