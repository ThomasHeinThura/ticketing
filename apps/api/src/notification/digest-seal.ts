import { sql } from "drizzle-orm";
import db from "../database";
import { dbNowUtc } from "../utils/db-time";

/** Groups sealed per sweep; the next hourly run takes the remainder. */
const SEAL_BATCH = 500;

/**
 * `notification-digest` (`background-jobs.md`): seals collecting groups whose stored UTC window
 * has ended, `collecting` to `pending`, freezing membership before any provider call. It never
 * calls a provider. The row lock is `FOR UPDATE`, which waits for writers holding the group
 * `FOR SHARE` (`digest-writer.ts`); a writer arriving afterwards sees the new state and joins
 * the next window. Returns the number of groups sealed.
 */
export async function sealDueDigestGroups(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE notification_digest
       SET state = 'pending', updated_at = ${dbNowUtc()}
     WHERE id IN (
       SELECT id FROM notification_digest
        WHERE state = 'collecting'
          AND window_end_at <= (clock_timestamp() AT TIME ZONE 'UTC')
        ORDER BY window_end_at, id
        LIMIT ${SEAL_BATCH}
        FOR UPDATE SKIP LOCKED
     )
  `);
  return result.rowCount ?? 0;
}
