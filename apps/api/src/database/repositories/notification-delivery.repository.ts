import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DbTransaction } from "../../events/outbox";
import {
  NOTIFICATION_ATTEMPT_LIMIT,
  notificationReservationKey,
  notificationRetryDelayMs,
} from "../../notification/delivery-primitives";
import db from "../index";

type Executor = typeof db | DbTransaction;

export type ClaimedNotificationDelivery = {
  id: string;
  eventId: string;
  recipientPersonId: string;
  channel: string;
  workspaceId: string;
  organisationId: string | null;
  dedupeKey: string;
  attempts: number;
  eventKind: string;
  payload: unknown;
  title: string | null;
  body: string | null;
  resourceType: string | null;
  resourceId: string | null;
};

export type ReservationToken = {
  key: Buffer;
  leaseToken: string;
  leaseExpiresAt: Date;
  ownerDeliveryId: string;
};

export type ReservationClaim =
  | { status: "acquired"; reservation: ReservationToken }
  | { status: "deferred"; leaseExpiresAt: Date }
  | { status: "not_pending" }
  | { status: "digest_collision" };

/** A cleanup/acquire race could not be resolved within the bounded DB retry budget. */
export class NotificationReservationContentionError extends Error {
  readonly retryable = true;

  constructor() {
    super(
      "Notification reservation row remained unavailable during acquisition",
    );
    this.name = "NotificationReservationContentionError";
  }
}

// This is a bounded row-acquisition retry budget, independent of the six provider-attempt
// limit. It never authorizes a provider call or increments notification_delivery.attempts.
const MAX_RESERVATION_ACQUIRE_RETRIES = 6;

function rows<T>(result: { rows: unknown[] }): T[] {
  return result.rows as T[];
}

function utcDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const hasZone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value);
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(hasZone ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Bind a JS instant into a `timestamp without time zone` column in this schema's one
 * convention, UTC wall clock (see `utils/db-time.ts`). A bare `Date` parameter is serialised
 * by node-postgres in the PROCESS time zone with an offset, and PostgreSQL drops the offset
 * when casting to `timestamp`, so a lease or back-off would be shifted by the process offset.
 * An ISO string is always UTC and a `timestamp` cast of it ignores the trailing `Z`.
 */
function utc(value: Date | string | null | undefined) {
  const date = utcDate(value);
  if (!date) throw new Error("Notification timestamp was unavailable");
  return sql`${date.toISOString()}::timestamp`;
}

/**
 * A peek, not a claim: the `FOR UPDATE SKIP LOCKED` row lock is released when the calling
 * transaction commits, so two workers can read the same row. Correctness never depends on
 * this lock; the fence is `acquireNotificationReservation` (delivery row lock, `pending`
 * check, then the owner/token reservation lease) and every later write re-checks it.
 */
export async function claimNextNotificationDelivery(
  executor: Executor = db,
): Promise<ClaimedNotificationDelivery | null> {
  const result = await executor.execute(sql`
    SELECT d.id,
           d.event_id AS "eventId",
           d.recipient_person_id AS "recipientPersonId",
           d.channel,
           d.workspace_id AS "workspaceId",
           d.organisation_id AS "organisationId",
           d.dedupe_key AS "dedupeKey",
           d.attempts,
           o.kind AS "eventKind",
           o.payload,
           n.title,
           n.body,
           n.resource_type AS "resourceType",
           n.resource_id AS "resourceId"
      FROM notification_delivery d
      JOIN outbox o ON o.event_id = d.event_id
      JOIN notification n ON n.event_id = d.event_id
                        AND n.person_id = d.recipient_person_id
     WHERE d.state = 'pending'
       AND d.digest_id IS NULL
       AND d.next_attempt_at <= clock_timestamp() AT TIME ZONE 'UTC'
     ORDER BY d.next_attempt_at, d.created_at, d.id
     LIMIT 1
     FOR UPDATE OF d SKIP LOCKED
  `);
  return rows<ClaimedNotificationDelivery>(result)[0] ?? null;
}

/**
 * Acquire after `INSERT .. DO NOTHING` has completed, then lock and take a fresh
 * PostgreSQL wall-clock sample. This separate lock/sample sequence handles a
 * uniqueness wait and is deliberately not based on transaction-start `now()`.
 */
export async function acquireNotificationReservation(
  tx: DbTransaction,
  input: {
    recipientPersonId: string;
    channel: string;
    dedupeKey: string;
    ownerDeliveryId: string;
  },
): Promise<ReservationClaim> {
  const key = notificationReservationKey(input);
  // Use the delivery row as the common serialization point for reservation acquisition
  // and every state/scheduling write. A second drain may have claimed this same row after
  // the first claim transaction committed; it must not start a reservation after another
  // worker has terminalized or deferred it.
  const delivery = await tx.execute(sql`
    SELECT state FROM notification_delivery WHERE id = ${input.ownerDeliveryId} FOR UPDATE
  `);
  if (rows<{ state: string }>(delivery)[0]?.state !== "pending")
    return { status: "not_pending" };
  for (
    let acquisitionAttempt = 0;
    acquisitionAttempt < MAX_RESERVATION_ACQUIRE_RETRIES;
    acquisitionAttempt += 1
  ) {
    const proposedToken = randomUUID();
    await tx.execute(sql`
      INSERT INTO outbox_dedupe_reservation
        (reservation_key, recipient_person_id, channel, dedupe_key,
         owner_delivery_id, lease_token, lease_expires_at)
      VALUES (${key}, ${input.recipientPersonId}, ${input.channel}, ${input.dedupeKey},
              ${input.ownerDeliveryId}, ${proposedToken}, TIMESTAMP 'epoch')
      ON CONFLICT DO NOTHING
    `);

    const locked = await tx.execute(sql`
      SELECT recipient_person_id AS "recipientPersonId",
             channel,
             dedupe_key AS "dedupeKey",
             owner_delivery_id AS "ownerDeliveryId",
             lease_token AS "leaseToken",
             lease_expires_at AS "leaseExpiresAt"
        FROM outbox_dedupe_reservation
       WHERE reservation_key = ${key}
       FOR UPDATE
    `);
    const current = rows<{
      recipientPersonId: string;
      channel: string;
      dedupeKey: string;
      ownerDeliveryId: string;
      leaseToken: string;
      leaseExpiresAt: Date;
    }>(locked)[0];
    // Cleanup may delete an expired conflicting row after INSERT .. DO NOTHING but before
    // this SELECT. Retry the whole insert/lock sequence; absence is not a digest collision.
    if (!current) continue;
    if (
      current.recipientPersonId !== input.recipientPersonId ||
      current.channel !== input.channel ||
      current.dedupeKey !== input.dedupeKey
    ) {
      return { status: "digest_collision" };
    }
    const sampled = await tx.execute(sql`
      SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"
    `);
    const sampledAt = utcDate(
      rows<{ sampledAt: Date | string }>(sampled)[0]?.sampledAt,
    );
    if (!sampledAt)
      throw new Error("Database wall-clock sample was unavailable");

    const insertedByThisCall = current.leaseToken === proposedToken;
    const currentLeaseExpiry = utcDate(current.leaseExpiresAt);
    if (!currentLeaseExpiry)
      throw new Error("Stored notification lease timestamp was invalid");
    const isExpired = currentLeaseExpiry.getTime() <= sampledAt.getTime();
    if (!insertedByThisCall && !isExpired) {
      return { status: "deferred", leaseExpiresAt: currentLeaseExpiry };
    }

    const token = insertedByThisCall ? proposedToken : randomUUID();
    const updated = await tx.execute(sql`
      UPDATE outbox_dedupe_reservation
         SET owner_delivery_id = ${input.ownerDeliveryId},
             lease_token = ${token},
             lease_expires_at = ${utc(sampledAt)} + interval '60 seconds'
       WHERE reservation_key = ${key}
         AND recipient_person_id = ${input.recipientPersonId}
         AND channel = ${input.channel}
         AND dedupe_key = ${input.dedupeKey}
         AND (lease_token = ${proposedToken} OR lease_expires_at <= ${utc(sampledAt)})
      RETURNING lease_expires_at AS "leaseExpiresAt"
    `);
    const leaseExpiresAt = utcDate(
      rows<{ leaseExpiresAt: Date | string }>(updated)[0]?.leaseExpiresAt,
    );
    if (!leaseExpiresAt) throw new NotificationReservationContentionError();
    return {
      status: "acquired",
      reservation: {
        key,
        leaseToken: token,
        leaseExpiresAt,
        ownerDeliveryId: input.ownerDeliveryId,
      },
    };
  }
  // The caller sees an ordinary retryable operation failure. No lease expiry is invented,
  // no delivery attempt is consumed, and provider I/O is unreachable on this path.
  throw new NotificationReservationContentionError();
}

/**
 * Apply an eligibility or reservation scheduling result only while this delivery is not
 * already fenced for provider work. Lock order is always delivery then reservation, the
 * same order used by acquire/authorize/complete. The post-lock sample ensures an expired
 * lease no longer blocks this worker, even when physical cleanup has not run.
 */
export async function updateUnreservedNotificationDelivery(
  tx: DbTransaction,
  deliveryId: string,
  update:
    | { kind: "suppressed"; reason: string }
    | { kind: "deferred"; until: Date; reason: string },
): Promise<boolean> {
  const deliveryResult = await tx.execute(sql`
    SELECT state, recipient_person_id AS "recipientPersonId", channel,
           dedupe_key AS "dedupeKey"
      FROM notification_delivery WHERE id = ${deliveryId} FOR UPDATE
  `);
  const delivery = rows<{
    state: string;
    recipientPersonId: string;
    channel: string;
    dedupeKey: string;
  }>(deliveryResult)[0];
  if (delivery?.state !== "pending") return false;

  const key = notificationReservationKey(delivery);
  const reservationResult = await tx.execute(sql`
    SELECT owner_delivery_id AS "ownerDeliveryId", lease_expires_at AS "leaseExpiresAt"
      FROM outbox_dedupe_reservation
     WHERE reservation_key = ${key}
     FOR UPDATE
  `);
  const reservation = rows<{
    ownerDeliveryId: string;
    leaseExpiresAt: Date | string;
  }>(reservationResult)[0];
  const sampledResult = await tx.execute(sql`
    SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"
  `);
  const sampledAt = utcDate(
    rows<{ sampledAt: Date | string }>(sampledResult)[0]?.sampledAt,
  );
  const leaseExpiresAt = utcDate(reservation?.leaseExpiresAt);
  if (!sampledAt) throw new Error("Database wall-clock sample was unavailable");
  if (
    reservation?.ownerDeliveryId === deliveryId &&
    leaseExpiresAt &&
    leaseExpiresAt.getTime() > sampledAt.getTime()
  )
    return false;

  if (update.kind === "suppressed") {
    const changed = await tx.execute(sql`
      UPDATE notification_delivery
         SET state = 'suppressed', last_error = ${update.reason},
             delivered_at = NULL, updated_at = ${utc(sampledAt)}
       WHERE id = ${deliveryId} AND state = 'pending'
       RETURNING id
    `);
    return rows<unknown>(changed).length === 1;
  }
  const changed = await tx.execute(sql`
    UPDATE notification_delivery
       SET next_attempt_at = ${utc(update.until)}, last_error = ${update.reason},
           updated_at = ${utc(sampledAt)}
     WHERE id = ${deliveryId} AND state = 'pending'
     RETURNING id
  `);
  return rows<unknown>(changed).length === 1;
}

export async function hasRecentNotificationSuccess(
  executor: Executor,
  input: {
    recipientPersonId: string;
    channel: string;
    dedupeKey: string;
    excludeDeliveryId: string;
  },
): Promise<boolean> {
  const result = await executor.execute(sql`
    WITH sampled AS MATERIALIZED (
      SELECT clock_timestamp() AT TIME ZONE 'UTC' AS sampled_at
    )
    SELECT EXISTS (
      SELECT 1
        FROM notification_delivery d, sampled s
       WHERE d.recipient_person_id = ${input.recipientPersonId}
         AND d.channel = ${input.channel}
         AND d.dedupe_key = ${input.dedupeKey}
         AND d.id <> ${input.excludeDeliveryId}
         AND d.delivered_at >= s.sampled_at - interval '5 minutes'
    ) AS found
  `);
  return rows<{ found: boolean }>(result)[0]?.found === true;
}

export async function authorizeNotificationProviderAttempt(
  tx: DbTransaction,
  deliveryId: string,
  reservation: ReservationToken,
): Promise<number | null> {
  const delivery = await tx.execute(sql`
    SELECT id, attempts, state, next_attempt_at AS "nextAttemptAt",
           recipient_person_id AS "recipientPersonId", channel, dedupe_key AS "dedupeKey"
      FROM notification_delivery
     WHERE id = ${deliveryId}
     FOR UPDATE
  `);
  const current = rows<{
    id: string;
    attempts: number;
    state: string;
    nextAttemptAt: Date;
    recipientPersonId: string;
    channel: string;
    dedupeKey: string;
  }>(delivery)[0];
  if (current?.state !== "pending") return null;
  const locked = await tx.execute(sql`
    SELECT recipient_person_id AS "recipientPersonId", channel, dedupe_key AS "dedupeKey",
           owner_delivery_id AS "ownerDeliveryId", lease_token AS "leaseToken",
           lease_expires_at AS "leaseExpiresAt"
      FROM outbox_dedupe_reservation
     WHERE reservation_key = ${reservation.key}
     FOR UPDATE
  `);
  const currentReservation = rows<{
    recipientPersonId: string;
    channel: string;
    dedupeKey: string;
    ownerDeliveryId: string;
    leaseToken: string;
    leaseExpiresAt: Date;
  }>(locked)[0];
  const sampled = await tx.execute(sql`
    SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"
  `);
  const sampledAt = utcDate(
    rows<{ sampledAt: Date | string }>(sampled)[0]?.sampledAt,
  );
  if (!sampledAt) throw new Error("Database wall-clock sample was unavailable");
  if (
    !currentReservation ||
    currentReservation.ownerDeliveryId !== deliveryId ||
    currentReservation.leaseToken !== reservation.leaseToken ||
    (utcDate(currentReservation.leaseExpiresAt)?.getTime() ?? 0) <=
      sampledAt.getTime() ||
    currentReservation.recipientPersonId !== current.recipientPersonId ||
    currentReservation.channel !== current.channel ||
    currentReservation.dedupeKey !== current.dedupeKey
  ) {
    return null;
  }
  if (current.attempts >= NOTIFICATION_ATTEMPT_LIMIT) {
    await tx.execute(sql`
      UPDATE notification_delivery
         SET state = 'dead', last_error = 'attempt_limit', updated_at = ${utc(sampledAt)}
       WHERE id = ${deliveryId} AND state = 'pending'
    `);
    await tx.execute(sql`
      DELETE FROM outbox_dedupe_reservation
       WHERE reservation_key = ${reservation.key}
         AND owner_delivery_id = ${deliveryId}
         AND lease_token = ${reservation.leaseToken}
    `);
    return null;
  }
  const due = await tx.execute(sql`
    UPDATE notification_delivery
       SET attempts = attempts + 1, updated_at = ${utc(sampledAt)}
     WHERE id = ${deliveryId}
       AND state = 'pending'
       AND next_attempt_at <= ${utc(sampledAt)}
       AND attempts = ${current.attempts}
    RETURNING attempts
  `);
  return rows<{ attempts: number }>(due)[0]?.attempts ?? null;
}

export async function completeNotificationDelivery(
  tx: DbTransaction,
  deliveryId: string,
  reservation: ReservationToken,
  outcome:
    | { kind: "delivered" }
    | { kind: "suppressed" }
    | { kind: "failed"; errorCode: string }
    | { kind: "ambiguous" },
): Promise<boolean> {
  const childResult = await tx.execute(sql`
    SELECT attempts, state FROM notification_delivery WHERE id = ${deliveryId} FOR UPDATE
  `);
  const child = rows<{ attempts: number; state: string }>(childResult)[0];
  const lockResult = await tx.execute(sql`
    SELECT owner_delivery_id AS "ownerDeliveryId", lease_token AS "leaseToken",
           lease_expires_at AS "leaseExpiresAt"
      FROM outbox_dedupe_reservation
     WHERE reservation_key = ${reservation.key}
     FOR UPDATE
  `);
  const current = rows<{
    ownerDeliveryId: string;
    leaseToken: string;
    leaseExpiresAt: Date;
  }>(lockResult)[0];
  const sampled = await tx.execute(sql`
    SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"
  `);
  const sampledAt = utcDate(
    rows<{ sampledAt: Date | string }>(sampled)[0]?.sampledAt,
  );
  const currentExpiry = utcDate(current?.leaseExpiresAt);
  if (child?.state !== "pending" || !current || !sampledAt || !currentExpiry)
    return false;
  if (
    current.ownerDeliveryId !== deliveryId ||
    current.leaseToken !== reservation.leaseToken ||
    currentExpiry.getTime() <= sampledAt.getTime()
  )
    return false;

  if (outcome.kind === "ambiguous") {
    await tx.execute(sql`
      UPDATE notification_delivery
         SET next_attempt_at = GREATEST(next_attempt_at, ${utc(current.leaseExpiresAt)}),
             last_error = 'provider_ambiguous', updated_at = ${utc(sampledAt)}
       WHERE id = ${deliveryId} AND state = 'pending'
    `);
    return true;
  }

  if (outcome.kind === "delivered" || outcome.kind === "suppressed") {
    const state = outcome.kind;
    const changed = await tx.execute(sql`
      UPDATE notification_delivery
         SET state = ${state},
             delivered_at = CASE WHEN ${state} = 'delivered' THEN ${utc(sampledAt)} ELSE NULL END,
             last_error = NULL,
             updated_at = ${utc(sampledAt)}
       WHERE id = ${deliveryId} AND state = 'pending'
       RETURNING id
    `);
    if (rows<unknown>(changed).length !== 1) return false;
  } else {
    const retryDelay = notificationRetryDelayMs(child.attempts);
    if (retryDelay === null) {
      await tx.execute(sql`
        UPDATE notification_delivery
           SET state = 'dead', last_error = ${outcome.errorCode}, updated_at = ${utc(sampledAt)}
         WHERE id = ${deliveryId} AND state = 'pending'
      `);
    } else {
      await tx.execute(sql`
        UPDATE notification_delivery
           SET next_attempt_at = ${utc(sampledAt)} + (${retryDelay} * interval '1 millisecond'),
               last_error = ${outcome.errorCode}, updated_at = ${utc(sampledAt)}
         WHERE id = ${deliveryId} AND state = 'pending'
      `);
    }
  }
  const released = await tx.execute(sql`
    DELETE FROM outbox_dedupe_reservation
     WHERE reservation_key = ${reservation.key}
       AND owner_delivery_id = ${deliveryId}
       AND lease_token = ${reservation.leaseToken}
       AND lease_expires_at > ${utc(sampledAt)}
    RETURNING reservation_key
  `);
  return rows<unknown>(released).length === 1;
}

/** Renew the same live owner/token; expiry checks use a post-lock DB clock sample. */
export async function renewNotificationReservation(
  tx: DbTransaction,
  reservation: ReservationToken,
): Promise<ReservationToken | null> {
  const locked = await tx.execute(sql`
    SELECT owner_delivery_id AS "ownerDeliveryId", lease_token AS "leaseToken",
           lease_expires_at AS "leaseExpiresAt"
      FROM outbox_dedupe_reservation
     WHERE reservation_key = ${reservation.key}
     FOR UPDATE
  `);
  const current = rows<{
    ownerDeliveryId: string;
    leaseToken: string;
    leaseExpiresAt: Date;
  }>(locked)[0];
  const sampled = await tx.execute(
    sql`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"`,
  );
  const sampledAt = utcDate(
    rows<{ sampledAt: Date | string }>(sampled)[0]?.sampledAt,
  );
  const currentExpiry = utcDate(current?.leaseExpiresAt);
  if (
    !current ||
    !sampledAt ||
    !currentExpiry ||
    current.ownerDeliveryId !== reservation.ownerDeliveryId ||
    current.leaseToken !== reservation.leaseToken ||
    currentExpiry.getTime() <= sampledAt.getTime()
  ) {
    return null;
  }
  const renewed = await tx.execute(sql`
    UPDATE outbox_dedupe_reservation
       SET lease_expires_at = ${utc(sampledAt)} + interval '60 seconds'
     WHERE reservation_key = ${reservation.key}
       AND owner_delivery_id = ${reservation.ownerDeliveryId}
       AND lease_token = ${reservation.leaseToken}
       AND lease_expires_at > ${utc(sampledAt)}
    RETURNING lease_expires_at AS "leaseExpiresAt"
  `);
  const leaseExpiresAt = utcDate(
    rows<{ leaseExpiresAt: Date | string }>(renewed)[0]?.leaseExpiresAt,
  );
  return leaseExpiresAt ? { ...reservation, leaseExpiresAt } : null;
}

export async function deferNotificationDelivery(
  tx: DbTransaction,
  deliveryId: string,
  until: Date,
  reason: string,
  reservation: ReservationToken,
): Promise<boolean> {
  const child = await tx.execute(sql`
    SELECT state FROM notification_delivery WHERE id = ${deliveryId} FOR UPDATE
  `);
  if (rows<{ state: string }>(child)[0]?.state !== "pending") return false;
  const locked = await tx.execute(sql`
    SELECT owner_delivery_id AS "ownerDeliveryId", lease_token AS "leaseToken",
           lease_expires_at AS "leaseExpiresAt"
      FROM outbox_dedupe_reservation WHERE reservation_key = ${reservation.key} FOR UPDATE
  `);
  const current = rows<{
    ownerDeliveryId: string;
    leaseToken: string;
    leaseExpiresAt: Date;
  }>(locked)[0];
  const sampled = await tx.execute(
    sql`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"`,
  );
  const sampledAt = utcDate(
    rows<{ sampledAt: Date | string }>(sampled)[0]?.sampledAt,
  );
  const currentExpiry = utcDate(current?.leaseExpiresAt);
  if (
    !current ||
    !sampledAt ||
    !currentExpiry ||
    current.ownerDeliveryId !== deliveryId ||
    current.leaseToken !== reservation.leaseToken ||
    currentExpiry.getTime() <= sampledAt.getTime()
  )
    return false;
  await tx.execute(sql`
    UPDATE notification_delivery SET next_attempt_at = ${utc(until)}, last_error = ${reason},
      updated_at = ${utc(sampledAt)} WHERE id = ${deliveryId} AND state = 'pending'
  `);
  await tx.execute(sql`
    DELETE FROM outbox_dedupe_reservation WHERE reservation_key = ${reservation.key}
      AND owner_delivery_id = ${deliveryId} AND lease_token = ${reservation.leaseToken}
      AND lease_expires_at > ${utc(sampledAt)}
  `);
  return true;
}

export async function releaseNotificationReservation(
  tx: DbTransaction,
  deliveryId: string,
  reservation: ReservationToken,
): Promise<boolean> {
  const child = await tx.execute(sql`
    SELECT state FROM notification_delivery WHERE id = ${deliveryId} FOR UPDATE
  `);
  if (rows<{ state: string }>(child)[0]?.state !== "pending") return false;
  const locked = await tx.execute(sql`
    SELECT owner_delivery_id AS "ownerDeliveryId", lease_token AS "leaseToken",
           lease_expires_at AS "leaseExpiresAt"
      FROM outbox_dedupe_reservation WHERE reservation_key = ${reservation.key} FOR UPDATE
  `);
  const current = rows<{
    ownerDeliveryId: string;
    leaseToken: string;
    leaseExpiresAt: Date;
  }>(locked)[0];
  const sampled = await tx.execute(
    sql`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"`,
  );
  const sampledAt = utcDate(
    rows<{ sampledAt: Date | string }>(sampled)[0]?.sampledAt,
  );
  const currentExpiry = utcDate(current?.leaseExpiresAt);
  if (
    !current ||
    !sampledAt ||
    !currentExpiry ||
    current.ownerDeliveryId !== deliveryId ||
    current.leaseToken !== reservation.leaseToken ||
    currentExpiry.getTime() <= sampledAt.getTime()
  )
    return false;
  await tx.execute(sql`
    DELETE FROM outbox_dedupe_reservation WHERE reservation_key = ${reservation.key}
      AND owner_delivery_id = ${deliveryId} AND lease_token = ${reservation.leaseToken}
      AND lease_expires_at > ${utc(sampledAt)}
  `);
  return true;
}
