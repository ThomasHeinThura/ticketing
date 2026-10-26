CREATE TABLE "request_type_group_order" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"ordered_groups" text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_type_group_order_version_positive" CHECK ("request_type_group_order"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "request_type_group_order" ADD CONSTRAINT "request_type_group_order_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Preserve the existing first appearance of each group in position/id order.
-- No request type, publication snapshot or form is rewritten.
INSERT INTO "request_type_group_order" ("workspace_id", "ordered_groups")
SELECT "workspace_id", array_agg("group" ORDER BY "first_position", "first_id")
FROM (
  SELECT "workspace_id", "group", min("position") AS "first_position",
    (array_agg("id" ORDER BY "position", "id"))[1] AS "first_id"
  FROM "request_type"
  GROUP BY "workspace_id", "group"
) AS "existing_groups"
GROUP BY "workspace_id";
