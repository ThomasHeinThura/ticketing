/**
 * The P4 parent-consumer steps of `outbox-drain` (`background-jobs.md`: "handles webhook
 * deliveries and auto-disables a webhook failing for 24 h"). The parent consumers only enqueue
 * (`webhook_delivery`, `automation_run`), so the work they enqueued is claimed here, after the
 * parent envelopes have been drained. Every replica may run this concurrently: both steps claim
 * with `SKIP LOCKED` or an advisory lock and a lease. A failure in one step never stops the other.
 */
import { assertJobExecutionOwned } from "./leader-lock";

export async function drainP4Consumers() {
  let degraded = false;
  const outcome: {
    webhooks: Record<string, unknown> | null;
    automations: Record<string, unknown> | null;
  } = { webhooks: null, automations: null };
  await assertJobExecutionOwned();
  try {
    const { drainWebhookDeliveries } = await import("../webhook/delivery");
    const webhooks = await drainWebhookDeliveries();
    outcome.webhooks = webhooks;
    if (webhooks.degraded) degraded = true;
  } catch {
    degraded = true;
  }
  // Webhook draining may consume the run's remaining work lease. Check only at
  // this boundary, before starting the independent automation drain.
  await assertJobExecutionOwned();
  try {
    const { drainAutomationRuns } = await import("../automation/executor");
    const automations = await drainAutomationRuns();
    outcome.automations = automations;
    if (automations.degraded) degraded = true;
  } catch {
    degraded = true;
  }
  return { ...outcome, degraded };
}
