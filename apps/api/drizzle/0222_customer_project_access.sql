ALTER TABLE "invitation" ADD COLUMN "validated_project_ids" jsonb;--> statement-breakpoint
CREATE TABLE "customer_invitation_project" (
	"invitation_id" text NOT NULL,
	"project_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_invitation_project_pkey" PRIMARY KEY("invitation_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "customer_project_access" (
	"person_id" text NOT NULL,
	"project_id" text NOT NULL,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_project_access_pkey" PRIMARY KEY("person_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "customer_invitation_project" ADD CONSTRAINT "customer_invitation_project_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customer_invitation_project" ADD CONSTRAINT "customer_invitation_project_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customer_project_access" ADD CONSTRAINT "customer_project_access_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customer_project_access" ADD CONSTRAINT "customer_project_access_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customer_project_access" ADD CONSTRAINT "customer_project_access_granted_by_person_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "customer_invitation_project_project_idx" ON "customer_invitation_project" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "customer_project_access_project_idx" ON "customer_project_access" USING btree ("project_id");