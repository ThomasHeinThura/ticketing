import { processNextParentEvent } from "../events/outbox-consumer";
import { immediateNotificationRuntime } from "../notification/immediate-runtime";
import { processNextNotificationDelivery } from "../notification/outbox-drain";
import { assertJobExecutionOwned } from "./leader-lock";
import { drainNotificationDigests } from "./notification-digest";
import { drainP4Consumers } from "./outbox-drain-p4";

/** Every replica may run: persisted child reservation fences serialize attempts. Parent
 * event consumer state is independent and is never terminalized by one child's result. */
export async function drainImmediateNotifications(budgetMs = 20_000) {
  let processed = 0;
  let degraded = false;
  const runtime = immediateNotificationRuntime();
  const started = Date.now();
  for (; processed < 100 && Date.now() - started < budgetMs; processed++) {
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

/** Parent envelopes per run and their wall-clock budget. */
export const PARENT_DRAIN_LIMIT = 100;
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
  for (
    ;
    processed < PARENT_DRAIN_LIMIT &&
    Date.now() - started < PARENT_DRAIN_BUDGET_MS;
    processed++
  ) {
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
 * Reserve time for digest and P4 work while keeping existing per-drain limits.
 * An in-flight provider call is allowed to finish after its budget expires.
 */
export async function drainOutbox() {
  const startedAt = Date.now();
  await assertJobExecutionOwned();
  const digests = await drainNotificationDigests({ budgetMs: 10_000 });
  await assertJobExecutionOwned();
  const parents = await drainParentEvents();
  await assertJobExecutionOwned();
  // The P4 webhook and automation drains have 8 s and 5 s budgets respectively.
  const children = await drainImmediateNotifications(
    Math.max(0, Math.min(20_000, 29_000 - (Date.now() - startedAt) - 13_000)),
  );
  await assertJobExecutionOwned();
  const consumers = await drainP4Consumers();
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
