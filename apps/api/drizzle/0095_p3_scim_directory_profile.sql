CREATE TABLE "scim_group_directory_member" (
	"id" text PRIMARY KEY NOT NULL,
	"scim_connection_id" text NOT NULL,
	"scim_group_id" text NOT NULL,
	"external_identity_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "scim_group_directory_member_active_timestamp_shape" CHECK (("scim_group_directory_member"."active" and "scim_group_directory_member"."removed_at" is null) or (not "scim_group_directory_member"."active" and "scim_group_directory_member"."removed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "scim_group" (
	"id" text PRIMARY KEY NOT NULL,
	"scim_connection_id" text NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "scim_group_connection_id_unique" UNIQUE("scim_connection_id","id"),
	CONSTRAINT "scim_group_connection_external_id_unique" UNIQUE("scim_connection_id","external_id"),
	CONSTRAINT "scim_group_active_timestamp_shape" CHECK (("scim_group"."active" and "scim_group"."deactivated_at" is null) or (not "scim_group"."active" and "scim_group"."deactivated_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "scim_group_directory_member" ADD CONSTRAINT "scim_group_directory_member_scim_connection_id_scim_connection_identity_connection_id_fk" FOREIGN KEY ("scim_connection_id") REFERENCES "public"."scim_connection"("identity_connection_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "scim_group_directory_member" ADD CONSTRAINT "scim_group_directory_member_group_same_connection_fk" FOREIGN KEY ("scim_connection_id","scim_group_id") REFERENCES "public"."scim_group"("scim_connection_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "external_identity_connection_id_unique" ON "external_identity" USING btree ("identity_connection_id","id");--> statement-breakpoint
ALTER TABLE "scim_group_directory_member" ADD CONSTRAINT "scim_group_directory_member_identity_same_connection_fk" FOREIGN KEY ("scim_connection_id","external_identity_id") REFERENCES "public"."external_identity"("identity_connection_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "scim_group" ADD CONSTRAINT "scim_group_scim_connection_id_scim_connection_identity_connection_id_fk" FOREIGN KEY ("scim_connection_id") REFERENCES "public"."scim_connection"("identity_connection_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "scim_group_directory_member_active_unique" ON "scim_group_directory_member" USING btree ("scim_group_id","external_identity_id") WHERE "scim_group_directory_member"."active" is true;--> statement-breakpoint
CREATE INDEX "scim_group_directory_member_connection_group_idx" ON "scim_group_directory_member" USING btree ("scim_connection_id","scim_group_id","active");--> statement-breakpoint
CREATE INDEX "scim_group_connection_active_idx" ON "scim_group" USING btree ("scim_connection_id","active");--> statement-breakpoint
