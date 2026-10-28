import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import db from "../database";
import type {
  PreferenceLinkClaims,
  PreferenceSelector,
} from "./preference-link";

function hash(handle: string) {
  return createHash("sha256").update(handle).digest();
}
export async function createPreferenceHandoff(
  claims: PreferenceLinkClaims,
): Promise<string> {
  const handle = randomBytes(32).toString("base64url");
  const s = claims.selector;
  await db.execute(sql`INSERT INTO notification_preference_handoff
    (handle_hash, audience, recipient_person_id, event_kind, channel, scope, scope_id, created_at, expires_at)
    SELECT ${hash(handle)}, ${claims.audience}, ${claims.recipientPersonId}, ${s.eventKind}, ${s.channel}, ${s.scope}, ${s.scopeId}, stamp, stamp + interval '10 minutes'
    FROM (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS stamp) clock
    WHERE EXISTS (SELECT 1 FROM person WHERE id = ${claims.recipientPersonId} AND active)`);
  return handle;
}
export async function readPreferenceHandoff(
  handle: string,
  audience: "agent" | "customer",
  personId: string,
): Promise<PreferenceSelector | null> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(handle)) return null;
  const result =
    await db.execute(sql`SELECT event_kind AS "eventKind", channel, scope, scope_id AS "scopeId"
    FROM notification_preference_handoff h JOIN person p ON p.id = h.recipient_person_id
    WHERE h.handle_hash = ${hash(handle)} AND h.audience = ${audience}
      AND h.recipient_person_id = ${personId} AND p.active
      AND h.expires_at > clock_timestamp() AT TIME ZONE 'UTC'`);
  return (result.rows[0] as PreferenceSelector | undefined) ?? null;
}

/** Expired selector handoffs are short-lived credentials, exempt from legal holds. */
export async function deleteExpiredPreferenceHandoffs(): Promise<number> {
  const result =
    await db.execute(sql`DELETE FROM notification_preference_handoff
    WHERE expires_at <= clock_timestamp() AT TIME ZONE 'UTC'`);
  return result.rowCount ?? 0;
}
