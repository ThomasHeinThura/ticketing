import { sql } from "drizzle-orm";
import type { DbTransaction } from "../events/outbox";
import { dbNowUtc } from "../utils/db-time";

/**
 * Query ownership for notification fan-out materialisation (issue #580). These statements
 * run inside the producing mutation's transaction, so each takes the handle first and is
 * moved verbatim from `fanout.ts`; the transaction boundary, ordering and conflict rules
 * stay with the caller.
 */

export type PreferenceRow = {
  scope: "global" | "workspace" | "project";
  enabled: boolean;
  digest: "off" | "hourly" | "daily";
};

/** Locks the person row (`FOR SHARE`) and returns its login and active flag. */
export async function lockRecipientPerson(
  tx: DbTransaction,
  personId: string,
): Promise<{ userId: string | null; active: boolean } | undefined> {
  const person = await tx.execute(sql`
      SELECT user_id AS "userId", active
        FROM person
       WHERE id = ${personId}
       FOR SHARE
    `);
  return person.rows[0] as
    | { userId: string | null; active: boolean }
    | undefined;
}

/** Idempotent per `(event_id, person_id)`. */
export async function insertEventInboxRow(
  tx: DbTransaction,
  row: {
    id: string;
    userId: string;
    personId: string;
    eventId: string;
    eventKind: string;
    title: string;
    body: string;
    resourceType: string;
    resourceId: string;
  },
): Promise<void> {
  await tx.execute(sql`
      INSERT INTO notification
        (id, user_id, person_id, event_id, kind, title, body, content,
         resource_type, resource_id, is_read, read_at, type)
      VALUES
        (${row.id}, ${row.userId}, ${row.personId}, ${row.eventId}, ${row.eventKind},
         ${row.title}, ${row.body}, ${row.body}, ${row.resourceType},
         ${row.resourceId}, false, NULL, 'info')
      ON CONFLICT (event_id, person_id) WHERE event_id IS NOT NULL DO NOTHING
    `);
}

/** Idempotent per `(event_id, recipient_person_id, channel)`; UTC wall-clock timestamps. */
export async function insertPendingDelivery(
  tx: DbTransaction,
  row: {
    id: string;
    eventId: string;
    recipientPersonId: string;
    channel: string;
    workspaceId: string;
    organisationId: string | null;
    dedupeKey: string;
    digestId: string | null;
  },
): Promise<void> {
  await tx.execute(sql`
        INSERT INTO notification_delivery
          (id, event_id, recipient_person_id, channel, workspace_id, organisation_id,
           dedupe_key, digest_id, state, attempts, next_attempt_at, created_at, updated_at)
        VALUES
          (${row.id}, ${row.eventId}, ${row.recipientPersonId}, ${row.channel},
           ${row.workspaceId}, ${row.organisationId},
           ${row.dedupeKey}, ${row.digestId}, 'pending', 0,
           ${dbNowUtc()}, ${dbNowUtc()}, ${dbNowUtc()})
        ON CONFLICT (event_id, recipient_person_id, channel) DO NOTHING
      `);
}

/** The most specific stored preference for a person, channel and event kind, if any. */
export async function findMostSpecificPreferenceRow(
  tx: DbTransaction,
  input: {
    personId: string;
    workspaceId: string;
    projectId: string | null;
    eventKind: string;
    channel: string;
  },
): Promise<PreferenceRow | undefined> {
  const result = await tx.execute(sql`
    SELECT scope, enabled, digest
      FROM notification_preference
     WHERE person_id = ${input.personId}
       AND channel = ${input.channel}
       AND event_kind = ${input.eventKind}
       AND (
         scope = 'global' OR
         (scope = 'workspace' AND scope_id = ${input.workspaceId}) OR
         (scope = 'project' AND ${input.projectId}::text IS NOT NULL AND scope_id = ${input.projectId})
       )
     ORDER BY CASE scope WHEN 'project' THEN 0 WHEN 'workspace' THEN 1 ELSE 2 END
     LIMIT 1
  `);
  return (result.rows as PreferenceRow[])[0];
}
