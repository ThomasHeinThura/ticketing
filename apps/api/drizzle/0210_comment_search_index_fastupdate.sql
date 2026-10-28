-- 0210_comment_search_index_fastupdate: P1R3-1 follow-up (SV-5). Hand-written and idempotent.
-- With fastupdate on, a bulk comment insert (for example an import) leaves entries in the GIN
-- pending list until autovacuum flushes it, and rare-term comment searches that go through the
-- trigram index slow down past the 100 ms budget meanwhile. Writing entries straight into the
-- index costs a little per comment write and keeps search latency steady.
ALTER INDEX IF EXISTS "comment_body_search_idx" SET (fastupdate = off);
