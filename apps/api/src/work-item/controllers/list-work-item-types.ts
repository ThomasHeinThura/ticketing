import { asc, eq } from "drizzle-orm";
import db from "../../database";
import { workItemTypeTable } from "../../database/schema";

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

export default listWorkItemTypes;
