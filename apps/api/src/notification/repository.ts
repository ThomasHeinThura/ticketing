import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { schema } from "../database";
import type { DbTransaction } from "../events/outbox";
import { isSupportedNotificationResourceEvent } from "./resource-contract";

export type CurrentNotificationResource = {
  workItemId?: string;
  workspaceId: string;
  projectId: string | null;
  organisationId: string | null;
  visibleToPersonIds: readonly string[] | null;
  customerVisible: boolean;
  staffUrl: string | null;
};

export type NativeNotificationResourceRequest = {
  resourceType: "work_item" | "comment";
  resourceId: string;
  eventKind: string;
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

function resourceKey(resourceType: string, resourceId: string) {
  return `${resourceType}\u0000${resourceId}`;
}

/** Batch-load current native inbox resource facts: one item query, one comment query,
 * and one participant query per candidate page, not one lookup per notification. */
export async function findCurrentNotificationResources(
  tx: DbTransaction,
  requests: readonly NativeNotificationResourceRequest[],
): Promise<Map<string, CurrentNotificationResource>> {
  const valid = requests.filter(
    (request) =>
      request.resourceId.length > 0 &&
      isSupportedNotificationResourceEvent(
        request.resourceType,
        request.eventKind,
      ),
  );
  const workItemIds = [
    ...new Set(
      valid
        .filter((request) => request.resourceType === "work_item")
        .map(({ resourceId }) => resourceId),
    ),
  ];
  const commentIds = [
    ...new Set(
      valid
        .filter((request) => request.resourceType === "comment")
        .map(({ resourceId }) => resourceId),
    ),
  ];
  const workItems: ResourceRow[] = workItemIds.length
    ? await tx
        .select({
          id: schema.workItemTable.id,
          key: schema.workItemTable.key,
          workspaceId: schema.workItemTable.workspaceId,
          projectId: schema.workItemTable.projectId,
          organisationId: schema.projectTable.organisationId,
          requesterId: schema.workItemTable.requesterId,
          customerVisibility: schema.workItemTable.customerVisibility,
        })
        .from(schema.workItemTable)
        .innerJoin(
          schema.projectTable,
          eq(schema.projectTable.id, schema.workItemTable.projectId),
        )
        .innerJoin(
          schema.workspaceTable,
          eq(schema.workspaceTable.id, schema.workItemTable.workspaceId),
        )
        .where(
          and(
            or(
              inArray(schema.workItemTable.id, workItemIds),
              inArray(schema.workItemTable.key, workItemIds),
            ),
            isNull(schema.workItemTable.deletedAt),
            isNull(schema.workItemTable.archivedAt),
            isNull(schema.projectTable.deletedAt),
            isNull(schema.workspaceTable.deletedAt),
          ),
        )
    : [];
  const comments = commentIds.length
    ? await tx
        .select({
          id: schema.commentTable.id,
          visibility: schema.commentTable.visibility,
          workItemId: schema.workItemTable.id,
          key: schema.workItemTable.key,
          workspaceId: schema.workItemTable.workspaceId,
          projectId: schema.workItemTable.projectId,
          organisationId: schema.projectTable.organisationId,
          requesterId: schema.workItemTable.requesterId,
          customerVisibility: schema.workItemTable.customerVisibility,
        })
        .from(schema.commentTable)
        .innerJoin(
          schema.workItemTable,
          eq(schema.workItemTable.id, schema.commentTable.workItemId),
        )
        .innerJoin(
          schema.projectTable,
          eq(schema.projectTable.id, schema.workItemTable.projectId),
        )
        .innerJoin(
          schema.workspaceTable,
          eq(schema.workspaceTable.id, schema.workItemTable.workspaceId),
        )
        .where(
          and(
            inArray(schema.commentTable.id, commentIds),
            isNull(schema.commentTable.deletedAt),
            sql`${schema.commentTable.body} IS NOT NULL`,
            isNull(schema.workItemTable.deletedAt),
            isNull(schema.workItemTable.archivedAt),
            isNull(schema.projectTable.deletedAt),
            isNull(schema.workspaceTable.deletedAt),
          ),
        )
    : [];
  const privateWorkItemIds = [
    ...new Set([
      ...workItems
        .filter(({ customerVisibility }) => customerVisibility === "private")
        .map(({ id }) => id),
      ...comments
        .filter(({ customerVisibility }) => customerVisibility === "private")
        .map(({ workItemId }) => workItemId),
    ]),
  ];
  const participants = privateWorkItemIds.length
    ? await tx
        .select({
          workItemId: schema.requestParticipantTable.workItemId,
          personId: schema.requestParticipantTable.personId,
        })
        .from(schema.requestParticipantTable)
        .where(
          inArray(
            schema.requestParticipantTable.workItemId,
            privateWorkItemIds,
          ),
        )
    : [];
  const peopleByWorkItem = new Map<string, string[]>();
  for (const participant of participants) {
    if (participant.workItemId === null) continue;
    const people = peopleByWorkItem.get(participant.workItemId) ?? [];
    people.push(participant.personId);
    peopleByWorkItem.set(participant.workItemId, people);
  }
  const facts = new Map<string, CurrentNotificationResource>();
  for (const row of workItems) {
    const resource: CurrentNotificationResource = {
      workItemId: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      organisationId: row.organisationId,
      visibleToPersonIds: visiblePeople(
        row.requesterId,
        row.customerVisibility,
        peopleByWorkItem.get(row.id) ?? [],
      ),
      customerVisible: true,
      staffUrl: `/agent/work-items/${encodeURIComponent(row.key)}`,
    };
    facts.set(resourceKey("work_item", row.id), resource);
    facts.set(resourceKey("work_item", row.key), resource);
  }
  for (const row of comments) {
    if (row.visibility !== "public" && row.visibility !== "internal") continue;
    facts.set(resourceKey("comment", row.id), {
      workItemId: row.workItemId,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      organisationId: row.organisationId,
      visibleToPersonIds: visiblePeople(
        row.requesterId,
        row.customerVisibility,
        peopleByWorkItem.get(row.workItemId) ?? [],
      ),
      customerVisible: row.visibility === "public",
      staffUrl: null,
    });
  }
  return facts;
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
    workItemId: row.id,
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
         AND c.deleted_at IS NULL
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

export async function listApprovalWatcherPersonIds(
  tx: DbTransaction,
  workItemId: string,
) {
  return tx
    .select({ personId: schema.watcherTable.personId })
    .from(schema.watcherTable)
    .where(eq(schema.watcherTable.workItemId, workItemId));
}

export async function listApprovalParticipantPersonIds(
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
