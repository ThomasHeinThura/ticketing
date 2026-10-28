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
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import type { ResolveIdentityInput } from "../../permissions/resolve-identity";
import { resolveIdentity } from "../../permissions/resolve-identity";
import { listLiveProjectReachFacts } from "../../user-preference/repository";
import {
  findWorkflowVersionId,
  findWorkflowWorkspaceId,
  hasCompleteWorkflowProjectReach,
  listActiveWorkflowWorkspaceUserIds,
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
  affected: { people: number; workItems: number; projects: number };
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
  identityInput: ResolveIdentityInput,
  workflowId: string,
  number: number,
): Promise<WorkflowVersionValidationResult> {
  return db.transaction(
    async (tx) => {
      const identity = await resolveIdentity(identityInput, tx);
      if (!identity) throw new HTTPException(403, { message: "Forbidden" });
      const workflow = await findWorkflowWorkspaceId(identity, workflowId, tx);
      if (!workflow) {
        throw new HTTPException(404, { message: "Workflow not found" });
      }

      const version = await findWorkflowVersionId(
        identity,
        workflowId,
        number,
        tx,
      );
      if (!version) {
        throw new HTTPException(404, { message: "Workflow version not found" });
      }

      if (!(await hasCompleteWorkflowProjectReach(identity, workflowId, tx))) {
        throw new HTTPException(403, {
          message: "Workflow project access required",
        });
      }

      const templateRows = await listStateTemplates(
        identity,
        workflow.workspaceId,
        tx,
      );
      const states: WorkflowState[] = templateRows.map((row) => ({
        id: asStateTemplateId(row.id),
        group: row.group as WorkflowState["group"],
      }));

      const transitionRows = await listVersionTransitions(
        identity,
        version.id,
        tx,
      );
      const transitions: WorkflowTransition[] = transitionRows.map((row) => ({
        id: row.id,
        fromStateTemplateId:
          row.fromStateTemplateId === null
            ? null
            : asStateTemplateId(row.fromStateTemplateId),
        toStateTemplateId: asStateTemplateId(row.toStateTemplateId),
        roleId: row.roleId,
        notePolicy: row.notePolicy as WorkflowTransition["notePolicy"],
        noteVisibility:
          row.noteVisibility as WorkflowTransition["noteVisibility"],
        requiresApproval: row.requiresApproval,
        approvalPolicy:
          row.approvalPolicy as WorkflowTransition["approvalPolicy"],
        requiresCab: row.requiresCab,
        isReopen: row.isReopen,
        guards: row.guards as WorkflowTransition["guards"],
        effects: row.effects as WorkflowTransition["effects"],
      }));

      const roleRows = await listReferenceableRoleIds(
        identity,
        workflow.workspaceId,
        tx,
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
        tx,
      );
      const projectIds = adoptingProjectRows.map((r) => r.projectId);
      let affectedWorkItems = 0;

      if (projectIds.length > 0) {
        // Every adopting project's own default state's TEMPLATE -- `unreachableStates`'
        // own `initialStateIds` argument (WF-9's own reasoning: reachability is checked
        // from wherever a new work item can actually start, across every project, not one
        // arbitrary project).
        const defaultStateRows = await listDefaultStateTemplates(
          identity,
          projectIds,
          tx,
        );
        const initialStateIds = [
          ...new Set(
            defaultStateRows.map((r) => asStateTemplateId(r.stateTemplateId)),
          ),
        ];
        unreachableIds = unreachableStates(
          states,
          transitions,
          initialStateIds,
        );

        for (const projectId of projectIds) {
          const enabledRows = await listEnabledProjectStates(
            identity,
            projectId,
            tx,
          );
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
          const liveRows = await listLiveItemsWithStateTemplate(
            identity,
            projectId,
            tx,
          );
          affectedWorkItems += liveRows.length;
          const stuckRows = noOutboundIdSet.size === 0 ? [] : liveRows;
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

      const candidateProjectIds = adoptingProjectRows.map(
        (row) => row.projectId,
      );
      const activeStaffUserIds = await listActiveWorkflowWorkspaceUserIds(
        tx,
        workflow.workspaceId,
      );
      const affectedPeople = new Set<string>();
      for (const userId of activeStaffUserIds) {
        const candidate = await resolveIdentity(
          { userId, credential: "session" },
          tx,
        );
        if (candidate?.side !== "staff") continue;
        const reachable = await listLiveProjectReachFacts(
          candidate,
          candidateProjectIds,
          tx,
        );
        if (reachable.length > 0) affectedPeople.add(candidate.personId);
      }

      return {
        valid,
        affected: {
          people: affectedPeople.size,
          workItems: affectedWorkItems,
          projects: projectIds.length,
        },
        unreachableStateTemplateIds: unreachableIds,
        noOutboundStateTemplateIds: noOutboundIds,
        rolesWithNoLegalTransition: roleIdsWithNoLegalTransition,
        projects,
      };
    },
    { isolationLevel: "repeatable read" },
  );
}

export default validateWorkflowVersion;
