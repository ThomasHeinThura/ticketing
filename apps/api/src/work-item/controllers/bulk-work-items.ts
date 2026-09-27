import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import type { ActivityActorType } from "../activity";
import { type AssignWorkItemInput, assignWorkItem } from "./assign-work-item";
import { deleteWorkItem } from "./delete-work-item";

// #23's fourth slice: `POST /api/work-items/bulk` (`work_item:read` at the workspace
// level per the spec's own route table, "then each item is re-checked against its own
// capability; failures reported per WI-25").
//
// SCOPE, a judgment call flagged in the PR body. `WI-24` names six-plus bulk operations
// (change state, assign, set priority, add/remove label, archive, delete, plus
// cycle/module behind `feature.cycles`). Of those, only TWO have any underlying
// single-item mechanism already built in this codebase: assign (`assign-work-item.ts`,
// #30) and delete (`delete-work-item.ts`, this same PR). State transition, label
// add/remove and archive have NO route or write path anywhere yet -- building any of
// them here would be inventing a whole separate mechanism this bounded task was not
// asked for. Bulk `set_priority` is deliberately NOT included either, even though the
// single-item PATCH route supports it: that route's `WI-7` version-checked write has no
// per-item version in a bulk request to check against, and applying it unconditionally
// would silently bypass the concurrency control every other write in this domain
// respects -- narrower than guessing at a new "bulk ignores versions" rule.
// So this endpoint supports exactly `"delete"` and `"assign"` today; the rest are
// deferred, named explicitly here and in the PR body, not silently dropped.
//
// PER-ITEM AUTHORIZATION (the task's own explicit ask: "the SAME authorization check
// applied to every individual item in the batch, not just a check on the endpoint
// itself"). This codebase's capability model (`requireWorkspaceCapability`) is
// WORKSPACE-ROLE-based, not a per-row ACL -- a caller either holds `work_item:delete`/
// `work_item:assign` in a workspace or does not, uniformly across every row in it. So
// the capability half of "the same check" is genuinely a single check against the
// caller's role in the ONE workspace this request is scoped to (`index.ts`'s handler
// does this before calling into this module). The per-ITEM dimension that actually
// varies row-by-row is REACH -- whether a given id is even IN that workspace at all --
// and that check runs inside `assignWorkItem`/`deleteWorkItem` for every single id,
// exactly like a single-item call would, giving the identical "not found" answer for a
// nonexistent id and a real id from another workspace (`WI-25`: "a failure reason must
// not reveal whether an inaccessible work item exists").
//
// TRANSACTION SHAPE (`WI-25`): "transactional per item, not per batch: 47 of 50
// succeeding reports 3 failures with reasons rather than rolling everything back."
// `assignWorkItem`/`deleteWorkItem` each open their OWN transaction per call -- looping
// over ids and awaiting each one gives exactly this shape for free, with no batch-level
// transaction wrapping the loop.
//
// `WI-27`: "one audit row per item plus one summary row." The per-item audit rows
// (`work_item.deleted`/`work_item.assigned`) are already written inside
// `deleteWorkItem`/`assignWorkItem`; this module adds the one summary row
// (`bulk.performed`, already in `audit/actions.ts`'s `AUDIT_ONLY_ACTIONS`) after the
// loop finishes.

export type BulkWorkItemOperation =
  | { operation: "delete" }
  | { operation: "assign"; assigneeId: string };

export type BulkWorkItemFailure = { id: string; reason: string };

export type BulkWorkItemResult = {
  succeeded: string[];
  failed: BulkWorkItemFailure[];
};

async function runOne(
  id: string,
  workspaceId: string,
  actorId: string,
  actorType: ActivityActorType,
  op: BulkWorkItemOperation,
): Promise<void> {
  if (op.operation === "delete") {
    await deleteWorkItem(id, workspaceId, actorId, actorType);
    return;
  }
  const input: AssignWorkItemInput = { assigneeId: op.assigneeId };
  await assignWorkItem(id, workspaceId, actorId, actorType, null, input);
}

export async function bulkWorkItems(
  workspaceId: string,
  actorId: string,
  actorType: ActivityActorType,
  workItemKeys: string[],
  op: BulkWorkItemOperation,
): Promise<BulkWorkItemResult> {
  const succeeded: string[] = [];
  const failed: BulkWorkItemFailure[] = [];

  for (const key of workItemKeys) {
    try {
      await runOne(key, workspaceId, actorId, actorType, op);
      succeeded.push(key);
    } catch (error) {
      if (error instanceof HTTPException) {
        const body = error.message || (await error.getResponse().text());
        failed.push({ id: key, reason: body || "failed" });
      } else {
        failed.push({ id: key, reason: "failed" });
      }
    }
  }

  await appendAuditLog(db, {
    actorId,
    actorType,
    workspaceId,
    action: "bulk.performed",
    entityType: "workspace",
    entityId: workspaceId,
    before: null,
    after: {
      operation: op.operation,
      requested: workItemKeys.length,
      succeeded: succeeded.length,
      failed: failed.length,
    },
  });

  return { succeeded, failed };
}

export default bulkWorkItems;
