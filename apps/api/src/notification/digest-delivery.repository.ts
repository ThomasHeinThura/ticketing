import { randomUUID } from "node:crypto";
import type { JsonValue } from "@taskdesk/domain";
import { sql } from "drizzle-orm";
import {
  acquireNotificationReservation,
  hasRecentNotificationSuccess,
  type ReservationToken,
  releaseNotificationReservation,
} from "../database/repositories/notification-delivery.repository";
import type { DbTransaction } from "../events/outbox";
import { notificationReservationKey } from "./delivery-primitives";

export const DIGEST_GROUP_LEASE_MS = 60_000;

export type DigestGroupLease = {
  id: string;
  recipientPersonId: string;
  channel: string;
  workspaceId: string;
  organisationId: string | null;
  cadence: "hourly" | "daily";
  attempts: number;
  leaseToken: string;
  leaseExpiresAt: Date;
};

export type DigestMember = {
  id: string;
  eventId: string;
  recipientPersonId: string;
  channel: string;
  workspaceId: string;
  organisationId: string | null;
  dedupeKey: string;
  attempts: number;
  createdAt: Date;
  eventKind: string;
  payload: JsonValue;
  eventData: JsonValue | null;
  title: string | null;
  body: string | null;
  resourceType: string | null;
  resourceId: string | null;
};

export type DigestReservation = {
  ownerDeliveryId: string;
  reservation: ReservationToken;
};

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

function utc(value: Date) {
  return sql`${value.toISOString()}::timestamp`;
}

export type DigestClaimResult =
  | { kind: "claimed"; group: DigestGroupLease }
  | { kind: "idle" }
  | { kind: "dead" };

/** Claim one due sealed group with a durable, per-group lease. */
export async function claimNextDigestGroup(
  tx: DbTransaction,
): Promise<DigestClaimResult> {
  const selected = await tx.execute(sql`
    SELECT id, recipient_person_id AS "recipientPersonId", channel,
           workspace_id AS "workspaceId", organisation_id AS "organisationId",
           cadence, attempts, lease_token AS "leaseToken",
           lease_expires_at AS "leaseExpiresAt"
      FROM notification_digest
     WHERE state = 'pending'
       AND next_attempt_at <= (clock_timestamp() AT TIME ZONE 'UTC')
       AND (lease_expires_at IS NULL OR lease_expires_at <= (clock_timestamp() AT TIME ZONE 'UTC'))
     ORDER BY next_attempt_at, window_end_at, id
     LIMIT 1
     FOR UPDATE SKIP LOCKED
  `);
  const current = rows<
    Omit<DigestGroupLease, "leaseToken" | "leaseExpiresAt"> & {
      leaseToken: string | null;
      leaseExpiresAt: Date | string | null;
    }
  >(selected)[0];
  if (!current) return { kind: "idle" };

  const sampled = await tx.execute(
    sql`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"`,
  );
  const sampledAt = utcDate(
    rows<{ sampledAt: Date | string }>(sampled)[0]?.sampledAt,
  );
  if (!sampledAt) throw new Error("Database wall-clock sample was unavailable");
  if (current.attempts >= 6) {
    await tx.execute(sql`
      UPDATE notification_digest
         SET state = 'dead', last_error = 'attempt_limit', updated_at = ${utc(sampledAt)},
             lease_token = NULL, lease_expires_at = NULL
       WHERE id = ${current.id} AND state = 'pending'
    `);
    await tx.execute(sql`
      UPDATE notification_delivery
         SET state = 'dead', last_error = 'attempt_limit', updated_at = ${utc(sampledAt)}
       WHERE digest_id = ${current.id} AND state = 'pending'
    `);
    return { kind: "dead" };
  }

  const leaseToken = randomUUID();
  const updated = await tx.execute(sql`
    UPDATE notification_digest
       SET lease_token = ${leaseToken},
           lease_expires_at = ${utc(sampledAt)} + interval '60 seconds',
           updated_at = ${utc(sampledAt)}
     WHERE id = ${current.id} AND state = 'pending'
       AND (lease_expires_at IS NULL OR lease_expires_at <= ${utc(sampledAt)})
     RETURNING lease_expires_at AS "leaseExpiresAt"
  `);
  const leaseExpiresAt = utcDate(
    rows<{ leaseExpiresAt: Date | string }>(updated)[0]?.leaseExpiresAt,
  );
  if (!leaseExpiresAt) return { kind: "idle" };
  return {
    kind: "claimed",
    group: { ...current, leaseToken, leaseExpiresAt },
  };
}

/** The group is sealed, so every pending row is part of this frozen membership. */
export async function listDigestMembers(
  tx: DbTransaction,
  digestId: string,
): Promise<DigestMember[]> {
  const result = await tx.execute(sql`
    SELECT d.id, d.event_id AS "eventId",
           d.recipient_person_id AS "recipientPersonId", d.channel,
           d.workspace_id AS "workspaceId", d.organisation_id AS "organisationId",
           d.dedupe_key AS "dedupeKey", d.attempts, d.created_at AS "createdAt",
           o.kind AS "eventKind", o.payload,
           n.event_data AS "eventData", n.title, n.body,
           n.resource_type AS "resourceType", n.resource_id AS "resourceId"
      FROM notification_delivery d
      JOIN outbox o ON o.event_id = d.event_id
      JOIN notification n ON n.event_id = d.event_id
                        AND n.person_id = d.recipient_person_id
     WHERE d.digest_id = ${digestId} AND d.state = 'pending'
     ORDER BY d.created_at, d.id
  `);
  return rows<
    Array<DigestMember & { payload: unknown; createdAt: Date | string }>[number]
  >(result).map((member) => ({
    ...member,
    payload: member.payload as JsonValue,
    eventData: member.eventData as JsonValue | null,
    createdAt: utcDate(member.createdAt) ?? new Date(0),
  }));
}

/** Reserve every distinct tuple in canonical key order; partial claims roll back on contention. */
export async function acquireDigestReservations(
  tx: DbTransaction,
  group: DigestGroupLease,
  members: readonly DigestMember[],
): Promise<
  | { kind: "acquired"; reservations: DigestReservation[] }
  | { kind: "deferred"; until: Date }
  | { kind: "collision" }
> {
  const byKey = new Map<string, DigestMember>();
  for (const member of members) {
    const key = notificationReservationKey(member).toString("hex");
    if (!byKey.has(key)) byKey.set(key, member);
  }
  const ordered = [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b));
  const acquired: DigestReservation[] = [];
  for (const [, member] of ordered) {
    const claim = await acquireNotificationReservation(tx, {
      recipientPersonId: member.recipientPersonId,
      channel: member.channel,
      dedupeKey: member.dedupeKey,
      ownerDeliveryId: member.id,
    });
    if (claim.status === "deferred") {
      for (const prior of acquired)
        await releaseNotificationReservation(
          tx,
          prior.ownerDeliveryId,
          prior.reservation,
        );
      await deferDigestGroup(
        tx,
        group,
        claim.leaseExpiresAt,
        "reservation_contention",
      );
      return { kind: "deferred", until: claim.leaseExpiresAt };
    }
    if (claim.status === "digest_collision") {
      for (const prior of acquired)
        await releaseNotificationReservation(
          tx,
          prior.ownerDeliveryId,
          prior.reservation,
        );
      await finishDigestGroup(
        tx,
        group,
        { kind: "suppressed", reason: "reservation_digest_collision" },
        [],
      );
      return { kind: "collision" };
    }
    if (claim.status !== "acquired") {
      for (const prior of acquired)
        await releaseNotificationReservation(
          tx,
          prior.ownerDeliveryId,
          prior.reservation,
        );
      await deferDigestGroup(
        tx,
        group,
        new Date(Date.now() + 30_000),
        "delivery_fence",
      );
      return { kind: "deferred", until: new Date(Date.now() + 30_000) };
    }
    acquired.push({
      ownerDeliveryId: member.id,
      reservation: claim.reservation,
    });
  }
  return { kind: "acquired", reservations: acquired };
}

export async function hasRecentDigestMemberSuccess(
  tx: DbTransaction,
  member: DigestMember,
): Promise<boolean> {
  return hasRecentNotificationSuccess(tx, {
    recipientPersonId: member.recipientPersonId,
    channel: member.channel,
    dedupeKey: member.dedupeKey,
    excludeDeliveryId: member.id,
  });
}

export async function renewDigestGroupLease(
  tx: DbTransaction,
  group: DigestGroupLease,
): Promise<Date | null> {
  const locked = await tx.execute(sql`
    SELECT lease_token AS "leaseToken", lease_expires_at AS "leaseExpiresAt"
      FROM notification_digest WHERE id = ${group.id} FOR UPDATE
  `);
  const current = rows<{
    leaseToken: string | null;
    leaseExpiresAt: Date | string | null;
  }>(locked)[0];
  const sampled = await tx.execute(
    sql`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"`,
  );
  const now = utcDate(
    rows<{ sampledAt: Date | string }>(sampled)[0]?.sampledAt,
  );
  const expiry = utcDate(current?.leaseExpiresAt);
  if (
    !now ||
    !expiry ||
    current?.leaseToken !== group.leaseToken ||
    expiry <= now
  )
    return null;
  const updated = await tx.execute(sql`
    UPDATE notification_digest
       SET lease_expires_at = ${utc(now)} + interval '60 seconds', updated_at = ${utc(now)}
     WHERE id = ${group.id} AND state = 'pending' AND lease_token = ${group.leaseToken}
       AND lease_expires_at > ${utc(now)}
     RETURNING lease_expires_at AS "leaseExpiresAt"
  `);
  return utcDate(
    rows<{ leaseExpiresAt: Date | string }>(updated)[0]?.leaseExpiresAt,
  );
}

export async function authorizeDigestProviderAttempt(
  tx: DbTransaction,
  group: DigestGroupLease,
  reservations: readonly DigestReservation[],
  payloadHash: string,
): Promise<number | null> {
  const locked = await tx.execute(sql`
    SELECT attempts, state, lease_token AS "leaseToken", lease_expires_at AS "leaseExpiresAt",
           next_attempt_at AS "nextAttemptAt"
      FROM notification_digest WHERE id = ${group.id} FOR UPDATE
  `);
  const current = rows<{
    attempts: number;
    state: string;
    leaseToken: string | null;
    leaseExpiresAt: Date | string | null;
    nextAttemptAt: Date | string;
  }>(locked)[0];
  const sampled = await tx.execute(
    sql`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"`,
  );
  const now = utcDate(
    rows<{ sampledAt: Date | string }>(sampled)[0]?.sampledAt,
  );
  const expiry = utcDate(current?.leaseExpiresAt);
  if (
    !now ||
    !current ||
    current.state !== "pending" ||
    current.leaseToken !== group.leaseToken ||
    !expiry ||
    expiry <= now ||
    current.attempts >= 6
  )
    return null;
  if (new Date(current.nextAttemptAt).getTime() > now.getTime()) return null;

  for (const item of reservations) {
    const reservationResult = await tx.execute(sql`
      SELECT owner_delivery_id AS "ownerDeliveryId", lease_token AS "leaseToken",
             lease_expires_at AS "leaseExpiresAt"
        FROM outbox_dedupe_reservation WHERE reservation_key = ${item.reservation.key} FOR UPDATE
    `);
    const held = rows<{
      ownerDeliveryId: string;
      leaseToken: string;
      leaseExpiresAt: Date | string;
    }>(reservationResult)[0];
    const reservationSample = await tx.execute(
      sql`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"`,
    );
    const reservationNow = utcDate(
      rows<{ sampledAt: Date | string }>(reservationSample)[0]?.sampledAt,
    );
    const heldExpiry = utcDate(held?.leaseExpiresAt);
    if (
      !reservationNow ||
      !held ||
      !heldExpiry ||
      held.ownerDeliveryId !== item.ownerDeliveryId ||
      held.leaseToken !== item.reservation.leaseToken ||
      heldExpiry <= reservationNow
    )
      return null;
  }
  const update = await tx.execute(sql`
    UPDATE notification_digest
       SET attempts = attempts + 1, payload_hash = ${payloadHash}, updated_at = ${utc(now)}
     WHERE id = ${group.id} AND state = 'pending' AND lease_token = ${group.leaseToken}
       AND lease_expires_at > ${utc(now)} AND attempts = ${current.attempts}
     RETURNING attempts
  `);
  return rows<{ attempts: number }>(update)[0]?.attempts ?? null;
}

/** Verify an already-authorized group lease immediately before SMTP I/O. */
export async function validateDigestProviderLease(
  tx: DbTransaction,
  group: DigestGroupLease,
  reservations: readonly DigestReservation[],
): Promise<boolean> {
  const current = await lockDigestGroup(tx, group);
  if (!current) return false;
  for (const item of reservations) {
    const locked = await tx.execute(sql`
      SELECT owner_delivery_id AS "ownerDeliveryId", lease_token AS "leaseToken",
             lease_expires_at AS "leaseExpiresAt"
        FROM outbox_dedupe_reservation
       WHERE reservation_key = ${item.reservation.key} FOR UPDATE
    `);
    const held = rows<{
      ownerDeliveryId: string;
      leaseToken: string;
      leaseExpiresAt: Date | string;
    }>(locked)[0];
    const sampled = await tx.execute(
      sql`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"`,
    );
    const now = utcDate(
      rows<{ sampledAt: Date | string }>(sampled)[0]?.sampledAt,
    );
    const expiresAt = utcDate(held?.leaseExpiresAt);
    if (
      !now ||
      !held ||
      !expiresAt ||
      held.ownerDeliveryId !== item.ownerDeliveryId ||
      held.leaseToken !== item.reservation.leaseToken ||
      expiresAt <= now
    )
      return false;
  }
  return true;
}

export async function deferDigestGroup(
  tx: DbTransaction,
  group: DigestGroupLease,
  until: Date,
  reason: string,
  reservations: readonly DigestReservation[] = [],
): Promise<boolean> {
  const current = await lockDigestGroup(tx, group);
  if (!current) return false;
  const now = current.sampledAt;
  for (const item of reservations) {
    await tx.execute(sql`
      DELETE FROM outbox_dedupe_reservation
       WHERE reservation_key = ${item.reservation.key}
         AND owner_delivery_id = ${item.ownerDeliveryId}
         AND lease_token = ${item.reservation.leaseToken}
         AND lease_expires_at > ${utc(now)}
    `);
  }
  await tx.execute(sql`
    UPDATE notification_digest
       SET next_attempt_at = GREATEST(${utc(until)}, ${utc(now)}),
           last_error = ${reason}, lease_token = NULL, lease_expires_at = NULL,
           updated_at = ${utc(now)}
     WHERE id = ${group.id} AND state = 'pending' AND lease_token = ${group.leaseToken}
       AND lease_expires_at > ${utc(now)}
  `);
  return true;
}

export async function finishDigestGroup(
  tx: DbTransaction,
  group: DigestGroupLease,
  outcome:
    | {
        kind: "delivered";
        includedIds: readonly string[];
        suppressedIds: readonly string[];
      }
    | { kind: "failed"; suppressedIds: readonly string[] }
    | { kind: "ambiguous"; reservations: readonly DigestReservation[] }
    | { kind: "suppressed"; reason: string },
  reservations: readonly DigestReservation[],
): Promise<boolean> {
  const current = await lockDigestGroup(tx, group);
  if (!current) return false;
  const now = current.sampledAt;
  if (outcome.kind === "ambiguous") {
    for (const item of reservations) {
      const locked = await tx.execute(sql`
        SELECT owner_delivery_id AS "ownerDeliveryId", lease_token AS "leaseToken",
               lease_expires_at AS "leaseExpiresAt"
          FROM outbox_dedupe_reservation
         WHERE reservation_key = ${item.reservation.key} FOR UPDATE
      `);
      const held = rows<{
        ownerDeliveryId: string;
        leaseToken: string;
        leaseExpiresAt: Date | string;
      }>(locked)[0];
      const sampled = await tx.execute(
        sql`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"`,
      );
      const checkedAt = utcDate(
        rows<{ sampledAt: Date | string }>(sampled)[0]?.sampledAt,
      );
      const expiresAt = utcDate(held?.leaseExpiresAt);
      if (
        !checkedAt ||
        !held ||
        !expiresAt ||
        held.ownerDeliveryId !== item.ownerDeliveryId ||
        held.leaseToken !== item.reservation.leaseToken ||
        expiresAt <= checkedAt
      )
        return false;
    }
    const latestReservationExpiry = reservations.reduce(
      (latest, item) =>
        Math.max(latest, item.reservation.leaseExpiresAt.getTime()),
      current.leaseExpiresAt.getTime(),
    );
    await tx.execute(sql`
      UPDATE notification_digest
         SET next_attempt_at = GREATEST(next_attempt_at, ${utc(new Date(latestReservationExpiry))}),
             last_error = 'provider_ambiguous', updated_at = ${utc(now)}
       WHERE id = ${group.id} AND state = 'pending' AND lease_token = ${group.leaseToken}
    `);
    return true;
  }

  for (const item of reservations) {
    const locked = await tx.execute(sql`
      SELECT owner_delivery_id AS "ownerDeliveryId", lease_token AS "leaseToken",
             lease_expires_at AS "leaseExpiresAt"
        FROM outbox_dedupe_reservation
       WHERE reservation_key = ${item.reservation.key} FOR UPDATE
    `);
    const held = rows<{
      ownerDeliveryId: string;
      leaseToken: string;
      leaseExpiresAt: Date | string;
    }>(locked)[0];
    const sampled = await tx.execute(
      sql`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"`,
    );
    const checkedAt = utcDate(
      rows<{ sampledAt: Date | string }>(sampled)[0]?.sampledAt,
    );
    const expiresAt = utcDate(held?.leaseExpiresAt);
    if (
      !checkedAt ||
      !held ||
      !expiresAt ||
      held.ownerDeliveryId !== item.ownerDeliveryId ||
      held.leaseToken !== item.reservation.leaseToken ||
      expiresAt <= checkedAt
    )
      return false;
    await tx.execute(sql`
      DELETE FROM outbox_dedupe_reservation
       WHERE reservation_key = ${item.reservation.key}
         AND owner_delivery_id = ${item.ownerDeliveryId}
         AND lease_token = ${item.reservation.leaseToken}
         AND lease_expires_at > ${utc(checkedAt)}
    `);
  }

  if (outcome.kind === "delivered") {
    const included = outcome.includedIds.length
      ? sql`id IN (${sql.join(
          outcome.includedIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`FALSE`;
    await tx.execute(sql`
      UPDATE notification_delivery
         SET state = CASE WHEN ${included} THEN 'delivered' ELSE 'suppressed' END,
             delivered_at = CASE WHEN ${included} THEN ${utc(now)} ELSE NULL END,
             last_error = NULL, updated_at = ${utc(now)}
       WHERE digest_id = ${group.id} AND state = 'pending'
    `);
    await tx.execute(sql`
      UPDATE notification_digest
         SET state = 'delivered', delivered_at = ${utc(now)}, last_error = NULL,
             lease_token = NULL, lease_expires_at = NULL, updated_at = ${utc(now)}
       WHERE id = ${group.id} AND state = 'pending' AND lease_token = ${group.leaseToken}
    `);
  } else if (outcome.kind === "suppressed") {
    await tx.execute(sql`
      UPDATE notification_delivery SET state = 'suppressed', delivered_at = NULL,
             last_error = ${outcome.reason}, updated_at = ${utc(now)}
       WHERE digest_id = ${group.id} AND state = 'pending'
    `);
    await tx.execute(sql`
      UPDATE notification_digest SET state = 'suppressed', last_error = ${outcome.reason},
             lease_token = NULL, lease_expires_at = NULL, updated_at = ${utc(now)}
       WHERE id = ${group.id} AND state = 'pending' AND lease_token = ${group.leaseToken}
    `);
  } else {
    const attempt = current.attempts;
    const delayMs =
      attempt >= 6
        ? null
        : ([30_000, 120_000, 600_000, 3_600_000, 21_600_000][attempt - 1] ??
          null);
    if (delayMs === null) {
      await tx.execute(sql`
        UPDATE notification_delivery SET state = 'dead', last_error = 'attempt_limit', updated_at = ${utc(now)}
         WHERE digest_id = ${group.id} AND state = 'pending'
      `);
      await tx.execute(sql`
        UPDATE notification_digest SET state = 'dead', last_error = 'attempt_limit',
               lease_token = NULL, lease_expires_at = NULL, updated_at = ${utc(now)}
         WHERE id = ${group.id} AND state = 'pending' AND lease_token = ${group.leaseToken}
      `);
    } else {
      const notSuppressed = outcome.suppressedIds.length
        ? sql`id NOT IN (${sql.join(
            outcome.suppressedIds.map((id) => sql`${id}`),
            sql`, `,
          )})`
        : sql`TRUE`;
      const suppressed = outcome.suppressedIds.length
        ? sql`id IN (${sql.join(
            outcome.suppressedIds.map((id) => sql`${id}`),
            sql`, `,
          )})`
        : sql`FALSE`;
      await tx.execute(sql`
        UPDATE notification_delivery SET last_error = 'provider_failed', updated_at = ${utc(now)}
         WHERE digest_id = ${group.id} AND state = 'pending'
           AND ${notSuppressed}
      `);
      await tx.execute(sql`
        UPDATE notification_delivery SET state = 'suppressed', last_error = NULL,
               delivered_at = NULL, updated_at = ${utc(now)}
         WHERE digest_id = ${group.id} AND state = 'pending'
           AND ${suppressed}
      `);
      await tx.execute(sql`
        UPDATE notification_digest SET next_attempt_at = ${utc(now)} + (${delayMs} * interval '1 millisecond'),
               last_error = 'provider_failed', lease_token = NULL, lease_expires_at = NULL,
               updated_at = ${utc(now)}
         WHERE id = ${group.id} AND state = 'pending' AND lease_token = ${group.leaseToken}
      `);
    }
  }
  return true;
}

async function lockDigestGroup(
  tx: DbTransaction,
  group: DigestGroupLease,
): Promise<{ sampledAt: Date; leaseExpiresAt: Date; attempts: number } | null> {
  const locked = await tx.execute(sql`
    SELECT state, attempts, lease_token AS "leaseToken", lease_expires_at AS "leaseExpiresAt"
      FROM notification_digest WHERE id = ${group.id} FOR UPDATE
  `);
  const current = rows<{
    state: string;
    attempts: number;
    leaseToken: string | null;
    leaseExpiresAt: Date | string | null;
  }>(locked)[0];
  const sample = await tx.execute(
    sql`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"`,
  );
  const sampledAt = utcDate(
    rows<{ sampledAt: Date | string }>(sample)[0]?.sampledAt,
  );
  const leaseExpiresAt = utcDate(current?.leaseExpiresAt);
  if (
    !sampledAt ||
    current?.state !== "pending" ||
    current.leaseToken !== group.leaseToken ||
    !leaseExpiresAt ||
    leaseExpiresAt <= sampledAt
  )
    return null;
  return { sampledAt, leaseExpiresAt, attempts: current.attempts };
}

/** Suppress duplicate members within five minutes of an earlier included member. */
export function dedupeDigestMembers(members: readonly DigestMember[]): {
  included: DigestMember[];
  suppressed: DigestMember[];
} {
  const included: DigestMember[] = [];
  const suppressed: DigestMember[] = [];
  const lastIncluded = new Map<string, Date>();
  for (const member of [...members].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  )) {
    const previous = lastIncluded.get(member.dedupeKey);
    if (
      previous &&
      member.createdAt.getTime() - previous.getTime() < 5 * 60_000
    ) {
      suppressed.push(member);
      continue;
    }
    included.push(member);
    lastIncluded.set(member.dedupeKey, member.createdAt);
  }
  return { included, suppressed };
}

/** Post-reservation recent-success check, excluding this child id. */
export async function digestHasRecentSuccess(
  tx: DbTransaction,
  member: DigestMember,
) {
  return hasRecentDigestMemberSuccess(tx, member);
}
