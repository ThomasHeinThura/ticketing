ALTER TABLE "invitation" ADD COLUMN "generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_generation_positive" CHECK (generation >= 1);