-- Two active lists with the same name (allowed before 1.2.0) get " (2)", " (3)"… so the index can be made
UPDATE "grocery_lists" g SET "name" = g."name" || ' (' || d.rn || ')'
FROM (
  SELECT "id", row_number() OVER (PARTITION BY lower(btrim("name")) ORDER BY "id") AS rn
  FROM "grocery_lists" WHERE "archived_at" IS NULL
) d
WHERE g."id" = d."id" AND d.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "grocery_lists_active_name" ON "grocery_lists" USING btree (lower(btrim("name"))) WHERE "grocery_lists"."archived_at" is null;
