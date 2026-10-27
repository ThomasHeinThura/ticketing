import { and, eq, inArray, isNull } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  labelTable,
  projectTable,
  stateTable,
  stateTemplateTable,
  workItemLabelTable,
  workItemTable,
  workItemTypeTable,
} from "../database/schema";
import { loadWorkItemRowSla } from "../work-item/row-sla";
import type { ConditionFacts } from "./conditions";

/**
 * Loads the persisted facts a rule's conditions and actions are decided from. Everything is read
 * from the database at evaluation time, never from the event payload, so a condition sees the
 * item as it is when the rule runs (the contract's "run after the change is committed").
 */

export type LoadedWorkItem = {
  id: string;
  key: string;
  title: string;
  workspaceId: string;
  projectId: string;
  organisationId: string | null;
  facts: NonNullable<ConditionFacts["workItem"]>;
};

export async function loadWorkItemsByKey(
  workspaceId: string,
  keys: readonly string[],
  executor: Executor = db,
): Promise<Map<string, LoadedWorkItem>> {
  const result = new Map<string, LoadedWorkItem>();
  const unique = [...new Set(keys)];
  if (unique.length === 0) return result;
  const rows = await executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      title: workItemTable.title,
      workspaceId: workItemTable.workspaceId,
      projectId: workItemTable.projectId,
      priority: workItemTable.priority,
      assigneeId: workItemTable.assigneeId,
      requesterId: workItemTable.requesterId,
      createdAt: workItemTable.createdAt,
      updatedAt: workItemTable.updatedAt,
      typeId: workItemTable.typeId,
      slaPolicyVersionId: workItemTable.slaPolicyVersionId,
      slaStartedAt: workItemTable.slaStartedAt,
      firstResponseAt: workItemTable.firstResponseAt,
      resolvedAt: workItemTable.resolvedAt,
      typeKey: workItemTypeTable.key,
      stateKey: stateTemplateTable.key,
      stateGroup: stateTemplateTable.group,
      projectKey: projectTable.slug,
      organisationId: projectTable.organisationId,
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
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
        eq(workItemTable.workspaceId, workspaceId),
        inArray(workItemTable.key, unique),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
      ),
    );
  if (rows.length === 0) return result;
  const labelRows = await executor
    .select({
      workItemId: workItemLabelTable.workItemId,
      name: labelTable.name,
    })
    .from(workItemLabelTable)
    .innerJoin(labelTable, eq(labelTable.id, workItemLabelTable.labelId))
    .where(
      inArray(
        workItemLabelTable.workItemId,
        rows.map((row) => row.id),
      ),
    );
  const labelsByItem = new Map<string, string[]>();
  for (const label of labelRows) {
    const list = labelsByItem.get(label.workItemId) ?? [];
    list.push(label.name);
    labelsByItem.set(label.workItemId, list);
  }
  // `sla_state`: computed on read from the stored facts, one batched lookup for all rows.
  const sla = await loadWorkItemRowSla(
    executor,
    rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      typeId: row.typeId,
      priority: row.priority,
      slaPolicyVersionId: row.slaPolicyVersionId,
      slaStartedAt: row.slaStartedAt,
      createdAt: row.createdAt,
      firstResponseAt: row.firstResponseAt,
      resolvedAt: row.resolvedAt,
    })),
  );
  for (const row of rows) {
    result.set(row.key, {
      id: row.id,
      key: row.key,
      title: row.title,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      organisationId: row.organisationId,
      facts: {
        typeKey: row.typeKey,
        stateKey: row.stateKey,
        stateGroup: row.stateGroup,
        priority: row.priority,
        assigneeId: row.assigneeId,
        requesterId: row.requesterId,
        labels: labelsByItem.get(row.id) ?? [],
        organisationId: row.organisationId,
        projectKey: row.projectKey,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        slaState: sla.get(row.id)?.state ?? null,
      },
    });
  }
  return result;
}

/** Event-payload facts: the comment's visibility and the fields a `work_item.updated` changed. */
export function eventFacts(
  kind: string,
  payload: Record<string, unknown>,
): Pick<ConditionFacts, "commentVisibility" | "changedFields"> {
  const out: Pick<ConditionFacts, "commentVisibility" | "changedFields"> = {};
  if (kind === "work_item.commented") {
    out.commentVisibility =
      payload.visibility === "public" || payload.visibility === "internal"
        ? payload.visibility
        : null;
  }
  if (kind === "work_item.updated" && Array.isArray(payload.changes)) {
    out.changedFields = payload.changes.flatMap((change) =>
      typeof change === "object" &&
      change !== null &&
      typeof (change as { field?: unknown }).field === "string"
        ? [(change as { field: string }).field]
        : [],
    );
  }
  return out;
}
