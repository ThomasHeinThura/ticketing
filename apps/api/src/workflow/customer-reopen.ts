import { eq } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import { instanceSettingTable, workItemTable } from "../database/schema";
import { recordWorkItemActivity } from "../work-item/activity";
import { getSystemTransitionExecutor } from "./system-transition";

/**
 * `WF-21` / `CP-8`: the one mechanism behind every customer-initiated reopen (a reply to a
 * closed request, an upload to a resolved one, the portal reopen action). It executes the
 * workflow's single `is_reopen` edge as a system actor through the shared transition port. If
 * that cannot happen — the active version has no reopen edge, the edge is blocked (approval,
 * guard), the reopen window has passed, or no executor is registered — the customer's action
 * is still accepted and the item stays resolved; a flagged (internal) activity row asks staff
 * to look. Never throws for a reopen refusal: the caller's own write has already succeeded.
 */

export const DEFAULT_REOPEN_WINDOW_DAYS = 14;

export type CustomerReopenSource = "reply" | "upload" | "portal_reopen";

export type CustomerReopenResult =
  | { kind: "reopened" }
  | { kind: "not_closed" }
  | { kind: "flagged"; reason: string };

export function isWithinReopenWindow(
  resolvedAt: Date,
  now: Date,
  windowDays: number,
): boolean {
  return now.getTime() - resolvedAt.getTime() <= windowDays * 86_400_000;
}

/**
 * `WF-21`: the durable record of a customer's reopen request, written inside the caller's own
 * transaction (the reply). `activity` is append-only, so this row can never be superseded: it
 * uses its own non-warning verb (`reopen_received`) and the staff-facing warning verb
 * `reopen_requested` is written only post-commit, once, when the reopen is refused. If the
 * process dies before the reopen runs, staff still see this internal marker (without a flag).
 */
export const REOPEN_RECEIVED_VERB = "reopen_received";

export async function recordReopenRequested(
  tx: Executor,
  input: {
    workspaceId: string;
    workItemId: string;
    source: CustomerReopenSource;
  },
): Promise<void> {
  await recordWorkItemActivity(tx, [
    {
      workspaceId: input.workspaceId,
      workItemId: input.workItemId,
      actorId: null,
      actorType: "system",
      verb: REOPEN_RECEIVED_VERB,
      payload: { source: input.source },
      visibility: "internal",
    },
  ]);
}

export async function requestCustomerReopen(input: {
  workItemId: string;
  source: CustomerReopenSource;
  now?: Date;
}): Promise<CustomerReopenResult> {
  const now = input.now ?? new Date();
  const [item] = await db
    .select({
      workspaceId: workItemTable.workspaceId,
      resolvedAt: workItemTable.resolvedAt,
    })
    .from(workItemTable)
    .where(eq(workItemTable.id, input.workItemId))
    .limit(1);
  if (!item?.resolvedAt) return { kind: "not_closed" };
  const [setting] = await db
    .select({ days: instanceSettingTable.reopenWindowDays })
    .from(instanceSettingTable)
    .limit(1);
  const windowDays = setting?.days ?? DEFAULT_REOPEN_WINDOW_DAYS;

  let reason: string | null = null;
  if (!isWithinReopenWindow(item.resolvedAt, now, windowDays)) {
    reason = "outside_reopen_window";
  } else {
    const executor = getSystemTransitionExecutor();
    if (!executor) reason = "reopen_unavailable";
    else {
      try {
        const outcome = await executor({
          kind: "reopen",
          workItemId: input.workItemId,
        });
        if (outcome.kind === "applied") return { kind: "reopened" };
        reason =
          outcome.kind === "none"
            ? "no_reopen_transition"
            : outcome.kind === "blocked"
              ? "reopen_blocked"
              : "reopen_not_applied";
      } catch {
        reason = "reopen_failed";
      }
    }
  }
  await recordWorkItemActivity(db, [
    {
      workspaceId: item.workspaceId,
      workItemId: input.workItemId,
      actorId: null,
      actorType: "system",
      verb: "reopen_requested",
      payload: { source: input.source, reason },
      // Internal by CA-7 (an unmapped verb): staff-facing flag only.
      visibility: "internal",
    },
  ]);
  return { kind: "flagged", reason };
}
