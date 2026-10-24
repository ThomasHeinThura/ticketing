import { randomUUID } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  outboxTable,
  projectTable,
  webhookDeliveryTable,
  webhookTable,
  workItemTable,
} from "../database/schema";
import { appendAuditSavepoint } from "../events/audit-savepoint";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import { parseParentEnvelope } from "../events/outbox-consumer";
import { fenceLegalHolds } from "../scheduler/soft-delete-purge.repository";
import { scopedRowUnderOpenHold } from "../utils/legal-hold-scope";
import {
  WEBHOOK_AUTO_DISABLE_AFTER_MS,
  WEBHOOK_DELIVERY_RETENTION_DAYS,
  WEBHOOK_EVENT_KEYS,
  WEBHOOK_LEASE_MS,
  webhookRetryDelayMs,
} from "./constants";
import { type InternalEnvelope, projectWebhookEnvelope } from "./envelope";
import { decideOwnerReach } from "./reach";
import {
  type WebhookDeliveryRow,
  type WebhookRow,
  webhookSigningSecrets,
} from "./repository";
import { sendWebhookRequest, type WebhookSendResult } from "./safe-http";
import { buildWebhookHeaders } from "./signature";

/**
 * The webhook delivery worker (`outbox-drain` step; `background-jobs.md`). One call claims at
 * most one due delivery, so every replica may run it concurrently (`SKIP LOCKED` + lease).
 *
 * Network I/O never happens while a database lock is held: the claim commits (with a lease and
 * the attempt counter already incremented), the POST runs, and the outcome is recorded with a
 * fence on the lease token. A worker that dies mid-send leaves a lease that expires, after which
 * the delivery is claimed again and counts as another attempt; consumers deduplicate on the
 * event id (`X-TaskDesk-Delivery` carries the delivery id).
 */

export type WebhookDrainResult =
  | { kind: "idle" }
  | {
      kind: "delivered" | "retry" | "dead" | "skipped" | "cancelled";
      deliveryId: string;
    };

export type AttemptOutcome =
  | { state: "delivered" }
  | { state: "pending"; delayMs: number }
  | { state: "dead" };

/** Pure: what happens to a delivery after attempt number `attempt` finished. */
export function outcomeAfterAttempt(
  attempt: number,
  success: boolean,
): AttemptOutcome {
  if (success) return { state: "delivered" };
  const delayMs = webhookRetryDelayMs(attempt);
  return delayMs === null ? { state: "dead" } : { state: "pending", delayMs };
}

export type StreakDecision = {
  failingSince: Date | null;
  /** True when the 24-hour continuous-failure window has just been exceeded (`WH-7`). */
  autoDisable: boolean;
};

/** Pure: the `WH-7` continuous-failure window. A success always clears it. */
export function nextFailureStreak(input: {
  failingSince: Date | null;
  success: boolean;
  now: Date;
}): StreakDecision {
  if (input.success) return { failingSince: null, autoDisable: false };
  const since = input.failingSince ?? input.now;
  return {
    failingSince: since,
    autoDisable:
      input.now.getTime() - since.getTime() >= WEBHOOK_AUTO_DISABLE_AFTER_MS,
  };
}

function instanceUrl(): string {
  return (process.env.TASKDESK_AGENT_URL || "http://localhost:5173").replace(
    /\/+$/,
    "",
  );
}

async function claimDelivery(
  onlyId?: string,
): Promise<WebhookDeliveryRow | undefined> {
  const leaseToken = randomUUID();
  const idFilter = onlyId ? sql`AND "id" = ${onlyId}` : sql``;
  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE "webhook_delivery"
    SET "attempt" = "attempt" + 1,
        "lease_token" = ${leaseToken},
        "lease_expires_at" = now() + make_interval(secs => ${WEBHOOK_LEASE_MS / 1000}::float8)
    WHERE "id" = (
      SELECT "id" FROM "webhook_delivery"
      WHERE "state" = 'pending'
        AND "next_attempt_at" <= now()
        AND ("lease_expires_at" IS NULL OR "lease_expires_at" < now())
        ${idFilter}
      ORDER BY "next_attempt_at" ASC, "id" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"
  `);
  const id = claimed.rows[0]?.id;
  if (!id) return undefined;
  const [row] = await db
    .select()
    .from(webhookDeliveryTable)
    .where(eq(webhookDeliveryTable.id, id))
    .limit(1);
  return row;
}

/** Finishes a delivery without an HTTP attempt (skipped / cancelled), fenced on the lease. */
async function finishWithoutSend(
  delivery: WebhookDeliveryRow,
  state: "skipped_out_of_reach" | "cancelled",
  error: string | null,
): Promise<void> {
  await db
    .update(webhookDeliveryTable)
    .set({
      state,
      error,
      attemptedAt: new Date(),
      leaseToken: null,
      leaseExpiresAt: null,
      // Nothing was sent, so this does not count as an attempt.
      attempt: Math.max(0, delivery.attempt - 1),
      ...(state === "skipped_out_of_reach" ? { requestBody: null } : {}),
    })
    .where(
      and(
        eq(webhookDeliveryTable.id, delivery.id),
        eq(webhookDeliveryTable.leaseToken, delivery.leaseToken ?? ""),
      ),
    );
}

async function pauseWebhook(
  executor: Executor,
  webhook: WebhookRow,
  reason: "owner_left",
): Promise<void> {
  await executor
    .update(webhookTable)
    .set({
      active: false,
      disabledAt: new Date(),
      disabledReason: reason,
      updatedAt: new Date(),
      version: webhook.version + 1,
    })
    .where(and(eq(webhookTable.id, webhook.id), eq(webhookTable.active, true)));
}

/** Loads the outbox envelope for an event-sourced delivery. */
async function loadEnvelope(
  eventId: string,
): Promise<InternalEnvelope | undefined> {
  const [row] = await db
    .select({
      eventId: outboxTable.eventId,
      kind: outboxTable.kind,
      payload: outboxTable.payload,
    })
    .from(outboxTable)
    .where(eq(outboxTable.eventId, eventId))
    .limit(1);
  if (!row) return undefined;
  try {
    return parseParentEnvelope(row) as unknown as InternalEnvelope;
  } catch {
    return undefined;
  }
}

async function buildBody(
  envelope: InternalEnvelope,
  workspaceId: string,
  projectId: string | null,
) {
  const key =
    typeof envelope.payload.key === "string" ? envelope.payload.key : null;
  const isItem =
    envelope.kind.startsWith("work_item.") || envelope.kind.startsWith("sla.");
  const [workItem] =
    isItem && key
      ? await db
          .select({ key: workItemTable.key, title: workItemTable.title })
          .from(workItemTable)
          .where(
            and(
              eq(workItemTable.key, key),
              eq(workItemTable.workspaceId, workspaceId),
            ),
          )
          .limit(1)
      : [];
  const [project] = projectId
    ? await db
        .select({ key: projectTable.slug, name: projectTable.name })
        .from(projectTable)
        .where(
          and(
            eq(projectTable.id, projectId),
            eq(projectTable.workspaceId, workspaceId),
          ),
        )
        .limit(1)
    : [];
  return projectWebhookEnvelope(envelope, {
    instance: instanceUrl(),
    workItem: workItem ?? null,
    project: project ?? null,
  });
}

type SendDeps = {
  send: typeof sendWebhookRequest;
  now: () => Date;
};

const DEFAULT_DEPS: SendDeps = {
  send: sendWebhookRequest,
  now: () => new Date(),
};

async function recordAttempt(
  delivery: WebhookDeliveryRow,
  webhook: WebhookRow,
  result: WebhookSendResult,
  requestBody: unknown,
  now: Date,
): Promise<"delivered" | "retry" | "dead"> {
  const outcome = outcomeAfterAttempt(delivery.attempt, result.success);
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(webhookDeliveryTable)
      .set({
        state: outcome.state,
        statusCode: result.statusCode,
        durationMs: result.durationMs,
        responseBody: result.responseBody,
        error: result.error,
        attemptedAt: now,
        requestBody: requestBody as never,
        leaseToken: null,
        leaseExpiresAt: null,
        ...(outcome.state === "pending"
          ? { nextAttemptAt: new Date(now.getTime() + outcome.delayMs) }
          : {}),
      })
      .where(
        and(
          eq(webhookDeliveryTable.id, delivery.id),
          eq(webhookDeliveryTable.leaseToken, delivery.leaseToken ?? ""),
        ),
      )
      .returning({ id: webhookDeliveryTable.id });
    // Lease lost to another worker: the winner records the outcome.
    if (!updated) return outcome.state === "pending" ? "retry" : outcome.state;

    // A test delivery reports its own result; it never moves the health window.
    if (delivery.source !== "test") {
      const [live] = await tx
        .select()
        .from(webhookTable)
        .where(eq(webhookTable.id, webhook.id))
        .for("update")
        .limit(1);
      if (live) {
        const streak = nextFailureStreak({
          failingSince: live.failingSince,
          success: result.success,
          now,
        });
        const disable = streak.autoDisable && live.active;
        await tx
          .update(webhookTable)
          .set({
            failingSince: streak.failingSince,
            lastError: result.success ? null : (result.error ?? live.lastError),
            ...(disable
              ? {
                  active: false,
                  disabledAt: now,
                  disabledReason: "failing_24h",
                  updatedAt: now,
                  version: live.version + 1,
                }
              : {}),
          })
          .where(eq(webhookTable.id, webhook.id));
        if (disable) {
          await emitAutoDisabled(tx, live, result.error ?? "unknown");
        }
      }
    }
    return outcome.state === "pending" ? "retry" : outcome.state;
  });
}

/** `WH-7`: `webhook.auto_disabled` in the same transaction, plus its audit row. */
async function emitAutoDisabled(
  tx: Executor,
  webhook: WebhookRow,
  lastError: string,
  reason: "failing_24h" | "event_removed" = "failing_24h",
): Promise<void> {
  const [workspace] = await tx
    .execute<{ organisation_id: string | null }>(sql`
    SELECT "organisation_id" FROM "workspace" WHERE "id" = ${webhook.workspaceId}
  `)
    .then((result) => result.rows);
  await enqueueOutboxEvent(tx as never, {
    id: `evt_${createId()}`,
    kind: "webhook.auto_disabled",
    occurredAt: new Date().toISOString(),
    actor: { type: "system", id: null, name: "TaskDesk" },
    scope: eventScope({
      workspaceId: webhook.workspaceId,
      organisationId: workspace?.organisation_id ?? null,
      projectId: null,
    }),
    payload: {
      key: webhook.id,
      url: `/agent/settings/integrations/webhooks/${webhook.id}`,
      webhookId: webhook.id,
      ownerPersonId: webhook.createdBy,
      lastError,
    },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  });
  await appendAuditSavepoint(tx, {
    actorId: null,
    actorType: "system",
    workspaceId: webhook.workspaceId,
    action: "webhook.auto_disabled",
    entityType: "webhook",
    entityId: webhook.id,
    after: { reason, lastError },
  });
}

/** Claims and processes at most one due webhook delivery. */
export async function processNextWebhookDelivery(
  deps: SendDeps = DEFAULT_DEPS,
  onlyId?: string,
): Promise<WebhookDrainResult> {
  const delivery = await claimDelivery(onlyId);
  if (!delivery) return { kind: "idle" };

  const [webhook] = await db
    .select()
    .from(webhookTable)
    .where(eq(webhookTable.id, delivery.webhookId))
    .limit(1);
  if (!webhook || !webhook.active || webhook.disabledAt) {
    await finishWithoutSend(delivery, "cancelled", "webhook_inactive");
    return { kind: "cancelled", deliveryId: delivery.id };
  }

  let requestBody: unknown = delivery.requestBody;
  if (delivery.source !== "test") {
    // Event deliveries are built on the first attempt; retries, redeliveries and automation
    // calls reuse the stored body. All are reach-checked **now**, against the owner's current
    // reach (WH-14).
    const needsEnvelope = delivery.source === "event" && requestBody == null;
    const envelope = needsEnvelope
      ? await loadEnvelope(delivery.eventId)
      : undefined;
    if (needsEnvelope && !envelope) {
      await finishWithoutSend(delivery, "cancelled", "event_unavailable");
      return { kind: "cancelled", deliveryId: delivery.id };
    }
    if (
      delivery.source === "event" &&
      !webhook.events.includes(delivery.eventKind)
    ) {
      await finishWithoutSend(delivery, "cancelled", "event_not_subscribed");
      return { kind: "cancelled", deliveryId: delivery.id };
    }
    const projectId = delivery.projectId ?? envelope?.scope.projectId ?? null;
    const decision = await decideOwnerReach(db, webhook.createdBy, {
      workspaceId: webhook.workspaceId,
      projectId,
      workItemEvent:
        delivery.eventKind.startsWith("work_item.") ||
        delivery.eventKind.startsWith("sla."),
    });
    if (decision.kind === "owner_gone") {
      await pauseWebhook(db, webhook, "owner_left");
      await finishWithoutSend(delivery, "cancelled", "owner_left");
      return { kind: "cancelled", deliveryId: delivery.id };
    }
    if (decision.kind === "out_of_reach") {
      await finishWithoutSend(delivery, "skipped_out_of_reach", null);
      return { kind: "skipped", deliveryId: delivery.id };
    }
    if (envelope && requestBody == null) {
      const projected = await buildBody(
        envelope,
        webhook.workspaceId,
        projectId,
      );
      if (projected.kind === "nothing_visible") {
        await finishWithoutSend(delivery, "cancelled", "no_visible_changes");
        return { kind: "cancelled", deliveryId: delivery.id };
      }
      requestBody = projected.body;
    }
  }
  if (requestBody === null || requestBody === undefined) {
    await finishWithoutSend(delivery, "cancelled", "no_payload");
    return { kind: "cancelled", deliveryId: delivery.id };
  }

  const now = deps.now();
  const rawBody = JSON.stringify(requestBody);
  let result: WebhookSendResult;
  try {
    const secrets = webhookSigningSecrets(webhook);
    const headers = buildWebhookHeaders({
      rawBody,
      secret: secrets.secret,
      secretPrevious: secrets.secretPrevious,
      secretRotatedAt: webhook.secretRotatedAt,
      eventKind: delivery.eventKind,
      deliveryId: delivery.id,
      now,
    });
    result = await deps.send({ url: webhook.url, headers, rawBody });
  } catch {
    result = {
      statusCode: null,
      durationMs: 0,
      responseBody: null,
      error: "request_failed",
      success: false,
    };
  }
  const state = await recordAttempt(
    delivery,
    webhook,
    result,
    requestBody,
    deps.now(),
  );
  return { kind: state, deliveryId: delivery.id };
}

/** Delivers one specific queued delivery now (Send test event, manual redelivery). */
export function deliverWebhookNow(deliveryId: string) {
  return processNextWebhookDelivery(DEFAULT_DEPS, deliveryId);
}

/**
 * "Webhook created for an event later removed: auto-disabled, owner notified." A subscription to a
 * key that is no longer deliverable can never fire; the webhook is paused with a reason and the
 * owner is told through `webhook.auto_disabled`, rather than silently sitting idle.
 */
export async function disableWebhooksWithRemovedEvents(): Promise<number> {
  const known: ReadonlySet<string> = new Set(WEBHOOK_EVENT_KEYS);
  // Webhooks are few (a per-organisation quota), so the comparison is done here rather than in
  // SQL: no string-built query, and the allow-list stays one constant.
  const active = await db
    .select({ id: webhookTable.id, events: webhookTable.events })
    .from(webhookTable)
    .where(eq(webhookTable.active, true))
    .limit(5_000);
  const stale = active
    .filter((hook) => hook.events.some((event) => !known.has(event)))
    .slice(0, 20);
  let disabled = 0;
  for (const { id } of stale) {
    await db.transaction(async (tx) => {
      const [live] = await tx
        .select()
        .from(webhookTable)
        .where(and(eq(webhookTable.id, id), eq(webhookTable.active, true)))
        .for("update")
        .limit(1);
      if (!live) return;
      const now = new Date();
      await tx
        .update(webhookTable)
        .set({
          active: false,
          disabledAt: now,
          disabledReason: "event_removed",
          lastError: "event_removed",
          updatedAt: now,
          version: live.version + 1,
        })
        .where(eq(webhookTable.id, id));
      await emitAutoDisabled(tx, live, "event_removed", "event_removed");
      disabled++;
    });
  }
  return disabled;
}

export const WEBHOOK_DRAIN_LIMIT = 25;
export const WEBHOOK_DRAIN_BUDGET_MS = 8_000;

/** The `outbox-drain` webhook step: bounded by count and wall-clock. */
export async function drainWebhookDeliveries() {
  let processed = 0;
  let delivered = 0;
  let retried = 0;
  let dead = 0;
  let degraded = false;
  const started = Date.now();
  for (
    ;
    processed < WEBHOOK_DRAIN_LIMIT &&
    Date.now() - started < WEBHOOK_DRAIN_BUDGET_MS;
    processed++
  ) {
    try {
      const result = await processNextWebhookDelivery();
      if (result.kind === "idle") break;
      if (result.kind === "delivered") delivered++;
      if (result.kind === "retry") {
        retried++;
        degraded = true;
      }
      if (result.kind === "dead") {
        dead++;
        degraded = true;
      }
    } catch {
      degraded = true;
      break;
    }
  }
  try {
    await purgeExpiredDeliveriesOpportunistically();
  } catch {
    degraded = true;
  }
  return { processed, delivered, retried, dead, degraded };
}

let lastPurgeAt = 0;

/**
 * `data-model.md`: `webhook_delivery` is retained for 30 days. Run at most hourly per process
 * from the drain; a bounded delete, so it is safe on every replica.
 */
export async function purgeExpiredDeliveriesOpportunistically(
  nowMs = Date.now(),
): Promise<number> {
  if (nowMs - lastPurgeAt < 3_600_000) return 0;
  lastPurgeAt = nowMs;
  await disableWebhooksWithRemovedEvents();
  return purgeExpiredWebhookDeliveries(new Date(nowMs));
}

export async function purgeExpiredWebhookDeliveries(
  now: Date,
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - WEBHOOK_DELIVERY_RETENTION_DAYS * 86_400_000,
  );
  // Retention obeys legal holds: a row whose workspace, project or work-item people are under an
  // open hold is kept until the hold lifts. The share lock fences a hold placed mid-purge.
  const deleted = await db.transaction(async (tx) => {
    await fenceLegalHolds(tx);
    return tx
      .delete(webhookDeliveryTable)
      .where(
        and(
          lt(webhookDeliveryTable.createdAt, cutoff),
          isNull(webhookDeliveryTable.leaseToken),
          sql`${webhookDeliveryTable.state} <> 'pending'`,
          sql`NOT ${scopedRowUnderOpenHold({
            workspaceId: sql`${webhookDeliveryTable.workspaceId}`,
            projectId: sql`${webhookDeliveryTable.projectId}`,
            workItemId: null,
          })}`,
        ),
      )
      .returning({ id: webhookDeliveryTable.id });
  });
  return deleted.length;
}
