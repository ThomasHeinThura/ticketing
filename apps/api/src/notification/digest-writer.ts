import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import type { DbTransaction, DomainEventEnvelope } from "../events/outbox";
import { dbNowUtc } from "../utils/db-time";
import {
  type DigestCadence,
  type DigestWindow,
  digestWindowContaining,
  isKnownTimezone,
  nextDigestWindow,
} from "./digest-window";
import { findInstanceTimezone } from "./repository";

/** Windows to try before giving up: the current one, then at most three successors. */
const MAX_WINDOW_ATTEMPTS = 4;

async function databaseClockEpochMs(tx: DbTransaction): Promise<number> {
  const result = await tx.execute(
    sql`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS ms`,
  );
  return Number((result.rows[0] as { ms: number | string }).ms);
}

/** `person.quiet_hours_timezone`, else the instance zone, else UTC. */
export async function resolveDigestTimezone(
  tx: DbTransaction,
  personId: string,
): Promise<string> {
  const result = await tx.execute(
    sql`SELECT quiet_hours_timezone AS tz FROM person WHERE id = ${personId}`,
  );
  const personZone = (result.rows[0] as { tz: string | null } | undefined)?.tz;
  if (personZone && isKnownTimezone(personZone)) return personZone;
  const instanceZone = await findInstanceTimezone(tx);
  return isKnownTimezone(instanceZone) ? instanceZone : "UTC";
}

/** Boundaries are passed as `timestamptz` text and stored as UTC wall clocks. */
const utcWall = (at: Date) =>
  sql`(${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

async function lockOpenGroup(
  tx: DbTransaction,
  input: {
    recipientPersonId: string;
    channel: string;
    workspaceId: string;
    organisationId: string | null;
    cadence: DigestCadence;
    timezone: string;
    window: DigestWindow;
  },
): Promise<string | null> {
  await tx.execute(sql`
    INSERT INTO notification_digest
      (id, recipient_person_id, channel, workspace_id, organisation_id, cadence, timezone,
       window_start_at, window_end_at, state, attempts, next_attempt_at, created_at, updated_at)
    VALUES
      (${createId()}, ${input.recipientPersonId}, ${input.channel}, ${input.workspaceId},
       ${input.organisationId}, ${input.cadence}, ${input.timezone},
       ${utcWall(input.window.startAt)}, ${utcWall(input.window.endAt)}, 'collecting', 0,
       ${utcWall(input.window.endAt)}, ${dbNowUtc()}, ${dbNowUtc()})
    ON CONFLICT ON CONSTRAINT notification_digest_partition_unique DO NOTHING
  `);
  // FOR SHARE: any number of writers may join a group, but sealing (FOR UPDATE) waits for
  // them and a writer that arrives after the seal sees the new state and moves on.
  const result = await tx.execute(sql`
    SELECT id, state,
           window_end_at > (clock_timestamp() AT TIME ZONE 'UTC') AS open
      FROM notification_digest
     WHERE recipient_person_id = ${input.recipientPersonId}
       AND channel = ${input.channel}
       AND workspace_id = ${input.workspaceId}
       AND organisation_id IS NOT DISTINCT FROM ${input.organisationId}
       AND cadence = ${input.cadence}
       AND window_start_at = ${utcWall(input.window.startAt)}
       AND window_end_at = ${utcWall(input.window.endAt)}
     FOR SHARE
  `);
  const row = result.rows[0] as
    | { id: string; state: string; open: boolean }
    | undefined;
  return row && row.state === "collecting" && row.open ? row.id : null;
}

/**
 * `NO-5`: the canonical digest-window writer. Allocates (or joins) the collecting group for
 * the recipient, channel, workspace, optional organisation, cadence and exact window that
 * contain the event-time database clock, inside the producing mutation's transaction. The zone
 * is resolved once and stored with the group. If the window ended, or the group was sealed
 * while this writer waited, the child joins the next eligible window.
 */
export async function attachDigestWindow(input: {
  tx: DbTransaction;
  event: DomainEventEnvelope<Record<string, unknown>>;
  recipientPersonId: string;
  channel: string;
  cadence: DigestCadence;
}): Promise<{ id: string }> {
  const { tx, event } = input;
  const workspaceId = event.scope.workspaceId;
  if (!workspaceId)
    throw new Error("A digest candidate requires a workspace-scoped event");
  const organisationId =
    "organisationId" in event.scope
      ? (event.scope.organisationId ?? null)
      : null;
  const timezone = await resolveDigestTimezone(tx, input.recipientPersonId);
  let window = digestWindowContaining(
    new Date(await databaseClockEpochMs(tx)),
    timezone,
    input.cadence,
  );
  for (let attempt = 0; attempt < MAX_WINDOW_ATTEMPTS; attempt += 1) {
    const id = await lockOpenGroup(tx, {
      recipientPersonId: input.recipientPersonId,
      channel: input.channel,
      workspaceId,
      organisationId,
      cadence: input.cadence,
      timezone,
      window,
    });
    if (id) return { id };
    window = nextDigestWindow(window, input.cadence);
  }
  throw new Error("No open digest window could be allocated");
}
