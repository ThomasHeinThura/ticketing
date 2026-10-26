import { createId } from "@paralleldrive/cuid2";
import {
  asStateTemplateId,
  validateWorkflowVersion,
  type WorkflowTransition,
} from "@taskdesk/domain";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import db from "../database";
import type { Transaction } from "../database/executor";
import {
  projectTable,
  stateTable,
  stateTemplateTable,
  workflowTable,
  workflowTransitionTable,
  workflowVersionTable,
  workItemTable,
  workItemTypeTable,
  workspaceTable,
} from "../database/schema";
import { auditIfRegistered, type GovernanceActor } from "../team/audit";
import { hasCompleteWorkflowProjectReach } from "../workflow/repository";

/**
 * `CH-2` CAB workflow: new workspaces seed this guarded default during workspace creation;
 * existing workspaces keep the explicit `workflow:manage` apply route below.
 *
 * What it does, in one serializable-by-lock transaction:
 * 1. finds or creates the workspace `Approved` state template (group `unstarted`);
 * 2. copies the change types' current active workflow into a NEW workflow (`change-cab`) with
 *    one published version -- the default workflow's published graph is never edited -- that
 *    drops every edge from a backlog/unstarted state (or "any") into a started/completed state
 *    (the CAB bypass), adds `requires_cab` edges from every backlog/unstarted state to Approved,
 *    and adds Approved -> every other state;
 * 3. binds every `is_change` type to the new workflow;
 * 4. adopts Approved into the named projects.
 *
 * Scope, stated plainly: workflows bind to work item TYPES, which are workspace-wide, so there is
 * no per-project workflow binding. "Per project" is the adoption of the Approved state: a project
 * that has not adopted it cannot offer the CAB edge. Because the bypass edges are gone for every
 * project, the apply is REFUSED (409) while a project that has not adopted Approved still holds
 * open change items in a backlog/unstarted state -- those items would otherwise be stranded.
 *
 * `CH-3` risk-based pre-approval remains configurable in the workflow editor. This default keeps
 * every change CAB-gated; it does not invent a role or a low-risk bypass.
 */
export const CAB_WORKFLOW_KEY = "change-cab";
export const CAB_WORKFLOW_NAME = "Change (CAB approval)";
export const APPROVED_TEMPLATE_KEY = "approved";
export const APPROVED_TEMPLATE_NAME = "Approved";

export class CabTemplateError extends Error {
  constructor(
    readonly status: 403 | 404 | 409,
    readonly code: string,
    readonly projects?: Array<{ id: string; name: string }>,
  ) {
    super(code);
  }
}

type EdgeInput = Omit<
  typeof workflowTransitionTable.$inferInsert,
  "id" | "createdAt" | "updatedAt" | "versionId"
>;
type TemplateRow = {
  id: string;
  group: string;
  key?: string;
  archivedAt?: Date | null;
};

const EARLY_GROUPS = new Set(["backlog", "unstarted"]);
const LATE_GROUPS = new Set(["started", "completed"]);

const tuple = (
  edge: Pick<EdgeInput, "fromStateTemplateId" | "toStateTemplateId" | "roleId">,
) =>
  `${edge.fromStateTemplateId ?? "*"}>${edge.toStateTemplateId}:${edge.roleId ?? "*"}`;

/** Pure: the CAB-gated edge set derived from the change types' current edges. */
export function planCabEdges(
  base: readonly EdgeInput[],
  templates: readonly TemplateRow[],
  approvedId: string,
): EdgeInput[] {
  const groupOf = new Map(templates.map((row) => [row.id, row.group]));
  const early = templates
    .filter((row) => row.id !== approvedId && EARLY_GROUPS.has(row.group))
    .map((row) => row.id);
  const isBypass = (edge: EdgeInput) =>
    !edge.isReopen &&
    LATE_GROUPS.has(groupOf.get(edge.toStateTemplateId) ?? "") &&
    (edge.fromStateTemplateId == null ||
      (edge.fromStateTemplateId !== approvedId &&
        EARLY_GROUPS.has(groupOf.get(edge.fromStateTemplateId) ?? "")));
  const kept = base.filter(
    (edge) => !isBypass(edge) && edge.toStateTemplateId !== approvedId,
  );
  const seen = new Set(kept.map(tuple));
  const plain = {
    roleId: null,
    notePolicy: "none",
    noteVisibility: "internal",
    requiresApproval: false,
    approvalPolicy: null,
    isReopen: false,
    guards: [],
    effects: [],
  } as const;
  const added: EdgeInput[] = [];
  for (const from of early) {
    const edge: EdgeInput = {
      ...plain,
      fromStateTemplateId: from,
      toStateTemplateId: approvedId,
      requiresCab: true,
      approvalPolicy: "any",
    };
    if (!seen.has(tuple(edge))) added.push(edge);
  }
  for (const row of templates) {
    if (row.id === approvedId) continue;
    const edge: EdgeInput = {
      ...plain,
      fromStateTemplateId: approvedId,
      toStateTemplateId: row.id,
      requiresCab: false,
    };
    if (!seen.has(tuple(edge))) added.push(edge);
  }
  return [...kept, ...added];
}

type ChangeTypeRow = { id: string; workflowId: string | null };

/**
 * Persist the shared CAB graph inside the caller's transaction. Route application supplies the
 * acting person's id and performs its reach/stranding checks before calling this; new-workspace
 * bootstrap supplies null, matching the published built-in default workflow.
 */
async function createCabWorkflowInTransaction(
  tx: Transaction,
  input: {
    workspaceId: string;
    changeTypes: readonly ChangeTypeRow[];
    templates: TemplateRow[];
    publishedBy: string | null;
  },
) {
  const { workspaceId, changeTypes, templates } = input;
  const sourceIds = [...new Set(changeTypes.map((row) => row.workflowId))];
  const sourceId = sourceIds[0];
  if (sourceIds.length !== 1 || !sourceId)
    throw new CabTemplateError(409, "change_types_not_on_one_workflow");
  const [source] = await tx
    .select({ activeVersionId: workflowTable.activeVersionId })
    .from(workflowTable)
    .where(eq(workflowTable.id, sourceId));
  if (!source?.activeVersionId)
    throw new CabTemplateError(409, "no_active_workflow");
  const baseRows = await tx
    .select()
    .from(workflowTransitionTable)
    .where(eq(workflowTransitionTable.versionId, source.activeVersionId));
  const base: EdgeInput[] = baseRows.map((row) => ({
    fromStateTemplateId: row.fromStateTemplateId,
    toStateTemplateId: row.toStateTemplateId,
    roleId: row.roleId,
    notePolicy: row.notePolicy,
    noteVisibility: row.noteVisibility,
    requiresApproval: row.requiresApproval,
    approvalPolicy: row.approvalPolicy,
    requiresCab: row.requiresCab,
    isReopen: row.isReopen,
    guards: row.guards,
    effects: row.effects,
  }));

  let approved = templates.find((row) => row.key === APPROVED_TEMPLATE_KEY);
  if (approved?.archivedAt)
    throw new CabTemplateError(409, "approved_state_archived");
  if (!approved) {
    const [created] = await tx
      .insert(stateTemplateTable)
      .values({
        workspaceId,
        key: APPROVED_TEMPLATE_KEY,
        name: APPROVED_TEMPLATE_NAME,
        group: "unstarted",
      })
      .returning({
        id: stateTemplateTable.id,
        group: stateTemplateTable.group,
        key: stateTemplateTable.key,
        archivedAt: stateTemplateTable.archivedAt,
      });
    if (!created) throw new Error("Failed to create the Approved state");
    approved = created;
    templates.push(created);
  }

  const edges = planCabEdges(
    base,
    templates.filter((row) => !row.archivedAt),
    approved.id,
  );
  const check = validateWorkflowVersion(
    templates.map((row) => ({
      id: asStateTemplateId(row.id),
      group: row.group as "backlog",
    })),
    edges.map(
      (edge, index): WorkflowTransition => ({
        id: `cab-${index}`,
        fromStateTemplateId:
          edge.fromStateTemplateId === null ||
          edge.fromStateTemplateId === undefined
            ? null
            : asStateTemplateId(edge.fromStateTemplateId),
        toStateTemplateId: asStateTemplateId(edge.toStateTemplateId),
        roleId: edge.roleId ?? null,
        notePolicy: edge.notePolicy as WorkflowTransition["notePolicy"],
        noteVisibility:
          edge.noteVisibility as WorkflowTransition["noteVisibility"],
        requiresApproval: edge.requiresApproval ?? false,
        approvalPolicy:
          (edge.approvalPolicy as WorkflowTransition["approvalPolicy"]) ?? null,
        requiresCab: edge.requiresCab ?? false,
        isReopen: edge.isReopen ?? false,
        guards: edge.guards as WorkflowTransition["guards"],
        effects: edge.effects as WorkflowTransition["effects"],
      }),
    ),
  );
  if (!check.valid)
    throw new CabTemplateError(
      409,
      `invalid_workflow:${check.errors.join("; ")}`,
    );

  const workflowId = createId();
  const versionId = createId();
  await tx.insert(workflowTable).values({
    id: workflowId,
    workspaceId,
    key: CAB_WORKFLOW_KEY,
    name: CAB_WORKFLOW_NAME,
  });
  await tx
    .insert(workflowVersionTable)
    .values({ id: versionId, workflowId, number: 1 });
  await tx
    .insert(workflowTransitionTable)
    .values(edges.map((edge) => ({ ...edge, versionId })));
  await tx
    .update(workflowVersionTable)
    .set({ publishedAt: new Date(), publishedBy: input.publishedBy })
    .where(eq(workflowVersionTable.id, versionId));
  await tx
    .update(workflowTable)
    .set({ activeVersionId: versionId })
    .where(eq(workflowTable.id, workflowId));
  await tx
    .update(workItemTypeTable)
    .set({ workflowId })
    .where(
      inArray(
        workItemTypeTable.id,
        changeTypes.map((row) => row.id),
      ),
    );

  return {
    workflowId,
    versionNumber: 1,
    approvedStateTemplateId: approved.id,
  };
}

/** Seed the guarded change workflow for a workspace being created in this transaction. */
export async function seedDefaultCabWorkflowInTransaction(
  workspaceId: string,
  tx: Transaction,
): Promise<void> {
  const changeTypes = await tx
    .select({
      id: workItemTypeTable.id,
      workflowId: workItemTypeTable.workflowId,
    })
    .from(workItemTypeTable)
    .where(
      and(
        eq(workItemTypeTable.workspaceId, workspaceId),
        eq(workItemTypeTable.isChange, true),
      ),
    )
    .orderBy(asc(workItemTypeTable.id));
  if (changeTypes.length === 0)
    throw new Error("New workspace has no default change work item type");
  const templates = await tx
    .select({
      id: stateTemplateTable.id,
      group: stateTemplateTable.group,
      key: stateTemplateTable.key,
      archivedAt: stateTemplateTable.archivedAt,
    })
    .from(stateTemplateTable)
    .where(eq(stateTemplateTable.workspaceId, workspaceId));
  await createCabWorkflowInTransaction(tx, {
    workspaceId,
    changeTypes,
    templates,
    publishedBy: null,
  });
}

export type ApplyCabTemplateInput = {
  workspaceId: string;
  projectIds: string[];
  identity: ResolvedIdentity;
  actor: GovernanceActor;
};

export type ApplyCabTemplateResult = {
  workflowId: string;
  versionNumber: number;
  alreadyApplied: boolean;
  approvedStateTemplateId: string;
  changeTypeIds: string[];
  adoptedProjectIds: string[];
  /** Live projects that still lack the Approved state; their changes cannot be approved. */
  unadoptedProjects: Array<{ id: string; name: string }>;
};

export async function applyCabTemplate(
  input: ApplyCabTemplateInput,
): Promise<ApplyCabTemplateResult> {
  const { workspaceId, identity, actor } = input;
  const requested = [...new Set(input.projectIds)].sort();
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: workspaceTable.id })
      .from(workspaceTable)
      .where(eq(workspaceTable.id, workspaceId))
      .for("update");
    if (!locked[0]) throw new CabTemplateError(404, "workspace_not_found");

    const liveProjects = await tx
      .select({ id: projectTable.id, name: projectTable.name })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.deletedAt),
          isNull(projectTable.archivedAt),
        ),
      )
      .orderBy(asc(projectTable.id));
    const liveIds = new Set(liveProjects.map((row) => row.id));
    if (requested.some((id) => !liveIds.has(id)))
      throw new CabTemplateError(404, "project_not_found");

    const changeTypes = await tx
      .select({
        id: workItemTypeTable.id,
        workflowId: workItemTypeTable.workflowId,
      })
      .from(workItemTypeTable)
      .where(
        and(
          eq(workItemTypeTable.workspaceId, workspaceId),
          eq(workItemTypeTable.isChange, true),
        ),
      )
      .orderBy(asc(workItemTypeTable.id));
    if (changeTypes.length === 0)
      throw new CabTemplateError(409, "no_change_type");

    const templates = await tx
      .select({
        id: stateTemplateTable.id,
        group: stateTemplateTable.group,
        key: stateTemplateTable.key,
        archivedAt: stateTemplateTable.archivedAt,
      })
      .from(stateTemplateTable)
      .where(eq(stateTemplateTable.workspaceId, workspaceId));

    const [existing] = await tx
      .select()
      .from(workflowTable)
      .where(
        and(
          eq(workflowTable.workspaceId, workspaceId),
          eq(workflowTable.key, CAB_WORKFLOW_KEY),
        ),
      );
    const alreadyApplied =
      existing !== undefined &&
      changeTypes.every((row) => row.workflowId === existing.id);
    if (existing && !alreadyApplied)
      throw new CabTemplateError(409, "cab_workflow_conflict");

    const existingApproved = templates.find(
      (row) => row.key === APPROVED_TEMPLATE_KEY,
    );
    if (existingApproved?.archivedAt)
      throw new CabTemplateError(409, "approved_state_archived");

    let workflowId = existing?.id ?? "";
    let versionNumber = 1;
    let approvedId = "";
    if (alreadyApplied && existing) {
      if (!existing.activeVersionId)
        throw new CabTemplateError(409, "cab_workflow_conflict");
      const [version] = await tx
        .select({ number: workflowVersionTable.number })
        .from(workflowVersionTable)
        .where(eq(workflowVersionTable.id, existing.activeVersionId));
      versionNumber = version?.number ?? 1;
      const approved = existingApproved;
      if (!approved || approved.archivedAt)
        throw new CabTemplateError(409, "cab_workflow_conflict");
      approvedId = approved.id;
    } else {
      const sourceIds = [...new Set(changeTypes.map((row) => row.workflowId))];
      const sourceId = sourceIds[0];
      if (sourceIds.length !== 1 || !sourceId)
        throw new CabTemplateError(409, "change_types_not_on_one_workflow");
      if (!(await hasCompleteWorkflowProjectReach(identity, sourceId, tx)))
        throw new CabTemplateError(403, "workflow_project_access_required");
      const created = await createCabWorkflowInTransaction(tx, {
        workspaceId,
        changeTypes,
        templates,
        publishedBy: identity.personId,
      });
      workflowId = created.workflowId;
      versionNumber = created.versionNumber;
      approvedId = created.approvedStateTemplateId;
    }

    const adopted = await tx
      .select({
        projectId: stateTable.projectId,
        position: stateTable.position,
        archivedAt: stateTable.archivedAt,
        templateId: stateTable.stateTemplateId,
      })
      .from(stateTable)
      .where(
        inArray(
          stateTable.projectId,
          liveProjects.map((row) => row.id),
        ),
      );
    const hasApproved = new Set(
      adopted
        .filter((row) => row.templateId === approvedId && !row.archivedAt)
        .map((row) => row.projectId),
    );
    const adoptedProjectIds: string[] = [];
    for (const projectId of requested) {
      if (hasApproved.has(projectId)) continue;
      const position =
        Math.max(
          -1,
          ...adopted
            .filter((row) => row.projectId === projectId)
            .map((row) => row.position),
        ) + 1;
      await tx.insert(stateTable).values({
        projectId,
        stateTemplateId: approvedId,
        position,
        isDefault: false,
      });
      hasApproved.add(projectId);
      adoptedProjectIds.push(projectId);
    }

    const unadopted = liveProjects.filter((row) => !hasApproved.has(row.id));
    if (!alreadyApplied && unadopted.length > 0) {
      const stranded = await tx
        .selectDistinct({ projectId: workItemTable.projectId })
        .from(workItemTable)
        .innerJoin(
          workItemTypeTable,
          eq(workItemTypeTable.id, workItemTable.typeId),
        )
        .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
        .innerJoin(
          stateTemplateTable,
          eq(stateTemplateTable.id, stateTable.stateTemplateId),
        )
        .where(
          and(
            inArray(
              workItemTable.projectId,
              unadopted.map((row) => row.id),
            ),
            eq(workItemTypeTable.isChange, true),
            isNull(workItemTable.deletedAt),
            isNull(workItemTable.archivedAt),
            inArray(stateTemplateTable.group, [...EARLY_GROUPS]),
          ),
        );
      if (stranded.length > 0) {
        const ids = new Set(stranded.map((row) => row.projectId));
        throw new CabTemplateError(
          409,
          "projects_would_strand_changes",
          unadopted.filter((row) => ids.has(row.id)),
        );
      }
    }

    await auditIfRegistered(tx, {
      action: "workflow.cab_template_applied",
      workspaceId,
      entityType: "workflow",
      entityId: workflowId,
      actor,
      before: null,
      after: {
        alreadyApplied,
        versionNumber,
        changeTypeIds: changeTypes.map((row) => row.id),
        adoptedProjectIds,
      },
    });

    return {
      workflowId,
      versionNumber,
      alreadyApplied,
      approvedStateTemplateId: approvedId,
      changeTypeIds: changeTypes.map((row) => row.id),
      adoptedProjectIds,
      unadoptedProjects: unadopted,
    };
  });
}

export type CabTemplateStatus = {
  applied: boolean;
  workflowId: string | null;
  approvedStateTemplateId: string | null;
  /** Live projects that have adopted Approved. */
  adoptedProjectIds: string[];
  changeTypeCount: number;
};

export async function cabTemplateStatus(
  workspaceId: string,
): Promise<CabTemplateStatus> {
  const [workflow] = await db
    .select({ id: workflowTable.id })
    .from(workflowTable)
    .where(
      and(
        eq(workflowTable.workspaceId, workspaceId),
        eq(workflowTable.key, CAB_WORKFLOW_KEY),
      ),
    );
  const changeTypes = await db
    .select({ workflowId: workItemTypeTable.workflowId })
    .from(workItemTypeTable)
    .where(
      and(
        eq(workItemTypeTable.workspaceId, workspaceId),
        eq(workItemTypeTable.isChange, true),
      ),
    );
  const [approved] = await db
    .select({ id: stateTemplateTable.id })
    .from(stateTemplateTable)
    .where(
      and(
        eq(stateTemplateTable.workspaceId, workspaceId),
        eq(stateTemplateTable.key, APPROVED_TEMPLATE_KEY),
      ),
    );
  const adopted = approved
    ? await db
        .selectDistinct({ projectId: stateTable.projectId })
        .from(stateTable)
        .innerJoin(projectTable, eq(projectTable.id, stateTable.projectId))
        .where(
          and(
            eq(stateTable.stateTemplateId, approved.id),
            isNull(stateTable.archivedAt),
            eq(projectTable.workspaceId, workspaceId),
            isNull(projectTable.deletedAt),
            isNull(projectTable.archivedAt),
          ),
        )
    : [];
  return {
    applied:
      workflow !== undefined &&
      changeTypes.length > 0 &&
      changeTypes.every((row) => row.workflowId === workflow.id),
    workflowId: workflow?.id ?? null,
    approvedStateTemplateId: approved?.id ?? null,
    adoptedProjectIds: adopted.map((row) => row.projectId),
    changeTypeCount: changeTypes.length,
  };
}
