import { and, eq, isNull, sql } from "drizzle-orm";
import type { Transaction } from "../database/executor";
import { webhookDeliveryTable, webhookTable } from "../database/schema";
import type {
  ParentEventConsumer,
  ParentEventEnvelope,
} from "../events/outbox-consumer";
import { isWebhookEventKey } from "./constants";

/**
 * The webhook parent-event consumer (`WH-3`). It runs inside the outbox claim transaction, so it
 * performs **no network I/O**: it only records one pending `webhook_delivery` per subscribed,
 * active webhook of the event's workspace. The signed POST is made later by
 * `processNextWebhookDelivery` (`./delivery.ts`), which owns retries, history and auto-disable.
 *
 * Idempotency (`EV-2`): the partial unique index `webhook_delivery_event_unique`
 * (`webhook_id`, `event_id` where `source = 'event'`) makes a re-drained parent a no-op, so a
 * replay never produces a second delivery.
 *
 * Instance-scoped envelopes (empty `scope`) are never visible to workspace consumers
 * (`events.md`), so they are skipped here.
 */
export async function enqueueWebhookDeliveries(
  tx: Transaction,
  envelope: ParentEventEnvelope,
): Promise<number> {
  // Keep this consumer native-only even if a corrupt stored subscription contains a
  // published legacy compatibility string.
  if (!isWebhookEventKey(envelope.kind)) return 0;
  const scope = envelope.scope as { workspaceId?: string; projectId?: string };
  if (!scope.workspaceId) return 0;
  const hooks = await tx
    .select({ id: webhookTable.id })
    .from(webhookTable)
    .where(
      and(
        eq(webhookTable.workspaceId, scope.workspaceId),
        eq(webhookTable.active, true),
        isNull(webhookTable.disabledAt),
        sql`${envelope.kind} = ANY(${webhookTable.events})`,
      ),
    );
  if (hooks.length === 0) return 0;
  const inserted = await tx
    .insert(webhookDeliveryTable)
    .values(
      hooks.map((hook) => ({
        webhookId: hook.id,
        workspaceId: scope.workspaceId as string,
        eventId: envelope.id,
        eventKind: envelope.kind,
        source: "event",
        projectId: scope.projectId ?? null,
        state: "pending",
      })),
    )
    .onConflictDoNothing()
    .returning({ id: webhookDeliveryTable.id });
  return inserted.length;
}

export const webhookParentConsumer: ParentEventConsumer = {
  name: "webhook",
  handles: (kind) => isWebhookEventKey(kind),
  async handle(tx, envelope) {
    await enqueueWebhookDeliveries(tx, envelope);
  },
};
