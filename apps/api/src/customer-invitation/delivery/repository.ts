import { randomUUID } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import db from "../../database";
import type { Executor, Transaction } from "../../database/executor";
import { customerInvitationDeliveryTable } from "../../database/schema-customer-invitation-delivery";
import { encryptDeliveryEnvelope } from "./envelope";
import {
  type CustomerInvitationDeliveryKeyring,
  customerInvitationDeliveryKeyring,
  type DeliveryCapacityReservation,
  type DeliveryKey,
} from "./keyring";

const delivery = customerInvitationDeliveryTable;
const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 5;

export type DeliveryClaim = {
  id: string;
  invitationId: string;
  leaseId: string;
};

/** Queue work in the same transaction that creates/rotates the invitation hash. */
export async function enqueueCustomerInvitationDelivery(
  tx: Transaction,
  input: {
    invitationId: string;
    credentialHash: string | null;
    credential: string | null;
    resend: boolean;
    inert: boolean;
    expiresAt?: Date;
  },
  keyring: CustomerInvitationDeliveryKeyring = customerInvitationDeliveryKeyring,
  admission?: DeliveryCapacityReservation,
): Promise<DeliveryKey | null> {
  const id = createId();
  const active = !input.inert;
  const key = active
    ? admission
      ? admission.reserve(id)
      : keyring.reserve(id)
    : null;
  try {
    const envelope = active
      ? encryptDeliveryEnvelope({
          deliveryId: id,
          invitationId: input.invitationId,
          credentialHash: input.credentialHash ?? "",
          credential: input.credential ?? "",
          key: key as DeliveryKey,
        })
      : null;
    await tx.insert(delivery).values({
      id,
      invitationId: input.invitationId,
      credentialHash: active ? input.credentialHash : null,
      ownerId: key?.ownerId ?? null,
      envelope,
      resend: input.resend,
      state: active ? "queued" : "suppressed",
      attempts: 0,
      nextAttemptAt: sql`statement_timestamp()`,
      expiresAt:
        input.expiresAt ?? sql`statement_timestamp() + INTERVAL '15 minutes'`,
      terminalCode: active ? null : "inert",
      createdAt: sql`statement_timestamp()`,
      updatedAt: sql`statement_timestamp()`,
    });
    return key;
  } catch (error) {
    if (key) keyring.destroy(key.id);
    throw error;
  }
}

/** Erases every queued credential from a superseded or closed invitation generation. */
export async function suppressActiveInvitationDeliveries(
  tx: Executor,
  invitationId: string,
  reason: "superseded" | "revoked" | "accepted" | "rejected",
) {
  const erased = await tx
    .update(delivery)
    .set({
      state: "suppressed",
      envelope: null,
      credentialHash: null,
      ownerId: null,
      leaseId: null,
      leaseExpiresAt: null,
      terminalCode: reason,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(delivery.invitationId, invitationId),
        inArray(delivery.state, ["queued", "sending"]),
      ),
    )
    .returning({ id: delivery.id });
  return erased.map(({ id }) => id);
}

/** Enables a reserved key only after the invitation transaction commits. */
export function activateCustomerInvitationDeliveryKey(
  key: DeliveryKey | null,
  keyring: CustomerInvitationDeliveryKeyring = customerInvitationDeliveryKeyring,
): void {
  if (key) keyring.activate(key.id);
}

/** Releases a key reservation when the enclosing invitation transaction rolls back. */
export function discardCustomerInvitationDeliveryKey(
  key: DeliveryKey | null,
  keyring: CustomerInvitationDeliveryKeyring = customerInvitationDeliveryKeyring,
): void {
  if (key) keyring.destroy(key.id);
}

/** Destroys any matching key held by this process after a lifecycle commit. */
export function destroyCustomerInvitationDeliveryKeys(
  deliveryIds: readonly string[],
  keyring: CustomerInvitationDeliveryKeyring = customerInvitationDeliveryKeyring,
): void {
  for (const deliveryId of deliveryIds) keyring.destroy(deliveryId);
}

/** Erases expired ciphertext before any worker or rekey path may decrypt it. */
export async function purgeExpiredCustomerInvitationEnvelopes(
  executor: Executor = db,
): Promise<number> {
  const changed = await executor
    .update(delivery)
    .set({
      state: "suppressed",
      envelope: null,
      credentialHash: null,
      ownerId: null,
      leaseId: null,
      leaseExpiresAt: null,
      terminalCode: "expired",
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        inArray(delivery.state, ["queued", "sending"]),
        isNotNull(delivery.envelope),
        lte(delivery.expiresAt, sql`now()`),
      ),
    )
    .returning({ id: delivery.id });
  destroyCustomerInvitationDeliveryKeys(changed.map(({ id }) => id));
  return changed.length;
}

/** Counts expired ciphers only; callers expose the number and never read their contents. */
export async function countExpiredCustomerInvitationEnvelopes(
  executor: Executor = db,
): Promise<number> {
  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(delivery)
    .where(
      and(isNotNull(delivery.envelope), lte(delivery.expiresAt, sql`now()`)),
    );
  return Number(row?.count ?? 0);
}

/** Removes old terminal queue metadata without touching live invitation rows. */
export async function purgeTerminalCustomerInvitationDeliveries(
  executor: Executor = db,
): Promise<number> {
  const deleted = await executor.execute(sql`
    WITH eligible AS (
      SELECT id
        FROM customer_invitation_delivery
       WHERE state IN ('sent', 'suppressed', 'failed')
         AND updated_at <= now() - INTERVAL '30 days'
       ORDER BY updated_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT ${BATCH_SIZE * 20}
    )
    DELETE FROM customer_invitation_delivery AS d
     USING eligible
     WHERE d.id = eligible.id
     RETURNING d.id
  `);
  return deleted.rows.length;
}

/** Claims a bounded batch with SKIP LOCKED and a per-row fencing UUID. */
export async function claimCustomerInvitationDeliveries(): Promise<
  DeliveryClaim[]
> {
  const activeDeliveryIds =
    customerInvitationDeliveryKeyring.activeOwnedUnexpiredIds();
  if (activeDeliveryIds.length === 0) return [];

  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: delivery.id, invitationId: delivery.invitationId })
      .from(delivery)
      .where(
        and(
          or(
            and(
              eq(delivery.state, "queued"),
              lte(delivery.nextAttemptAt, sql`now()`),
            ),
            and(
              eq(delivery.state, "sending"),
              lte(delivery.leaseExpiresAt, sql`now()`),
            ),
          ),
          lte(delivery.attempts, MAX_ATTEMPTS),
          sql`${delivery.expiresAt} > now() + INTERVAL '5 seconds'`,
          eq(delivery.ownerId, customerInvitationDeliveryKeyring.ownerId),
          inArray(delivery.id, activeDeliveryIds),
        ),
      )
      .orderBy(asc(delivery.nextAttemptAt), asc(delivery.id))
      // Keep the lock footprint bounded; inactive key reservations are excluded by the
      // process-local active-ID filter above, so this limit cannot starve later live keys.
      .limit(BATCH_SIZE * 10)
      .for("update", { skipLocked: true });

    const claims: DeliveryClaim[] = [];
    for (const candidate of candidates) {
      if (claims.length >= BATCH_SIZE) break;
      if (
        !customerInvitationDeliveryKeyring.hasActiveKey(
          candidate.id,
          customerInvitationDeliveryKeyring.ownerId,
        )
      )
        continue;
      const leaseId = randomUUID();
      const [updated] = await tx
        .update(delivery)
        .set({
          state: "sending",
          attempts: sql`${delivery.attempts} + CASE WHEN ${delivery.attempts} < ${MAX_ATTEMPTS} THEN 1 ELSE 0 END`,
          leaseId,
          leaseExpiresAt: sql`now() + INTERVAL '40 seconds'`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(delivery.id, candidate.id))
        .returning({ id: delivery.id });
      if (updated)
        claims.push({
          id: updated.id,
          invitationId: candidate.invitationId,
          leaseId,
        });
    }
    return claims;
  });
}

export const CUSTOMER_INVITATION_DELIVERY_MAX_ATTEMPTS = MAX_ATTEMPTS;
