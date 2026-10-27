-- 0205_p1_review_fixes: P1 round-2 review fixes. Hand-written and idempotent.
-- P1R2-8 (SV-2/SV-5): work-item search matches live comment text. The comment branch of
-- search/canonical-repository.ts filters `lower(<comment body text>) LIKE '%term%'`; this
-- trigram GIN expression index (pg_trgm is created by 0103) keeps that branch off a sequential
-- scan of every comment. The expression and the predicate must stay identical to the query.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_body_search_idx" ON "comment" USING gin (lower(coalesce(case when jsonb_typeof("body") = 'string' then "body" #>> '{}' else jsonb_path_query_array("body", 'lax $.**.text')::text end, '')) gin_trgm_ops) WHERE "deleted_at" IS NULL AND "body" IS NOT NULL;
