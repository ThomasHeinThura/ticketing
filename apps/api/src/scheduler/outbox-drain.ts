import { processNextParentEvent } from "../events/outbox-consumer";
import { immediateNotificationRuntime } from "../notification/immediate-runtime";
import { processNextNotificationDelivery } from "../notification/outbox-drain";
import { drainP4Consumers } from "./outbox-drain-p4";

/** Every replica may run: persisted child reservation fences serialize attempts. Parent
 * event consumer state is independent and is never terminalized by one child's result. */
export async function drainImmediateNotifications() {
  let processed = 0;
  let degraded = false;
  const runtime = immediateNotificationRuntime();
  const started = Date.now();
  for (; processed < 100 && Date.now() - started < 20_000; processed++) {
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

/** Parent envelopes per run, and the wall-clock budget for them (the run fires every 30 s and
 * the child drain keeps its own 100-item / 20 s budget). */
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
 * The registered `outbox-drain` body: parents first, then immediate notification children, then
 * the webhook deliveries and automation runs the P4 parent consumers enqueued.
 */
export async function drainOutbox() {
  const startedAt = Date.now();
  const parents = await drainParentEvents();
  const children = await drainImmediateNotifications();
  const consumers = await drainP4Consumers();
  const degraded = parents.degraded || children.degraded || consumers.degraded;
  if (parents.processed > 0 || children.processed > 0 || degraded) {
    console.log(
      JSON.stringify({
        job: "outbox-drain",
        durationMs: Date.now() - startedAt,
        parents,
        children,
        consumers,
        outcome: degraded ? "degraded" : "ok",
      }),
    );
  }
  return { parents, children, consumers, degraded };
}
