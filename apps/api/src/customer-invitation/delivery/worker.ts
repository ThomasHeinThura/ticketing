import { and, eq, sql } from "drizzle-orm";
import { appendAuditLog } from "../../audit/audit-writer";
import db, { schema } from "../../database";
import type { Executor } from "../../database/executor";
import { customerInvitationDeliveryTable } from "../../database/schema-customer-invitation-delivery";
import {
  isEmailProviderConfigured,
  sendCustomerInvitationEmail,
} from "../mailer";
import { decryptDeliveryEnvelope } from "./envelope";
import { customerInvitationDeliveryKeyring } from "./keyring";
import {
  claimCustomerInvitationDeliveries,
  type DeliveryClaim,
  destroyCustomerInvitationDeliveryKeys,
  purgeExpiredCustomerInvitationEnvelopes,
  purgeTerminalCustomerInvitationDeliveries,
} from "./repository";

const delivery = customerInvitationDeliveryTable;
const SMTP_DEADLINE_MS = 5_000;
const MIN_REMAINING_MS = SMTP_DEADLINE_MS;
const BACKOFF_SECONDS = [30, 90] as const;

type ProcessResult = "sent" | "retry" | "failed" | "suppressed" | "stale";

async function clockMilliseconds(tx: Executor): Promise<number> {
  const result = await tx.execute(sql`SELECT clock_timestamp() AS now`);
  const value = (result.rows[0] as { now?: Date | string } | undefined)?.now;
  if (!value) throw new Error("Database clock unavailable");
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

async function suppress(
  tx: Executor,
  id: string,
  reason: "expired" | "revoked" | "accepted" | "superseded",
) {
  await tx
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
    .where(eq(delivery.id, id));
}

async function renewDeliveryLease(
  tx: Executor,
  claim: DeliveryClaim,
): Promise<boolean> {
  const [renewed] = await tx
    .update(delivery)
    .set({
      leaseExpiresAt: sql`clock_timestamp() + INTERVAL '40 seconds'`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(delivery.id, claim.id),
        eq(delivery.state, "sending"),
        eq(delivery.leaseId, claim.leaseId),
        sql`${delivery.leaseExpiresAt} > clock_timestamp()`,
      ),
    )
    .returning({ id: delivery.id });
  return renewed !== undefined;
}

async function finishFailure(
  tx: Executor,
  input: {
    claim: DeliveryClaim;
    invitation: typeof schema.invitationTable.$inferSelect;
    attempt: number;
    resend: boolean;
    code: "provider_rejected" | "envelope_unavailable";
    nowMs: number;
    expiresAt: Date;
  },
): Promise<ProcessResult> {
  const remaining = Math.min(
    input.expiresAt.getTime() - input.nowMs,
    customerInvitationDeliveryKeyring.remainingMs(
      input.claim.id,
      customerInvitationDeliveryKeyring.ownerId,
    ),
  );
  const retryDelay = BACKOFF_SECONDS[input.attempt - 1];
  if (
    retryDelay !== undefined &&
    input.attempt < 3 &&
    remaining > retryDelay * 1000 + MIN_REMAINING_MS
  ) {
    await tx
      .update(delivery)
      .set({
        state: "queued",
        nextAttemptAt: sql`clock_timestamp() + (${retryDelay} * INTERVAL '1 second')`,
        leaseId: null,
        leaseExpiresAt: null,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(delivery.id, input.claim.id),
          eq(delivery.state, "sending"),
          eq(delivery.leaseId, input.claim.leaseId),
        ),
      );
    return "retry";
  }

  const terminalCode = input.attempt >= 3 ? "retry_exhausted" : input.code;
  await tx
    .update(delivery)
    .set({
      state: "failed",
      envelope: null,
      credentialHash: null,
      ownerId: null,
      leaseId: null,
      leaseExpiresAt: null,
      terminalCode,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(delivery.id, input.claim.id),
        eq(delivery.state, "sending"),
        eq(delivery.leaseId, input.claim.leaseId),
      ),
    );
  await appendAuditLog(tx, {
    actorId: input.invitation.inviterId,
    actorType: "person",
    workspaceId: input.invitation.workspaceId,
    organisationId: input.invitation.organisationId,
    action: "invitation.sent",
    entityType: "invitation",
    entityId: input.invitation.id,
    before: null,
    after: {
      scope: "customer",
      resend: input.resend,
      delivery: "failed",
      code: terminalCode,
    },
  });
  return "failed";
}

/**
 * Locks the invitation before the delivery row, the same order as revoke/resend/accept. The
 * bounded SMTP send remains inside these locks so a committed revoke or superseding resend wins
 * before delivery, and a send already in progress finishes before that mutation commits.
 */
async function processClaim(claim: DeliveryClaim): Promise<ProcessResult> {
  const result = await db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.id, claim.invitationId))
      .for("update")
      .limit(1);
    if (!invitation) return "stale";

    const [queued] = await tx
      .select()
      .from(delivery)
      .where(eq(delivery.id, claim.id))
      .for("update")
      .limit(1);
    if (queued?.state !== "sending" || queued.leaseId !== claim.leaseId)
      return "stale";

    const nowMs = await clockMilliseconds(tx);
    const expiration = queued.expiresAt.getTime();
    if (expiration <= nowMs) {
      await suppress(tx, queued.id, "expired");
      return "suppressed";
    }
    if (expiration - nowMs < MIN_REMAINING_MS) {
      await suppress(tx, queued.id, "expired");
      return "suppressed";
    }
    if (invitation.status !== "pending") {
      await suppress(
        tx,
        queued.id,
        invitation.status === "accepted" ? "accepted" : "revoked",
      );
      return "suppressed";
    }
    if (
      invitation.expiresAt.getTime() <= nowMs ||
      invitation.credentialHash === null ||
      invitation.credentialHash !== queued.credentialHash
    ) {
      await suppress(
        tx,
        queued.id,
        invitation.expiresAt.getTime() <= nowMs ? "expired" : "superseded",
      );
      return "suppressed";
    }
    if (queued.attempts >= 3)
      return finishFailure(tx, {
        claim,
        invitation,
        attempt: queued.attempts,
        resend: queued.resend,
        code: "provider_rejected",
        nowMs,
        expiresAt: queued.expiresAt,
      });
    if (
      !queued.envelope ||
      !queued.credentialHash ||
      queued.ownerId !== customerInvitationDeliveryKeyring.ownerId
    ) {
      await tx
        .update(delivery)
        .set({
          state: "failed",
          envelope: null,
          credentialHash: null,
          ownerId: null,
          leaseId: null,
          leaseExpiresAt: null,
          terminalCode: "envelope_unavailable",
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(delivery.id, queued.id));
      return "failed";
    }
    const deliveryOwnerId = queued.ownerId;

    let credential: string;
    let ephemeralKeyId: string;
    try {
      const decrypted = decryptDeliveryEnvelope({
        deliveryId: queued.id,
        invitationId: invitation.id,
        credentialHash: queued.credentialHash,
        envelope: queued.envelope,
        ownerId: deliveryOwnerId,
      });
      credential = decrypted.credential;
      ephemeralKeyId = decrypted.keyId;
    } catch {
      return finishFailure(tx, {
        claim,
        invitation,
        attempt: queued.attempts,
        resend: queued.resend,
        code: "envelope_unavailable",
        nowMs,
        expiresAt: queued.expiresAt,
      });
    }

    const [context] = await tx
      .select({
        organisationName: schema.organisationTable.name,
        inviterName: schema.userTable.name,
        inviterEmail: schema.userTable.email,
      })
      .from(schema.organisationTable)
      .innerJoin(
        schema.userTable,
        eq(schema.userTable.id, invitation.inviterId),
      )
      .where(eq(schema.organisationTable.id, invitation.organisationId ?? ""))
      .limit(1);
    if (!context)
      return finishFailure(tx, {
        claim,
        invitation,
        attempt: queued.attempts,
        resend: queued.resend,
        code: "provider_rejected",
        nowMs,
        expiresAt: queued.expiresAt,
      });

    let sent: boolean | "expired" = false;
    const preSendBlocked: { reason: "expired" | "stale" | null } = {
      reason: null,
    };
    if (
      queued.expiresAt.getTime() - (await clockMilliseconds(tx)) <
      MIN_REMAINING_MS
    ) {
      await suppress(tx, queued.id, "expired");
      return "suppressed";
    }
    try {
      sent = await sendCustomerInvitationEmail(
        {
          invitationId: invitation.id,
          email: invitation.email,
          organisationName: context.organisationName,
          inviterName: context.inviterName,
          inviterEmail: context.inviterEmail,
          credential,
        },
        {
          deadlineMs: SMTP_DEADLINE_MS,
          idempotencyKey: `customer-invitation-delivery:${queued.id}`,
          beforeSend: async () => {
            if (!(await renewDeliveryLease(tx, claim))) {
              preSendBlocked.reason = "stale";
              return false;
            }
            if (
              queued.expiresAt.getTime() - (await clockMilliseconds(tx)) <=
                MIN_REMAINING_MS ||
              customerInvitationDeliveryKeyring.remainingMs(
                queued.id,
                deliveryOwnerId,
                ephemeralKeyId,
              ) <= MIN_REMAINING_MS
            ) {
              preSendBlocked.reason = "expired";
              return false;
            }
            return true;
          },
        },
      );
    } catch {
      sent = false;
    }
    if (preSendBlocked.reason === "stale") return "stale";
    if (preSendBlocked.reason === "expired" || sent === "expired") {
      await suppress(tx, queued.id, "expired");
      return "suppressed";
    }
    if (!sent)
      return finishFailure(tx, {
        claim,
        invitation,
        attempt: queued.attempts,
        resend: queued.resend,
        code: "provider_rejected",
        nowMs: await clockMilliseconds(tx),
        expiresAt: queued.expiresAt,
      });

    await tx
      .update(delivery)
      .set({
        state: "sent",
        envelope: null,
        credentialHash: null,
        ownerId: null,
        leaseId: null,
        leaseExpiresAt: null,
        terminalCode: "sent",
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(delivery.id, queued.id),
          eq(delivery.state, "sending"),
          eq(delivery.leaseId, claim.leaseId),
        ),
      );
    return "sent";
  });
  if (result !== "retry") destroyCustomerInvitationDeliveryKeys([claim.id]);
  return result;
}

/** One-minute bounded worker. Expiry cleanup runs even when SMTP is not configured. */
export async function runCustomerInvitationDeliveryJob(): Promise<{
  claimed: number;
  sent: number;
  failed: number;
  degraded: boolean;
}> {
  let degraded = false;
  await purgeExpiredCustomerInvitationEnvelopes();
  await purgeTerminalCustomerInvitationDeliveries();
  if (!(await isEmailProviderConfigured()))
    return { claimed: 0, sent: 0, failed: 0, degraded: false };

  const claims = await claimCustomerInvitationDeliveries();
  let sent = 0;
  let failed = 0;
  for (const claim of claims) {
    try {
      const result = await processClaim(claim);
      if (result === "sent") sent += 1;
      if (result === "failed") failed += 1;
    } catch {
      degraded = true;
      // Do not include provider errors, queue payloads, or recipient data in logs.
      console.error("Customer invitation delivery attempt failed");
    }
  }
  return { claimed: claims.length, sent, failed, degraded };
}
