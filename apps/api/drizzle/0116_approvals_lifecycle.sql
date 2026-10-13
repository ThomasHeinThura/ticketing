ALTER TABLE "instance_setting"
  ADD COLUMN "approval_default_expiry_days" integer DEFAULT 7 NOT NULL;
--> statement-breakpoint
ALTER TABLE "team"
  ADD COLUMN "is_cab" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "approval" (
	"id" text PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"transition_id" text NOT NULL,
	"kind" text NOT NULL,
	"requested_by" text NOT NULL,
	"approver_id" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"reminder_50_sent_at" timestamp,
	"reminder_90_sent_at" timestamp,
	"decided_at" timestamp,
	"decision_note" text,
	CONSTRAINT "approval_kind_allowed" CHECK ("approval"."kind" in ('customer', 'cab')),
	CONSTRAINT "approval_state_allowed" CHECK ("approval"."state" in ('pending', 'approved', 'rejected', 'expired', 'withdrawn')),
	CONSTRAINT "approval_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "work_item"("id") ON DELETE cascade,
	CONSTRAINT "approval_transition_id_workflow_transition_id_fk" FOREIGN KEY ("transition_id") REFERENCES "workflow_transition"("id") ON DELETE restrict,
	CONSTRAINT "approval_requested_by_person_id_fk" FOREIGN KEY ("requested_by") REFERENCES "person"("id") ON DELETE restrict,
	CONSTRAINT "approval_approver_id_person_id_fk" FOREIGN KEY ("approver_id") REFERENCES "person"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX "approval_work_item_created_idx" ON "approval" USING btree ("work_item_id", "created_at");
--> statement-breakpoint
CREATE INDEX "approval_approver_state_expiry_idx" ON "approval" USING btree ("approver_id", "state", "expires_at");
--> statement-breakpoint
CREATE INDEX "approval_requester_state_idx" ON "approval" USING btree ("requested_by", "state");
--> statement-breakpoint
CREATE INDEX "approval_transition_state_idx" ON "approval" USING btree ("transition_id", "state");
