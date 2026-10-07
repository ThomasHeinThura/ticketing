import {
  asStateId,
  asStateTemplateId,
  type Effect,
  type Guard,
  type GuardContext,
  type ProjectStateAdoption,
  type StateGroup,
  type StateTemplateId,
  type WorkflowTransition,
} from "@taskdesk/domain";
import db from "../database";
import {
  getWorkflowActiveVersionQuery,
  getWorkflowCurrentStateQuery,
  getWorkflowVersionQuery,
  getWorkflowWorkItemQuery,
  getWorkItemTypeWorkflowQuery,
  listProjectAdoptedStatesQuery,
  listProjectMembershipRolesQuery,
  listUnarchivedChildrenStateTemplatesQuery,
  listWorkflowTransitionsQuery,
  listWorkspaceMembershipRolesQuery,
  listWorkspaceStateTemplateGroupsQuery,
} from "./repository";

/**
 * Issue #442's shared loader: everything `POST /api/work-items/{key}/transition` and
 * `GET /api/work-items/{key}/transitions` both need before they can call
 * `packages/domain/src/workflow/workflow.ts`'s pure engine. Neither route repeats this
 * query set on its own -- see each controller's own doc comment for why they share it.
 *
 * NOT DONE, disclosed here once rather than at every call site (PR body's own "Not
 * done" section repeats this for reviewers who don't read source): `work_item_relation`,
 * `sla_pause`, a custom-field/satellite value store and a change-risk column do not
 * exist in this schema yet, so `no_open_blockers`/`field_required`/`change_risk_at_most`
 * guard context can never be resolved from real data -- see `buildGuardContext` below,
 * which fails every one of them CLOSED (blocked) rather than fabricate a fact.
 */
export type WorkflowTransitionWorkItem = {
  id: string;
  key: string;
  workspaceId: string;
  projectId: string;
  typeId: string;
  stateId: string;
  assigneeId: string | null;
  parentId: string | null;
  version: number;
  resolvedAt: Date | null;
};

export type WorkflowTransitionContext = {
  workItem: WorkflowTransitionWorkItem;
  currentStateTemplateId: StateTemplateId;
  currentGroup: StateGroup;
  isChangeType: boolean;
  /** `null` when the work item's type has no workflow attached, or the workflow has no
   * active version yet (`WF-6`/`WF-7`) -- there is nothing to transition through. */
  activeVersion: { id: string; number: number } | null;
  transitions: WorkflowTransition[];
  /** Every `state_template` row in this workspace, for resolving a transition's target
   * template group (`resolveAutomaticEffects`'s `toGroup`) without a second query per call. */
  templateGroups: Map<StateTemplateId, StateGroup>;
  /** This project's own adopted templates -> its concrete `state.id` (`WF-2`). */
  adoptedStates: ProjectStateAdoption;
};

/** Loads everything above for one work item, already known to exist (the caller has
 * already resolved reach via `requireWorkItemReach()`). `null` only when the work item
 * itself has vanished between the middleware's read and this one (a vanishingly narrow
 * race) -- every other "nothing to do" case (no workflow, no active version) is
 * represented inside the returned context instead, since a caller may still want to
 * answer `GET /transitions` with `[]` rather than a 404. */
export async function loadWorkflowTransitionContext(
  workItemId: string,
): Promise<WorkflowTransitionContext | null> {
  const [item] = await getWorkflowWorkItemQuery(db, workItemId);
  if (!item) {
    return null;
  }

  const [currentState] = await getWorkflowCurrentStateQuery(db, item.stateId);
  if (!currentState) {
    // A work item whose own `state_id` no longer resolves to a `state` row is a data
    // fault (the FK forbids it in normal operation) -- represented as "nothing to offer"
    // rather than thrown, so a caller can still 404/409 with its own wording.
    return null;
  }

  const [type] = await getWorkItemTypeWorkflowQuery(db, item.typeId);

  const templateRows = await listWorkspaceStateTemplateGroupsQuery(
    db,
    item.workspaceId,
  );
  const templateGroups = new Map<StateTemplateId, StateGroup>(
    templateRows.map((row) => [
      asStateTemplateId(row.id),
      row.group as StateGroup,
    ]),
  );

  const stateRows = await listProjectAdoptedStatesQuery(db, item.projectId);
  const adoptedStates: ProjectStateAdoption = new Map(
    stateRows.map((row) => [
      asStateTemplateId(row.stateTemplateId),
      asStateId(row.id),
    ]),
  );

  const workItem: WorkflowTransitionWorkItem = {
    id: item.id,
    key: item.key,
    workspaceId: item.workspaceId,
    projectId: item.projectId,
    typeId: item.typeId,
    stateId: item.stateId,
    assigneeId: item.assigneeId,
    parentId: item.parentId,
    version: item.version,
    resolvedAt: item.resolvedAt,
  };

  const base = {
    workItem,
    currentStateTemplateId: asStateTemplateId(currentState.stateTemplateId),
    currentGroup: currentState.group as StateGroup,
    isChangeType: type?.isChange ?? false,
    templateGroups,
    adoptedStates,
  };

  if (!type?.workflowId) {
    return { ...base, activeVersion: null, transitions: [] };
  }

  const [workflow] = await getWorkflowActiveVersionQuery(db, type.workflowId);
  if (!workflow?.activeVersionId) {
    return { ...base, activeVersion: null, transitions: [] };
  }

  const [version] = await getWorkflowVersionQuery(db, workflow.activeVersionId);
  if (!version) {
    return { ...base, activeVersion: null, transitions: [] };
  }

  const transitionRows = await listWorkflowTransitionsQuery(db, version.id);

  const transitions: WorkflowTransition[] = transitionRows.map((row) => ({
    id: row.id,
    fromStateTemplateId:
      row.fromStateTemplateId === null
        ? null
        : asStateTemplateId(row.fromStateTemplateId),
    toStateTemplateId: asStateTemplateId(row.toStateTemplateId),
    roleId: row.roleId,
    // `WF-15`/`WF-19` closed vocabularies -- validated once, at write time
    // (`validateWorkflowVersion`, called by `create-workflow-version.ts`), not
    // re-validated on every read. A row that somehow holds an unrecognised guard/effect
    // `kind` still fails closed at evaluation time (`evaluateGuard`'s own
    // `guard.unrecognized` branch) -- this cast never bypasses that.
    notePolicy: row.notePolicy as WorkflowTransition["notePolicy"],
    noteVisibility: row.noteVisibility as WorkflowTransition["noteVisibility"],
    requiresApproval: row.requiresApproval,
    approvalPolicy: row.approvalPolicy as WorkflowTransition["approvalPolicy"],
    requiresCab: row.requiresCab,
    isReopen: row.isReopen,
    guards: row.guards as Guard[],
    effects: row.effects as Effect[],
  }));

  return {
    ...base,
    activeVersion: { id: version.id, number: version.number },
    transitions,
  };
}

/**
 * The actor's `role.id`s for legality (`WF-3`/`WF-4`): every `membership.role_id` this
 * person holds, scoped to either this work item's PROJECT or its WORKSPACE --
 * `workflow_transition.role_id` references the P1 identity schema's own `role` table
 * (`create-workflow-version.ts`'s own cross-tenant check confirms this is the table a
 * transition's `role_id` names), which is a distinct vocabulary from the legacy
 * `workspace_member.role`/`BUILT_IN_ROLES` system `requireWorkspaceCapability` reads for
 * the route-level `work_item:transition` gate. Both checks run: the capability gate
 * decides 403 (`WF-4`'s "without work_item:transition"); this decides which per-role
 * transition edges are legal once the capability gate has already passed.
 */
export async function resolveActorRoleIds(
  personId: string | null,
  workspaceId: string,
  projectId: string,
): Promise<string[]> {
  if (personId === null) {
    return [];
  }
  const rows = await listProjectMembershipRolesQuery(db, personId, projectId);
  const workspaceRows = await listWorkspaceMembershipRolesQuery(
    db,
    personId,
    workspaceId,
  );
  return [...new Set([...rows, ...workspaceRows].map((r) => r.roleId))];
}

/**
 * Guard context (`WF-15`), resolved as honestly as this schema currently allows.
 *
 * RESOLVED FOR REAL: `children_closed` (this item's own children, via `parent_id` and
 * each child's mapped `state_template.group` -- vacuously true with no children) and
 * `assignee_present` (`work_item.assignee_id`).
 *
 * FAILS CLOSED, DISCLOSED, NOT FAKED: `no_open_blockers` (`work_item_relation` does not
 * exist in this schema yet -- `hasOpenBlockers: true` unconditionally, so the guard is
 * always reported blocked rather than silently satisfied), `field_required`
 * (`fieldValues: {}` -- no custom-field/satellite value store exists yet, so
 * `isFieldPresent` is always false for any key), `change_risk_at_most`
 * (`changeRiskLevel: null` -- no change-risk column exists yet; `evaluateGuard` already
 * fails this closed on `null` by its own design, so nothing extra is needed here beyond
 * never fabricating a real level).
 */
export async function buildGuardContext(
  ctx: WorkflowTransitionContext,
): Promise<GuardContext> {
  const children = await listUnarchivedChildrenStateTemplatesQuery(
    db,
    ctx.workItem.id,
  );
  const allChildrenClosed = children.every((child) => {
    const group = ctx.templateGroups.get(
      asStateTemplateId(child.stateTemplateId),
    );
    return group === "completed" || group === "cancelled";
  });

  return {
    allChildrenClosed,
    hasOpenBlockers: true,
    assigneePresent: ctx.workItem.assigneeId !== null,
    fieldValues: {},
    changeRiskLevel: null,
  };
}
