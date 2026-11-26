import { processNextParentEvent } from "../events/outbox-consumer";
import { immediateNotificationRuntime } from "../notification/immediate-runtime";
import { processNextNotificationDelivery } from "../notification/outbox-drain";
import { assertJobExecutionOwned } from "./leader-lock";
import { drainNotificationDigests } from "./notification-digest";
import { drainP4Consumers } from "./outbox-drain-p4";

/** Every replica may run: persisted child reservation fences serialize attempts. Parent
 * event consumer state is independent and is never terminalized by one child's result.
 * Deliveries drain one at a time until the queue is idle or the budget is used. */
export async function drainImmediateNotifications(budgetMs = 20_000) {
  let processed = 0;
  let degraded = false;
  const runtime = immediateNotificationRuntime();
  const started = Date.now();
  for (; Date.now() - started < budgetMs; processed++) {
    // Each call claims and completes one independently fenced delivery. Do not
    // interrupt the provider/claim completion pair once it has started.
    await assertJobExecutionOwned();
    try {
      const result = await processNextNotificationDelivery(runtime);
      if (result.kind === "idle") break;
      if (result.kind === "retry" || result.kind === "unresolved")
        degraded = true;
    } catch {
      degraded = true;
      break;
    }
  }
  return { processed, degraded };
}

/** Wall-clock budget for parent envelopes per run; the loop also ends on an idle queue. */
export const PARENT_DRAIN_BUDGET_MS = 5_000;

/**
 * Parent event envelopes (`EV-1`/`EV-2`). Independent `SKIP LOCKED` claims, so every replica
 * may run this concurrently. A retried or dead-lettered parent marks the run degraded.
 */
export async function drainParentEvents() {
  let processed = 0;
  let delivered = 0;
  let retried = 0;
  let dead = 0;
  let degraded = false;
  const started = Date.now();
  for (; Date.now() - started < PARENT_DRAIN_BUDGET_MS; processed++) {
    // Parent claims are independent SKIP LOCKED work units.
    await assertJobExecutionOwned();
    try {
      const result = await processNextParentEvent();
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
  return { processed, delivered, retried, dead, degraded };
}

/**
 * Keep parents, immediate notifications, and P4 consumers ahead of batched digests,
 * giving digests up to 10 s of remaining tick budget. An in-flight provider call is
 * allowed to finish after its budget expires.
 */
export async function drainOutbox() {
  const startedAt = Date.now();
  await assertJobExecutionOwned();
  const parents = await drainParentEvents();
  await assertJobExecutionOwned();
  // Reserve 13 s for P4 consumers (8 s webhooks + 5 s automations) plus a 2 s digest floor.
  const children = await drainImmediateNotifications(
    Math.max(0, Math.min(20_000, 29_000 - (Date.now() - startedAt) - 15_000)),
  );
  await assertJobExecutionOwned();
  const consumers = await drainP4Consumers();
  await assertJobExecutionOwned();
  const digests = await drainNotificationDigests({
    budgetMs: Math.max(0, Math.min(10_000, 29_000 - (Date.now() - startedAt))),
  });
  const degraded =
    digests.degraded ||
    parents.degraded ||
    children.degraded ||
    consumers.degraded;
  if (
    digests.processed > 0 ||
    parents.processed > 0 ||
    children.processed > 0 ||
    degraded
  ) {
    console.log(
      JSON.stringify({
        job: "outbox-drain",
        durationMs: Date.now() - startedAt,
        digests,
        parents,
        children,
        consumers,
        outcome: degraded ? "degraded" : "ok",
      }),
    );
  }
  return { digests, parents, children, consumers, degraded };
}
