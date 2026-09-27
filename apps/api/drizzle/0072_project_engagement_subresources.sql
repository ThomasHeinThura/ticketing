CREATE TABLE "document_link" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"customer_visible" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestone" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"date" timestamp NOT NULL,
	"reached_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prerequisite" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"owner_side" text NOT NULL,
	"due_date" timestamp,
	"is_blocking" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prerequisite_owner_side_allowed" CHECK ("prerequisite"."owner_side" in ('us', 'customer', 'both'))
);
--> statement-breakpoint
CREATE TABLE "stakeholder" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"person_id" text NOT NULL,
	"role" text NOT NULL,
	"escalation_order" integer NOT NULL,
	"escalation_wait_minutes" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "prerequisite" ADD CONSTRAINT "prerequisite_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "stakeholder" ADD CONSTRAINT "stakeholder_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "stakeholder" ADD CONSTRAINT "stakeholder_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "document_link_projectId_idx" ON "document_link" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "milestone_projectId_idx" ON "milestone" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "prerequisite_projectId_idx" ON "prerequisite" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "stakeholder_projectId_idx" ON "stakeholder" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "stakeholder_personId_idx" ON "stakeholder" USING btree ("person_id");