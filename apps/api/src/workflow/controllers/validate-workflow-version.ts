import {
  asStateTemplateId,
  noOutboundStateIds,
  rolesWithNoLegalTransition,
  type StateTemplateId,
  unreachableStates,
  validateProjectStateSelection,
  type WorkflowState,
  type WorkflowTransition,
} from "@taskdesk/domain";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import {
  findWorkflowVersionId,
  findWorkflowWorkspaceId,
  hasCompleteWorkflowProjectReach,
  listDefaultStateTemplates,
  listEnabledProjectStates,
  listLiveItemsWithStateTemplate,
  listReferenceableRoleIds,
  listStateTemplates,
  listVersionTransitions,
  listWorkflowAdoptingProjectIds,
} from "../repository";

export type WorkflowVersionProjectValidation = {
  projectId: string;
  valid: boolean;
  errors: string[];
  refusedStateTemplateIds: string[];
  stuckWorkItemKeys: string[];
};

export type WorkflowVersionValidationResult = {
  valid: boolean;
  unreachableStateTemplateIds: string[];
  noOutboundStateTemplateIds: string[];
  rolesWithNoLegalTransition: string[];
  projects: WorkflowVersionProjectValidation[];
};

/**
 * `POST /api/workflows/{id}/versions/{n}/validate` (`workflows.md` § Screens, "Workflow
 * editor" validation panel). A thin wrapper: every check below is `packages/domain`'s
 * own, already-tested pure function -- this route only loads the facts and reports what
 * they find, the same "declared target, real runtime check" split
 * `create-workflow-version.ts` already uses for `validateWorkflowVersion`.
 *
 * WF-9 requires complete access to the existing adopting-project set. The repository
 * checks that set with a scalar SQL refusal query before returning any project/item data.
 */
export async function validateWorkflowVersion(
  identity: ResolvedIdentity,
  workflowId: string,
  number: number,
): Promise<WorkflowVersionValidationResult> {
  const workflow = await findWorkflowWorkspaceId(identity, workflowId);
  if (!workflow) {
    throw new HTTPException(404, { message: "Workflow not found" });
  }

  const version = await findWorkflowVersionId(identity, workflowId, number);
  if (!version) {
    throw new HTTPException(404, { message: "Workflow version not found" });
  }

  if (!(await hasCompleteWorkflowProjectReach(identity, workflowId))) {
    throw new HTTPException(403, {
      message: "Workflow project access required",
    });
  }

  const templateRows = await listStateTemplates(identity, workflow.workspaceId);
  const states: WorkflowState[] = templateRows.map((row) => ({
    id: asStateTemplateId(row.id),
    group: row.group as WorkflowState["group"],
  }));

  const transitionRows = await listVersionTransitions(identity, version.id);
  const transitions: WorkflowTransition[] = transitionRows.map((row) => ({
    id: row.id,
    fromStateTemplateId:
      row.fromStateTemplateId === null
        ? null
        : asStateTemplateId(row.fromStateTemplateId),
    toStateTemplateId: asStateTemplateId(row.toStateTemplateId),
    roleId: row.roleId,
    notePolicy: row.notePolicy as WorkflowTransition["notePolicy"],
    noteVisibility: row.noteVisibility as WorkflowTransition["noteVisibility"],
    requiresApproval: row.requiresApproval,
    approvalPolicy: row.approvalPolicy as WorkflowTransition["approvalPolicy"],
    requiresCab: row.requiresCab,
    isReopen: row.isReopen,
    guards: row.guards as WorkflowTransition["guards"],
    effects: row.effects as WorkflowTransition["effects"],
  }));

  const roleRows = await listReferenceableRoleIds(
    identity,
    workflow.workspaceId,
  );
  const roleIds = roleRows.map((r) => r.id);

  const noOutboundIds = noOutboundStateIds(states, transitions);
  const noOutboundIdSet = new Set(noOutboundIds);

  const projects: WorkflowVersionProjectValidation[] = [];
  let unreachableIds: StateTemplateId[] = [];

  // WF-9's adopting-project set is every project in this workflow's workspace,
  // including projects with no work items and archived projects.
  const adoptingProjectRows = await listWorkflowAdoptingProjectIds(
    identity,
    workflowId,
  );
  const projectIds = adoptingProjectRows.map((r) => r.projectId);

  if (projectIds.length > 0) {
    // Every adopting project's own default state's TEMPLATE -- `unreachableStates`'
    // own `initialStateIds` argument (WF-9's own reasoning: reachability is checked
    // from wherever a new work item can actually start, across every project, not one
    // arbitrary project).
    const defaultStateRows = await listDefaultStateTemplates(
      identity,
      projectIds,
    );
    const initialStateIds = [
      ...new Set(
        defaultStateRows.map((r) => asStateTemplateId(r.stateTemplateId)),
      ),
    ];
    unreachableIds = unreachableStates(states, transitions, initialStateIds);

    for (const projectId of projectIds) {
      const enabledRows = await listEnabledProjectStates(identity, projectId);
      const enabledStateIds = enabledRows.map((r) =>
        asStateTemplateId(r.stateTemplateId),
      );
      const defaultRow = enabledRows.find((r) => r.isDefault);
      const defaultStateId = defaultRow
        ? asStateTemplateId(defaultRow.stateTemplateId)
        : null;

      const projectResult = validateProjectStateSelection(
        transitions,
        enabledStateIds,
        defaultStateId,
      );

      // `WF-9`: work items currently sitting in a template this version has no
      // outbound transition from -- stuck.
      const stuckRows =
        noOutboundIdSet.size === 0
          ? []
          : await listLiveItemsWithStateTemplate(identity, projectId);
      const stuckWorkItemKeys = stuckRows
        .filter((row) =>
          noOutboundIdSet.has(asStateTemplateId(row.stateTemplateId)),
        )
        .map((row) => row.key);

      projects.push({
        projectId,
        valid: projectResult.valid && stuckWorkItemKeys.length === 0,
        errors: projectResult.errors,
        refusedStateTemplateIds: projectResult.refusedStateIds,
        stuckWorkItemKeys,
      });
    }
  }

  const roleIdsWithNoLegalTransition = rolesWithNoLegalTransition(
    transitions,
    roleIds,
  );

  const valid =
    unreachableIds.length === 0 &&
    noOutboundIds.length === 0 &&
    roleIdsWithNoLegalTransition.length === 0 &&
    projects.every((p) => p.valid);

  return {
    valid,
    unreachableStateTemplateIds: unreachableIds,
    noOutboundStateTemplateIds: noOutboundIds,
    rolesWithNoLegalTransition: roleIdsWithNoLegalTransition,
    projects,
  };
}

export default validateWorkflowVersion;
