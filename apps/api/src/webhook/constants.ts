/**
 * Webhook constants (`feature-contracts-p4.md` "Webhooks and API keys").
 *
 * The deliverable events are the **W** column of the events.md Catalogue. That column also marks
 * a handful of instance-oriented events (a pending-action decision, SCIM/identity provisioning)
 * whose payloads are not about a workspace work surface and whose envelopes may carry an empty
 * scope; those are never delivered to a workspace endpoint (`events.md`: instance-scoped events
 * are not visible to workspace-scoped consumers), so they are excluded here and the doc-sync test
 * (`tests/api/webhook/webhook-events.test.ts`) pins the exclusion list in both directions.
 */
export const WEBHOOK_EVENT_KEYS = [
  "work_item.created",
  "work_item.updated",
  "work_item.transitioned",
  "work_item.assigned",
  "work_item.unassigned",
  "work_item.commented",
  "work_item.escalated",
  "work_item.overdue",
  "work_item.deleted",
  "work_item.unblocked",
  "sla.at_risk",
  "sla.breached",
  "sla.met",
  "sla.missed",
  "approval.requested",
  "approval.decided",
  "approval.expired",
  "approval.withdrawn",
  "submission.received",
  "submission.accepted",
  "submission.declined",
  "submission.withdrawn",
  "project.created",
  "project.archived",
  "prerequisite.overdue",
  "budget.threshold_reached",
] as const;

export type WebhookEventKey = (typeof WEBHOOK_EVENT_KEYS)[number];

/** W-column events deliberately not offered to workspace webhooks (see the file comment). */
export const WEBHOOK_EXCLUDED_W_EVENT_KEYS = [
  "pending_action.decided",
  "pending_action.executed",
  "identity.provisioned",
  "identity.deprovisioned",
  "identity_connection.changed",
] as const;

const EVENT_KEY_SET: ReadonlySet<string> = new Set(WEBHOOK_EVENT_KEYS);

export function isWebhookEventKey(value: string): value is WebhookEventKey {
  return EVENT_KEY_SET.has(value);
}

/** `WH-4`: 30 s, 2 m, 10 m, 1 h, 6 h, 24 h; dead after six attempts. */
export const WEBHOOK_ATTEMPT_LIMIT = 6;
export const WEBHOOK_RETRY_DELAYS_MS = [
  30_000, 120_000, 600_000, 3_600_000, 21_600_000, 86_400_000,
] as const;

/**
 * Delay before the next attempt after attempt `attempt` (1-based) failed, or `null` once the
 * attempt limit is reached and the delivery is dead. Six attempts in total (`WH-4`), the same
 * reading the notification schedule uses.
 */
export function webhookRetryDelayMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError("Webhook attempt must be a positive integer");
  }
  if (attempt >= WEBHOOK_ATTEMPT_LIMIT) return null;
  return WEBHOOK_RETRY_DELAYS_MS[attempt - 1] ?? null;
}

/** `WH-5`: ten-second whole-request deadline. */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** Response bodies are kept for the delivery history, truncated. */
export const WEBHOOK_RESPONSE_BODY_LIMIT = 2_048;

/** `WH-7`: continuous failure for this long auto-disables the webhook. */
export const WEBHOOK_AUTO_DISABLE_AFTER_MS = 24 * 60 * 60 * 1000;

/** `WH-13`: the previous secret keeps signing for 24 hours after a rotation. */
export const WEBHOOK_SECRET_OVERLAP_MS = 24 * 60 * 60 * 1000;

/** `data-model.md`: `webhook_delivery` is retained for 30 days. */
export const WEBHOOK_DELIVERY_RETENTION_DAYS = 30;

/** A claimed delivery holds its lease this long; the HTTP deadline is well inside it. */
export const WEBHOOK_LEASE_MS = 60_000;

/** `organisation_quota.max_webhooks` default when the organisation has no quota row. */
export const DEFAULT_MAX_WEBHOOKS = 10;

export const WEBHOOK_HEADER_SIGNATURE = "X-TaskDesk-Signature";
export const WEBHOOK_HEADER_SIGNATURE_PREVIOUS =
  "X-TaskDesk-Signature-Previous";
export const WEBHOOK_HEADER_EVENT = "X-TaskDesk-Event";
export const WEBHOOK_HEADER_DELIVERY = "X-TaskDesk-Delivery";
export const WEBHOOK_HEADER_TIMESTAMP = "X-TaskDesk-Timestamp";

/** Delivery states a row can hold; mirrors `webhook_delivery_state_allowed`. */
export const WEBHOOK_DELIVERY_STATES = [
  "pending",
  "delivered",
  "dead",
  "skipped_out_of_reach",
  "cancelled",
] as const;
export type WebhookDeliveryState = (typeof WEBHOOK_DELIVERY_STATES)[number];

/** Why a webhook is paused (`webhook.disabled_reason`). */
export const WEBHOOK_DISABLE_REASONS = [
  "manual",
  "failing_24h",
  "owner_left",
  "event_removed",
] as const;
export type WebhookDisableReason = (typeof WEBHOOK_DISABLE_REASONS)[number];
