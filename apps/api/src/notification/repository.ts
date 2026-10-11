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
  },
): Promise<CurrentNotificationResource | null> {
  if (!input.resourceType || !input.resourceId) return null;

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
