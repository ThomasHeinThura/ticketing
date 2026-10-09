import { sql } from "drizzle-orm";
import db from "../../../apps/api/src/database";

/** Install the unjournaled candidate migration in the disposable integration DB. */
export async function installProvisionalSlaPause() {
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS "sla_pause" (
      "id" text PRIMARY KEY NOT NULL,
      "work_item_id" text NOT NULL REFERENCES "work_item"("id") ON DELETE CASCADE,
      "metric" text NOT NULL CHECK ("metric" IN ('first_response', 'resolution')),
      "started_at" timestamp with time zone NOT NULL,
      "ended_at" timestamp with time zone,
      "reason" text NOT NULL,
      CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at")
    )`),
  );
  await db.execute(
    sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS "sla_pause_one_open_per_metric_unique"
      ON "sla_pause" ("work_item_id", "metric") WHERE "ended_at" IS NULL`),
  );
  await db.execute(
    sql.raw(`CREATE INDEX IF NOT EXISTS "sla_pause_work_item_metric_started_idx"
      ON "sla_pause" ("work_item_id", "metric", "started_at")`),
  );
}
