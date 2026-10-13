CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "work_item_title_trgm_idx" ON "work_item" USING gin ("title" gin_trgm_ops);