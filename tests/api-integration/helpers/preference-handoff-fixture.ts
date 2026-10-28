import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import db from "../../../apps/api/src/database";

/** Synthetic selector with the exact ten-minute lifetime and database UTC clock. */
export async function plantPreferenceHandoff(
  personId: string,
  expiresInMinutes: number,
): Promise<Buffer> {
  const hash = randomBytes(32);
  await db.execute(sql`INSERT INTO notification_preference_handoff
    (handle_hash, audience, recipient_person_id, event_kind, channel, scope, scope_id, created_at, expires_at)
    SELECT ${hash}, 'agent', ${personId}, 'work_item.mentioned', 'notify.email', 'global', NULL,
      expires - interval '10 minutes', expires
    FROM (SELECT (clock_timestamp() AT TIME ZONE 'UTC') + (${expiresInMinutes} * interval '1 minute') AS expires) clock`);
  return hash;
}
export async function preferenceHandoffExists(hash: Buffer): Promise<boolean> {
  return (
    (
      await db.execute(
        sql`SELECT 1 FROM notification_preference_handoff WHERE handle_hash = ${hash}`,
      )
    ).rows.length > 0
  );
}
