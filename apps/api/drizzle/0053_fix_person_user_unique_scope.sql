DROP INDEX "membership_personId_idx";--> statement-breakpoint
DROP INDEX "person_organisation_user_unique";--> statement-breakpoint
CREATE INDEX "membership_personId_scope_scopeId_idx" ON "membership" USING btree ("person_id","scope","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_user_unique" ON "person" USING btree ("user_id") WHERE "person"."user_id" is not null;