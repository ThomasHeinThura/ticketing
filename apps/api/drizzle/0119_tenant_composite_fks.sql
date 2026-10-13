-- 0119 tenant-composite foreign keys (M1 security review forward item N2).
-- Parent keys first: a composite FK needs a UNIQUE on the referenced (workspace_id, id).
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_id_workspace_id_unique" UNIQUE("event_id","workspace_id");--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_workspace_id_id_unique" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "notification_delivery" DROP CONSTRAINT "notification_delivery_event_id_outbox_event_id_fk";
--> statement-breakpoint
ALTER TABLE "saved_view" DROP CONSTRAINT "saved_view_shared_with_team_id_team_id_fk";
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_workspace_event_fk" FOREIGN KEY ("event_id","workspace_id") REFERENCES "public"."outbox"("event_id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_workspace_shared_team_fk" FOREIGN KEY ("workspace_id","shared_with_team_id") REFERENCES "public"."team"("workspace_id","id") ON DELETE no action ON UPDATE no action;
