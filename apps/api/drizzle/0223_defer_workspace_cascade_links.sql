-- These links still forbid dangling references at commit. Deferring their checks lets
-- a workspace cascade remove both parents and children regardless of FK trigger order.
ALTER TABLE "time_entry" ALTER CONSTRAINT "time_entry_workspace_activity_fk" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "running_timer" ALTER CONSTRAINT "running_timer_workspace_activity_fk" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "work_item" ALTER CONSTRAINT "work_item_workspace_service_fk" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "work_item" ALTER CONSTRAINT "work_item_project_cycle_fk" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "work_item" ALTER CONSTRAINT "work_item_project_module_fk" DEFERRABLE INITIALLY DEFERRED;
