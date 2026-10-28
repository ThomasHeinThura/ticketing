import type { Transaction } from "../database/executor";

/**
 * The one system-actor entry point into the workflow transition path (`WF-19` scheduled
 * transitions, `WF-21` customer reopen). It is a port: the implementation must live next to
 * `transitionWorkItem` (`work-item/controllers/transition-work-item.ts`) so the lock, guard,
 * effect, SLA settlement, activity, audit and event logic is shared and never copied. Until the
 * coordinator applies that change (see the handback patch) no executor is registered, and every
 * caller fails closed: scheduled rows stay `pending`, a reopen falls back to the flagged
 * activity row `WF-21` requires.
 *
 * Contract for an executor:
 * - runs as `actorType: "system"`, `actorId: null`; bypasses role legality only;
 * - locks the work item first, then re-checks `expectedFromStateId` (`left_state` if moved) and
 *   that the item and project are live (`unavailable`);
 * - refuses any edge needing approval or CAB (`blocked`);
 * - for `scheduled`, the hop is the concrete `fromStateId -> toStateId` (no template lookup);
 *   `claim` runs inside the same transaction right after the lock and re-check, and returning
 *   false aborts with `left_state` so a row is fired at most once;
 * - for `reopen`, executes the workflow version's single `is_reopen` edge (`none` if absent).
 */
export type SystemTransitionRequest =
  | {
      kind: "scheduled";
      workItemId: string;
      fromStateId: string;
      toStateId: string;
      claim: (tx: Transaction) => Promise<boolean>;
    }
  | { kind: "reopen"; workItemId: string };

export type SystemTransitionOutcome =
  | { kind: "applied" }
  | { kind: "left_state" }
  | { kind: "unavailable" }
  | { kind: "blocked"; reason: string }
  | { kind: "none" };

export type SystemTransitionExecutor = (
  request: SystemTransitionRequest,
) => Promise<SystemTransitionOutcome>;

let executor: SystemTransitionExecutor | null = null;

export function setSystemTransitionExecutor(
  next: SystemTransitionExecutor | null,
): void {
  executor = next;
}

export function getSystemTransitionExecutor(): SystemTransitionExecutor | null {
  return executor;
}
