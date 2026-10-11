import { and, eq, isNull, sql } from "drizzle-orm";
import { schema } from "../database";
import type { DbTransaction } from "../events/outbox";
import { isSupportedNotificationResourceEvent } from "./resource-contract";

export type CurrentNotificationResource = {
  workspaceId: string;
  projectId: string | null;
  organisationId: string | null;
  visibleToPersonIds: readonly string[] | null;
  customerVisible: boolean;
  staffUrl: string | null;
};

type ResourceRow = {
  id: string;
  key: string;
  workspaceId: string;
  projectId: string | null;
  organisationId: string | null;
  requesterId: string | null;
  customerVisibility: string | null;
};

function rows<T>(result: { rows: unknown[] }): T[] {
  return result.rows as T[];
}

function visiblePeople(
  requesterId: string | null,
  customerVisibility: string | null,
  participantIds: readonly string[],
): readonly string[] | null {
  return customerVisibility === "private"
    ? [...new Set([...(requesterId ? [requesterId] : []), ...participantIds])]
    : null;
}

async function findWorkItemResource(
  tx: DbTransaction,
  workItemId: string,
  canonicalWorkItem?: { id?: string; key?: string },
): Promise<CurrentNotificationResource | null> {
  const result = await tx.execute(sql`
    SELECT wi.id, wi.key, wi.workspace_id AS "workspaceId", wi.project_id AS "projectId",
           p.organisation_id AS "organisationId", wi.requester_id AS "requesterId",
           wi.customer_visibility AS "customerVisibility"
      FROM work_item wi
      JOIN project p ON p.id = wi.project_id
      JOIN workspace w ON w.id = wi.workspace_id
     WHERE (wi.id = ${workItemId} OR wi.key = ${workItemId})
       AND (${canonicalWorkItem?.id ?? null}::text IS NULL OR wi.id = ${canonicalWorkItem?.id ?? null})
       AND (${canonicalWorkItem?.key ?? null}::text IS NULL OR wi.key = ${canonicalWorkItem?.key ?? null})
       AND wi.deleted_at IS NULL AND wi.archived_at IS NULL
       AND p.deleted_at IS NULL
       AND w.deleted_at IS NULL
     LIMIT 1
  `);
  const row = rows<ResourceRow>(result)[0];
  if (!row) return null;
  let participantIds: string[] = [];
  if (row.customerVisibility === "private") {
    const participants = await tx.execute(sql`
      SELECT person_id AS "personId" FROM request_participant
       WHERE work_item_id = ${row.id}
    `);
    participantIds = rows<{ personId: string }>(participants).map(
      ({ personId }) => personId,
    );
  }
  return {
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    organisationId: row.organisationId,
    visibleToPersonIds: visiblePeople(
      row.requesterId,
      row.customerVisibility,
      participantIds,
    ),
    customerVisible: true,
    staffUrl: `/agent/work-items/${encodeURIComponent(row.key)}`,
  };
}

/** Resolve only the notification resource mappings with a current repository contract. */
export async function findCurrentNotificationResource(
  tx: DbTransaction,
  input: {
    resourceType: string | null;
    resourceId: string | null;
    eventKind: string;
    canonicalWorkItem?: { id?: string; key?: string };
    /** The delivery's own workspace: an approval is only read inside it (0120 anchor). */
    workspaceId?: string;
  },
): Promise<CurrentNotificationResource | null> {
  if (!input.resourceType || !input.resourceId) return null;

  if (
    input.resourceType === "approval" &&
    input.workspaceId &&
    isSupportedNotificationResourceEvent(input.resourceType, input.eventKind)
  ) {
    const context = await findApprovalNotificationContext(
      tx,
      input.resourceId,
      input.workspaceId,
    );
    if (!context) return null;
    const participantRows = await listApprovalParticipantPersonIds(
      tx,
      context.workItemId,
    );
    return {
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      organisationId: context.organisationId,
      visibleToPersonIds: visiblePeople(
        context.requesterId,
        context.customerVisibility,
        participantRows.map(({ personId }) => personId),
      ),
      customerVisible: true,
      staffUrl: null,
    };
  }

  if (
    input.resourceType === "work_item" &&
    isSupportedNotificationResourceEvent(input.resourceType, input.eventKind)
  )
    return findWorkItemResource(tx, input.resourceId, input.canonicalWorkItem);

  if (
    input.resourceType === "comment" &&
    isSupportedNotificationResourceEvent(input.resourceType, input.eventKind)
  ) {
    const result = await tx.execute(sql`
      SELECT c.work_item_id AS "workItemId", c.visibility
        FROM comment c
        JOIN work_item wi ON wi.id = c.work_item_id
       WHERE c.id = ${input.resourceId}
         AND c.body IS NOT NULL
         AND (${input.canonicalWorkItem?.id ?? null}::text IS NULL OR wi.id = ${input.canonicalWorkItem?.id ?? null})
         AND (${input.canonicalWorkItem?.key ?? null}::text IS NULL OR wi.key = ${input.canonicalWorkItem?.key ?? null})
       LIMIT 1
    `);
    const row = rows<{ workItemId: string; visibility: string }>(result)[0];
    if (!row || !["internal", "public"].includes(row.visibility)) return null;
    const resource = await findWorkItemResource(tx, row.workItemId);
    return resource
      ? {
          ...resource,
          customerVisible: row.visibility === "public",
          staffUrl: null,
        }
      : null;
  }

  if (
    input.resourceType === "workspace" &&
    isSupportedNotificationResourceEvent(input.resourceType, input.eventKind)
  ) {
    const workspace = await findNotificationWorkspace(tx, input.resourceId);
    if (!workspace) return null;
    return {
      workspaceId: workspace.id,
      projectId: null,
      organisationId: workspace.organisationId,
      visibleToPersonIds: null,
      customerVisible: true,
      staffUrl: null,
    };
  }

  return null;
}

export async function findNotificationPerson(
  tx: DbTransaction,
  personId: string,
) {
  const [person] = await tx
    .select({
      userId: schema.personTable.userId,
      side: schema.personTable.side,
      active: schema.personTable.active,
      quietHoursStart: schema.personTable.quietHoursStart,
      quietHoursEnd: schema.personTable.quietHoursEnd,
      quietHoursTimezone: schema.personTable.quietHoursTimezone,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, personId))
    .limit(1);
  return person ?? null;
}

export async function findNotificationWorkspace(
  tx: DbTransaction,
  workspaceId: string,
) {
  const [workspace] = await tx
    .select({
      id: schema.workspaceTable.id,
      organisationId: schema.workspaceTable.organisationId,
    })
    .from(schema.workspaceTable)
    .where(
      and(
        eq(schema.workspaceTable.id, workspaceId),
        isNull(schema.workspaceTable.deletedAt),
      ),
    )
    .limit(1);
  return workspace ?? null;
}

/**
 * The approval, read only inside the given workspace and through the composite
 * `(workspace_id, work_item_id)` anchor of migration 0120, with the live work item and project.
 */
export async function findApprovalNotificationContext(
  tx: DbTransaction,
  approvalId: string,
  workspaceId: string,
) {
  const [row] = await tx
    .select({
      id: schema.approvalTable.id,
      kind: schema.approvalTable.kind,
      state: schema.approvalTable.state,
      requestedBy: schema.approvalTable.requestedBy,
      approverId: schema.approvalTable.approverId,
      workItemId: schema.workItemTable.id,
      workspaceId: schema.approvalTable.workspaceId,
      projectId: schema.workItemTable.projectId,
      organisationId: schema.workspaceTable.organisationId,
      requesterId: schema.workItemTable.requesterId,
      customerVisibility: schema.workItemTable.customerVisibility,
    })
    .from(schema.approvalTable)
    .innerJoin(
      schema.workItemTable,
      and(
        eq(schema.workItemTable.id, schema.approvalTable.workItemId),
        eq(schema.workItemTable.workspaceId, schema.approvalTable.workspaceId),
      ),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .innerJoin(
      schema.workspaceTable,
      eq(schema.workspaceTable.id, schema.approvalTable.workspaceId),
    )
    .where(
      and(
        eq(schema.approvalTable.id, approvalId),
        eq(schema.approvalTable.workspaceId, workspaceId),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export function listApprovalWatcherPersonIds(
  tx: DbTransaction,
  workItemId: string,
) {
  return tx
    .select({ personId: schema.watcherTable.personId })
    .from(schema.watcherTable)
    .where(eq(schema.watcherTable.workItemId, workItemId));
}

export function listApprovalParticipantPersonIds(
  tx: DbTransaction,
  workItemId: string,
) {
  return tx
    .select({ personId: schema.requestParticipantTable.personId })
    .from(schema.requestParticipantTable)
    .where(eq(schema.requestParticipantTable.workItemId, workItemId));
}

/**
 * Whether the named approver is still a valid approver of this approval's workspace: an
 * active, non-placeholder person with an account, and for a CAB approval still a member of a
 * CAB team of this workspace (0120 review check 4, re-applied at send time).
 */
export async function isApprovalApproverStillValid(
  tx: DbTransaction,
  approval: { approverId: string; kind: string; workspaceId: string },
) {
  const [person] = await tx
    .select({
      userId: schema.personTable.userId,
      active: schema.personTable.active,
      isPlaceholder: schema.personTable.isPlaceholder,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, approval.approverId))
    .limit(1);
  if (!person?.active || person.isPlaceholder || !person.userId) return false;
  if (approval.kind !== "cab") return true;
  const [member] = await tx
    .select({ id: schema.teamMemberTable.id })
    .from(schema.teamMemberTable)
    .innerJoin(
      schema.teamTable,
      eq(schema.teamTable.id, schema.teamMemberTable.teamId),
    )
    .where(
      and(
        eq(schema.teamMemberTable.userId, person.userId),
        eq(schema.teamTable.workspaceId, approval.workspaceId),
        eq(schema.teamTable.isCab, true),
      ),
    )
    .limit(1);
  return member !== undefined;
}
