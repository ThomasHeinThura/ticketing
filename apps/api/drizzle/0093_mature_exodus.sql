DROP INDEX "membership_personId_scope_scopeId_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "membership_person_scope_scope_id_unique" ON "membership" USING btree ("person_id","scope","scope_id");