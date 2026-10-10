import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  loadApprovalAddressing,
  loadApprovalTargetByApprovalId,
  loadApprovalTargetByKey,
  resolveApprovalIdentityIfActive,
} from "./repository";

/**
 * Row evidence for strict policy enforcement (`apps/api/src/permissions/
 * strict-policy-enforcement.ts`), supplied the same way `requireWorkItemReach` does it for
 * work-item routes: the middleware loads the persisted row and publishes its workspace,
 * project and work item with `workspaceIdSource: "row"`. It decides nothing itself; every
 * handler keeps its own checks. A missing or unreachable row is the same 404 the handler
 * would give, so the evidence step never reveals another workspace's approval.
 */
function publish(
  c: Context,
  target: Awaited<ReturnType<typeof loadApprovalTargetByKey>>,
) {
  c.set("workspaceId", target.workspaceId);
  c.set("workspaceIdSource", "row");
  c.set("workItemId", target.workItemId);
  c.set("projectId", target.projectId);
  c.set("policyScopeResource", "work_item");
}

/** `/work-items/{key}/approvals`: evidence from the addressed work item. */
export function approvalWorkItemEvidence() {
  return async (c: Context, next: Next) => {
    const key = c.req.param("key");
    if (!key) throw new HTTPException(404, { message: "Work item not found" });
    publish(c, await loadApprovalTargetByKey(key));
    await next();
  };
}

/**
 * `/approvals/{id}/*`: evidence from the approval's own anchored `workspace_id` and its work
 * item. With `portal: true` it also publishes the `addressed_approval` predicate: a customer
 * session deciding a customer approval addressed to that person.
 */
export function approvalIdEvidence(options: { portal?: boolean } = {}) {
  return async (c: Context, next: Next) => {
    const id = c.req.param("id");
    const userId = c.get("userId") as string | undefined;
    if (!id || !userId) {
      throw new HTTPException(404, { message: "Approval not found" });
    }
    const identity = await resolveApprovalIdentityIfActive(userId);
    if (!identity) {
      throw new HTTPException(401, { message: "Authentication required" });
    }
    const target = await loadApprovalTargetByApprovalId(id, identity);
    if (!target)
      throw new HTTPException(404, { message: "Approval not found" });
    publish(c, target);
    if (options.portal) {
      const addressing = await loadApprovalAddressing(id, target.workspaceId);
      c.set(
        "portalPredicateSatisfied",
        identity.side === "customer" &&
          addressing?.kind === "customer" &&
          addressing.approverId === identity.personId,
      );
    }
    await next();
  };
}

/** `GET /portal/approvals`: the list is always scoped to the caller's own addressed rows. */
export function portalListEvidence() {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId") as string | undefined;
    const identity = userId
      ? await resolveApprovalIdentityIfActive(userId)
      : null;
    c.set("portalPredicateSatisfied", identity?.side === "customer");
    await next();
  };
}
