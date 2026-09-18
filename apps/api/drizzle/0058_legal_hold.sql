CREATE TABLE "legal_hold" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"placed_by" text NOT NULL,
	"placed_at" timestamp DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"lifted_by" text,
	"lifted_at" timestamp,
	CONSTRAINT "legal_hold_scope_check" CHECK ("legal_hold"."scope" in ('organisation', 'person'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "legal_hold_scope_scope_id_open_unique" ON "legal_hold" USING btree ("scope","scope_id") WHERE "legal_hold"."lifted_at" is null;