CREATE TABLE "aisle_choices" (
	"key" text PRIMARY KEY NOT NULL,
	"aisle" text NOT NULL,
	"by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
