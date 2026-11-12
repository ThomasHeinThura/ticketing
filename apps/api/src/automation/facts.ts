import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  commentTable,
  labelTable,
  personTable,
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

export const resolvedEntrySql = sql<string | null>`(
        SELECT a.created_at FROM activity a
        JOIN state s ON s.id = a.new_value #>> '{}'
        JOIN state_template st ON st.id = s.state_template_id
        LEFT JOIN state old_s ON old_s.id = a.old_value #>> '{}'
        LEFT JOIN state_template old_st ON old_st.id = old_s.state_template_id
        WHERE a.workspace_id = ${workItemTable.workspaceId}
          AND a.work_item_id = ${workItemTable.id} AND a.verb = 'transitioned'
          AND st."group" = 'completed' AND old_st."group" IS DISTINCT FROM 'completed'
        ORDER BY a.created_at DESC, a.seq DESC LIMIT 1
      )`;

export type LoadedWorkItem = {
  id: string;
  key: string;
  title: string;
  stateId?: string;
  stateTemplateId?: string;
  workspaceId: string;
  projectId: string;
  organisationId: string | null;
  facts: NonNullable<ConditionFacts["workItem"]>;
};

export async function loadWorkItemsByKey(
  workspaceId: string,
  keys: readonly string[],
  executor: Executor = db,
  liveProjectOnly = false,
): Promise<Map<string, LoadedWorkItem>> {
  const result = new Map<string, LoadedWorkItem>();
  const unique = [...new Set(keys)];
  if (unique.length === 0) return result;
  const rows = await executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      title: workItemTable.title,
      stateId: workItemTable.stateId,
      stateTemplateId: stateTable.stateTemplateId,
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
      resolvedEntryAt: resolvedEntrySql,
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
        eq(projectTable.workspaceId, workspaceId),
        liveProjectOnly ? isNull(projectTable.deletedAt) : undefined,
        liveProjectOnly ? isNull(projectTable.archivedAt) : undefined,
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
      stateId: row.stateId,
      stateTemplateId: row.stateTemplateId,
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
        resolvedAt:
          row.stateGroup === "completed" && row.resolvedEntryAt
            ? new Date(`${row.resolvedEntryAt.replace(" ", "T")}Z`)
            : null,
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

/** Only the stored public comment by a customer person qualifies, never a supplied role. */
export async function customerCommentFact(
  workspaceId: string,
  workItemId: string | undefined,
  kind: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (
    kind !== "work_item.commented" ||
    !workItemId ||
    typeof payload.commentId !== "string"
  )
    return false;
  const [row] = await db
    .select({ side: personTable.side })
    .from(commentTable)
    .innerJoin(personTable, eq(personTable.id, commentTable.authorId))
    .where(
      and(
        eq(commentTable.id, payload.commentId),
        eq(commentTable.workspaceId, workspaceId),
        eq(commentTable.workItemId, workItemId),
        eq(commentTable.actorType, "person"),
        eq(commentTable.visibility, "public"),
        isNull(commentTable.deletedAt),
      ),
    )
    .limit(1);
  return row?.side === "customer";
}
