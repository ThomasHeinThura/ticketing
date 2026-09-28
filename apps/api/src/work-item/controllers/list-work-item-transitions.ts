import {
  filterOfferableForType,
  legalTransitions,
  offerTransition,
  resolveStateTemplateForProject,
  type TransitionOfferContext,
} from "@taskdesk/domain";
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
  blockedBy: { kind: string; reasonCode: string }[];
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
): Promise<WorkItemTransitionOffer[]> {
  const ctx = await loadWorkflowTransitionContext(workItemId);
  if (!ctx || !ctx.activeVersion) {
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
  const offerContext: TransitionOfferContext = {
    ...guardContext,
    // Issue #442's own documented interim rule (until #36's `approval` table lands):
    // both gates are unconditionally unsatisfied whenever the transition sets them.
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
    const offer = offerTransition(transition, offerContext);
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
      blockedBy: offer.blockedBy,
    });
  }
  return results;
}

export default listWorkItemTransitions;
