ALTER TABLE "membership_grant" DROP CONSTRAINT "membership_grant_granted_by_person_id_person_id_fk";
--> statement-breakpoint
ALTER TABLE "membership_grant" ADD CONSTRAINT "membership_grant_granted_by_person_id_person_id_fk" FOREIGN KEY ("granted_by_person_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "scim_connection" ADD CONSTRAINT "scim_connection_enabled_token_check" CHECK (not "scim_connection"."enabled" or "scim_connection"."token_hash" is not null);