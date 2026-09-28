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
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  roleTable,
  stateTable,
  stateTemplateTable,
  workflowTable,
  workflowTransitionTable,
  workflowVersionTable,
  workItemTable,
  workItemTypeTable,
} from "../../database/schema";

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
 * "Every project whose work item types use this workflow" (`WF-9`) is read as: every
 * DISTINCT project that has at least one work item of a type whose `workflow_id` is this
 * workflow -- an adopting project with no items of that type yet has nothing that could
 * be stuck, and no state selection of its own to validate against THIS workflow either
 * (its `state` rows exist independently of which workflow its types happen to use), so it
 * is not reported as a distinct project here. This is the same practical reading
 * `create-workflow-version.ts`'s own scope note gives for "before it is persisted" checks
 * -- the validation panel's authoritative source is `workflows.md`'s prose, and this is a
 * bounded, disclosed interpretation of "every project ... adopting" for a route with no
 * separate "which projects intend to adopt this workflow" registry to query instead.
 */
export async function validateWorkflowVersion(
  workflowId: string,
  number: number,
): Promise<WorkflowVersionValidationResult> {
  const [workflow] = await db
    .select({ workspaceId: workflowTable.workspaceId })
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1);
  if (!workflow) {
    throw new HTTPException(404, { message: "Workflow not found" });
  }

  const [version] = await db
    .select({ id: workflowVersionTable.id })
    .from(workflowVersionTable)
    .where(
      and(
        eq(workflowVersionTable.workflowId, workflowId),
        eq(workflowVersionTable.number, number),
      ),
    )
    .limit(1);
  if (!version) {
    throw new HTTPException(404, { message: "Workflow version not found" });
  }

  const templateRows = await db
    .select({ id: stateTemplateTable.id, group: stateTemplateTable.group })
    .from(stateTemplateTable)
    .where(eq(stateTemplateTable.workspaceId, workflow.workspaceId));
  const states: WorkflowState[] = templateRows.map((row) => ({
    id: asStateTemplateId(row.id),
    group: row.group as WorkflowState["group"],
  }));

  const transitionRows = await db
    .select()
    .from(workflowTransitionTable)
    .where(eq(workflowTransitionTable.versionId, version.id));
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

  const roleRows = await db
    .select({ id: roleTable.id })
    .from(roleTable)
    .where(
      or(
        eq(roleTable.workspaceId, workflow.workspaceId),
        isNull(roleTable.workspaceId),
      ),
    );
  const roleIds = roleRows.map((r) => r.id);

  const noOutboundIds = noOutboundStateIds(states, transitions);
  const noOutboundIdSet = new Set(noOutboundIds);

  // Adopting projects: every project with at least one work item of a type whose
  // `workflow_id` is this workflow -- see this function's own doc comment.
  const typeRows = await db
    .select({ id: workItemTypeTable.id })
    .from(workItemTypeTable)
    .where(eq(workItemTypeTable.workflowId, workflowId));
  const typeIds = typeRows.map((t) => t.id);

  const projects: WorkflowVersionProjectValidation[] = [];
  let unreachableIds: StateTemplateId[] = [];

  if (typeIds.length > 0) {
    const adoptingProjectRows = await db
      .selectDistinct({ projectId: workItemTable.projectId })
      .from(workItemTable)
      .where(inArray(workItemTable.typeId, typeIds));
    const projectIds = adoptingProjectRows.map((r) => r.projectId);

    // Every adopting project's own default state's TEMPLATE -- `unreachableStates`'
    // own `initialStateIds` argument (WF-9's own reasoning: reachability is checked
    // from wherever a new work item can actually start, across every project, not one
    // arbitrary project).
    const defaultStateRows =
      projectIds.length === 0
        ? []
        : await db
            .select({
              projectId: stateTable.projectId,
              stateTemplateId: stateTable.stateTemplateId,
            })
            .from(stateTable)
            .where(
              and(
                inArray(stateTable.projectId, projectIds),
                eq(stateTable.isDefault, true),
              ),
            );
    const initialStateIds = [
      ...new Set(
        defaultStateRows.map((r) => asStateTemplateId(r.stateTemplateId)),
      ),
    ];
    unreachableIds = unreachableStates(states, transitions, initialStateIds);

    for (const projectId of projectIds) {
      const enabledRows = await db
        .select({
          stateTemplateId: stateTable.stateTemplateId,
          isDefault: stateTable.isDefault,
        })
        .from(stateTable)
        .where(
          and(
            eq(stateTable.projectId, projectId),
            isNull(stateTable.archivedAt),
          ),
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
      const stuckRows =
        noOutboundIdSet.size === 0
          ? []
          : await db
              .select({
                key: workItemTable.key,
                stateTemplateId: stateTable.stateTemplateId,
              })
              .from(workItemTable)
              .innerJoin(stateTable, eq(workItemTable.stateId, stateTable.id))
              .where(
                and(
                  eq(workItemTable.projectId, projectId),
                  isNull(workItemTable.archivedAt),
                  isNull(workItemTable.deletedAt),
                ),
              );
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
