import {
  filterOfferableForType,
  isGateSatisfied,
  legalTransitions,
  offerTransition,
  resolveStateTemplateForProject,
  type TransitionOfferContext,
} from "@taskdesk/domain";
import { listApprovalsForWorkItemTransition } from "../../approval/repository";
import {
  buildGuardContext,
  loadWorkflowTransitionContext,
  resolveActorRoleIds,
} from "../workflow-transition-context";

export type WorkItemTransitionOffer = {
  transitionId: string;
  toStateTemplateId: string;
  toStateId: string;
  notePolicy: "none" | "optional" | "required";
  noteVisibility: "public" | "internal";
  requiresApproval: boolean;
  requiresCab: boolean;
  isReopen: boolean;
  available: boolean;
  blockedBy: {
    kind: string;
    reasonCode: string;
    pendingApprovals?: Array<{
      approverName: string | null;
      requestedAt: string;
      expiresAt: string;
    }>;
  }[];
};

/**
 * `GET /api/work-items/{key}/transitions` (`workflows.md` § "The state select"):
 * "returns exactly what this actor may do now, with reasons for anything blocked." The
 * UI never computes legality client-side.
 *
 * Illegal transitions (wrong role, wrong current-state, a CAB-only edge on a non-change
 * type, or a target template this project has no concrete state for -- `WF-2`'s own
 * "filtered out of GET /transitions") are absent entirely, never shown disabled --
 * exactly `offerTransition`'s own doc comment: legality is decided by
 * `legalTransitions`/`filterOfferableForType` before this function ever runs, and only
 * transitions that pass BOTH are offered (possibly disabled with a reason).
 *
 * `hasNote: false` throughout -- this is a read, before any note has been supplied, so a
 * `notePolicy: required` transition is correctly shown available: false,
 * blockedBy: [{kind: "note", reasonCode: "note.required"}] until the actor supplies one
 * on the `POST /transition` call.
 */
export async function listWorkItemTransitions(
  workItemId: string,
  personId: string | null,
  personSide: string | null = null,
): Promise<WorkItemTransitionOffer[]> {
  const ctx = await loadWorkflowTransitionContext(workItemId);
  if (!ctx?.activeVersion) {
    return [];
  }

  const actorRoleIds = await resolveActorRoleIds(
    personId,
    ctx.workItem.workspaceId,
    ctx.workItem.projectId,
  );
  const legal = legalTransitions(
    ctx.transitions,
    ctx.currentStateTemplateId,
    actorRoleIds,
  );
  const offerable = filterOfferableForType(legal, ctx.isChangeType);

  const guardContext = await buildGuardContext(ctx);
  const approvals = offerable.some(
    (transition) => transition.requiresApproval || transition.requiresCab,
  )
    ? (await listApprovalsForWorkItemTransition(ctx.workItem.id)).map(
        (row) => ({
          ...row,
          kind: row.kind as "customer" | "cab",
          state: row.state as
            | "pending"
            | "approved"
            | "rejected"
            | "expired"
            | "withdrawn",
        }),
      )
    : [];
  const approvalDetails =
    personSide === "staff"
      ? approvals
      : personSide === "customer" && personId
        ? approvals.filter(
            (row) =>
              row.requestedBy === personId || row.approverId === personId,
          )
        : [];
  const offerContext: TransitionOfferContext = {
    ...guardContext,
    // Each transition-specific gate is applied below from this actor-independent state.
    approvalSatisfied: false,
    cabSatisfied: false,
    hasNote: false,
  };

  const results: WorkItemTransitionOffer[] = [];
  for (const transition of offerable) {
    const resolution = resolveStateTemplateForProject(
      transition.toStateTemplateId,
      ctx.adoptedStates,
    );
    if (!resolution.ok) {
      // `WF-2`: this project has no concrete state for the target template -- not
      // offered at all, the same treatment an illegal transition gets.
      continue;
    }
    const policy = transition.approvalPolicy ?? "any";
    const transitionOfferContext = {
      ...offerContext,
      approvalSatisfied: transition.requiresApproval
        ? isGateSatisfied(approvals, { transitionId: transition.id, policy })
        : true,
      cabSatisfied: transition.requiresCab
        ? isGateSatisfied(approvals, {
            transitionId: transition.id,
            kind: "cab",
            policy,
          })
        : true,
    };
    const offer = offerTransition(transition, transitionOfferContext);
    const pendingApprovals = approvalDetails
      .filter(
        (approval) =>
          approval.transitionId === transition.id &&
          approval.state === "pending",
      )
      .map((approval) => ({
        kind: approval.kind,
        approverName: approval.approverName,
        requestedAt: approval.createdAt.toISOString(),
        expiresAt: approval.expiresAt.toISOString(),
      }));
    results.push({
      transitionId: transition.id,
      toStateTemplateId: transition.toStateTemplateId,
      toStateId: resolution.stateId,
      notePolicy: transition.notePolicy,
      noteVisibility: transition.noteVisibility,
      requiresApproval: transition.requiresApproval,
      requiresCab: transition.requiresCab,
      isReopen: transition.isReopen,
      available: offer.available,
      blockedBy: offer.blockedBy.map((reason) => {
        const waiting =
          reason.kind === "cab"
            ? pendingApprovals.filter((approval) => approval.kind === "cab")
            : pendingApprovals;
        return (reason.kind === "approval" || reason.kind === "cab") &&
          waiting.length > 0
          ? {
              ...reason,
              pendingApprovals: waiting.map(
                ({ kind: _kind, ...details }) => details,
              ),
            }
          : reason;
      }),
    });
  }
  return results;
}

export default listWorkItemTransitions;
