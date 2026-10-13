CREATE SEQUENCE "public"."submission_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "submission" ALTER COLUMN "number" SET DEFAULT nextval('submission_number_seq');--> statement-breakpoint
ALTER SEQUENCE "public"."submission_number_seq" OWNED BY "public"."submission"."number";--> statement-breakpoint
SELECT setval('submission_number_seq', GREATEST(COALESCE((SELECT MAX("number") FROM "submission"), 0) + 1, 1), false);
