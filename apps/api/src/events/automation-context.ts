import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Loop-protection context for automation actions (`EV-3`, `AM-5`).
 *
 * An automation action runs the same domain code a person's request would (assign, comment,
 * transition ...), and that code writes its own outbox event with `depth: 0`,
 * `causationId: null`, `originAutomationId: null`. Rather than thread three extra parameters
 * through every producer, the executor runs each action inside `runAsAutomation`, and
 * `enqueueOutboxEvent` stamps the active context onto the envelope it persists: `depth` becomes
 * the triggering event's depth plus one, `causationId` the triggering event id and
 * `originAutomationId` the rule. A person's request has no context and is untouched.
 */
export type AutomationEventContext = {
  automationId: string;
  /** Named on every event the rule produces: attributed to the rule, never to a person (`AM-4`). */
  automationName: string;
  /** Depth every event produced under this context carries (trigger depth + 1). */
  depth: number;
  /** The event that triggered the rule. */
  causationId: string;
};

const storage = new AsyncLocalStorage<AutomationEventContext>();

export function runAsAutomation<T>(
  context: AutomationEventContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

export function currentAutomationContext(): AutomationEventContext | undefined {
  return storage.getStore();
}

/** `EV-3`: no rule fires on an event this deep or deeper. */
export const AUTOMATION_MAX_DEPTH = 5;

export type TriggerGuard = "ok" | "self_origin" | "depth_exceeded";

/**
 * Pure loop guard. `self_origin`: the event was produced by this very rule's own action
 * (`AM-5`), skipped silently. `depth_exceeded`: the chain has run `AUTOMATION_MAX_DEPTH` hops
 * and is abandoned with a recorded error. A depth-4 event may still fire (its products are
 * depth 5); a depth-5 event may not.
 */
export function guardAutomationTrigger(input: {
  automationId: string;
  eventDepth: number;
  eventOriginAutomationId: string | null;
}): TriggerGuard {
  if (input.eventOriginAutomationId === input.automationId)
    return "self_origin";
  if (input.eventDepth >= AUTOMATION_MAX_DEPTH) return "depth_exceeded";
  return "ok";
}
