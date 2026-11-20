import { and, asc, eq, isNotNull } from "drizzle-orm";
import db, { schema } from "../../database";
import { workItemTypeTable } from "../../database/schema";
import { canLeaveDefaultState } from "../creation-workflow";

/**
 * `GET /api/workspace/{workspaceId}/work-item-types` (`workspace:read`).
 *
 * The workspace's configured `work_item_type` rows — what the create dialog's Type picker
 * reads: `WI-1` requires every work item to have exactly one type at creation, and there
 * is no default type to fall back to, so a client that cannot list types cannot create a
 * work item through a UI at all. `work_item_type` is workspace-scoped (`data-model.md` §6),
 * so the catalogue is addressed by workspace, not by project — every project in a
 * workspace shares it.
 *
 * Deliberately narrow: what a picker renders, nothing else. `workflowId`/`slaPolicyId` are
 * plain nullable columns pointing at tables that do not exist yet (`schema.ts`'s own note
 * on `workItemTypeTable`), and the audit columns are not the client's.
 *
 * Ordering is deterministic (category, then name). `work_item_type` has no position column
 * and no display order is specified anywhere; a stable order matters more than any
 * particular one, because an unstable list makes a picker jump between renders.
 */
export async function listWorkItemTypes(workspaceId: string) {
  return db
    .select({
      id: workItemTypeTable.id,
      key: workItemTypeTable.key,
      name: workItemTypeTable.name,
      icon: workItemTypeTable.icon,
      category: workItemTypeTable.category,
      isEpic: workItemTypeTable.isEpic,
      isChange: workItemTypeTable.isChange,
    })
    .from(workItemTypeTable)
    .where(eq(workItemTypeTable.workspaceId, workspaceId))
    .orderBy(asc(workItemTypeTable.category), asc(workItemTypeTable.name));
}

export async function listCreatableWorkItemTypes(
  workspaceId: string,
  projectId: string,
) {
  const [types, bindings, states, templates, edges] = await Promise.all([
    listWorkItemTypes(workspaceId),
    db
      .select({
        id: workItemTypeTable.id,
        workflowId: workItemTypeTable.workflowId,
      })
      .from(workItemTypeTable)
      .where(eq(workItemTypeTable.workspaceId, workspaceId)),
    db
      .select()
      .from(schema.stateTable)
      .where(eq(schema.stateTable.projectId, projectId)),
    db
      .select()
      .from(schema.stateTemplateTable)
      .where(eq(schema.stateTemplateTable.workspaceId, workspaceId)),
    db
      .select({
        workflowId: schema.workflowTable.id,
        fromStateTemplateId: schema.workflowTransitionTable.fromStateTemplateId,
        toStateTemplateId: schema.workflowTransitionTable.toStateTemplateId,
      })
      .from(schema.workflowTable)
      .innerJoin(
        schema.workflowVersionTable,
        and(
          eq(
            schema.workflowVersionTable.id,
            schema.workflowTable.activeVersionId,
          ),
          eq(schema.workflowVersionTable.workflowId, schema.workflowTable.id),
          isNotNull(schema.workflowVersionTable.publishedAt),
        ),
      )
      .innerJoin(
        schema.workflowTransitionTable,
        eq(
          schema.workflowTransitionTable.versionId,
          schema.workflowVersionTable.id,
        ),
      )
      .where(eq(schema.workflowTable.workspaceId, workspaceId)),
  ]);
  const initial = states.find((state) => state.isDefault);
  if (!initial) return [];
  const projectTemplates = new Set(
    states.map((state) => state.stateTemplateId),
  );
  const liveTemplates = new Set(
    templates
      .filter((template) => !template.archivedAt)
      .map((template) => template.id),
  );
  return types.filter((type) => {
    const workflowId = bindings.find(
      (binding) => binding.id === type.id,
    )?.workflowId;
    return canLeaveDefaultState(
      initial.stateTemplateId,
      projectTemplates,
      liveTemplates,
      edges.filter((edge) => edge.workflowId === workflowId),
    );
  });
}

export default listWorkItemTypes;
