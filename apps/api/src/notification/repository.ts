import { formatSubmissionReference } from "@taskdesk/domain";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { schema } from "../database";
import {
  currentProjectReachPredicate,
  currentWorkspaceReachPredicate,
} from "../database/repositories/identity-scope.repository";
import {
  apiKeyExtensionTable,
  apikeyTable,
  webhookTable,
} from "../database/schema";
import type { DbTransaction } from "../events/outbox";
import { findLinkedRequestOwnerPersonIds } from "./customer-request-scope";
import { isSupportedNotificationResourceEvent } from "./resource-contract";

export type CurrentNotificationResource = {
  workItemId?: string;
  workspaceId: string;
  projectId: string | null;
  organisationId: string | null;
  visibleToPersonIds: readonly string[] | null;
  customerVisible: boolean;
  staffUrl: string | null;
  /** Customer-host route only; never contains a staff key or internal resource id. */
  portalUrl: string | null;
  /** Server-side creator identity for events whose recipient rule includes the creator. */
  ownerPersonId?: string | null;
  /** Current requester ids for structurally linked, non-archived requests. */
  customerRequestOwnerPersonIds?: readonly string[];
};

export type NativeNotificationResourceRequest = {
  resourceType: "work_item" | "comment" | "webhook";
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
  identity: ResolvedIdentity,
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
  const webhookIds = [
    ...new Set(
      valid
        .filter((request) => request.resourceType === "webhook")
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
            currentProjectReachPredicate(
              identity,
              schema.projectTable.id,
              schema.projectTable.workspaceId,
              schema.projectTable.organisationId,
              tx,
            ),
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
            currentProjectReachPredicate(
              identity,
              schema.projectTable.id,
              schema.projectTable.workspaceId,
              schema.projectTable.organisationId,
              tx,
            ),
          ),
        )
    : [];
  const webhooks = webhookIds.length
    ? await tx
        .select({
          id: webhookTable.id,
          workspaceId: webhookTable.workspaceId,
          ownerPersonId: webhookTable.createdBy,
          organisationId: schema.workspaceTable.organisationId,
        })
        .from(webhookTable)
        .innerJoin(
          schema.workspaceTable,
          eq(schema.workspaceTable.id, webhookTable.workspaceId),
        )
        .where(
          and(
            inArray(webhookTable.id, webhookIds),
            isNull(schema.workspaceTable.deletedAt),
            currentWorkspaceReachPredicate(
              identity,
              schema.workspaceTable.id,
              tx,
            ),
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
  const linkedRequestOwners = await findLinkedRequestOwnerPersonIds(tx, [
    ...new Set([
      ...workItems.map(({ id }) => id),
      ...comments.map(({ workItemId }) => workItemId),
    ]),
  ]);
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
      customerRequestOwnerPersonIds: linkedRequestOwners.get(row.id) ?? [],
      customerVisible: true,
      staffUrl: `/agent/work-items/${encodeURIComponent(row.key)}`,
      portalUrl: "/requests",
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
      customerRequestOwnerPersonIds:
        linkedRequestOwners.get(row.workItemId) ?? [],
      customerVisible: row.visibility === "public",
      staffUrl: `/agent/work-items/${encodeURIComponent(row.key)}?comment=${encodeURIComponent(row.id)}`,
      portalUrl: row.visibility === "public" ? "/requests" : null,
    });
  }
  for (const row of webhooks) {
    facts.set(resourceKey("webhook", row.id), {
      workspaceId: row.workspaceId,
      projectId: null,
      organisationId: row.organisationId,
      visibleToPersonIds: null,
      customerVisible: false,
      staffUrl: `/agent/settings/webhooks/${encodeURIComponent(row.id)}`,
      portalUrl: null,
      ownerPersonId: row.ownerPersonId,
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
  const linkedRequestOwners = await findLinkedRequestOwnerPersonIds(tx, [
    row.id,
  ]);
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
    customerRequestOwnerPersonIds: linkedRequestOwners.get(row.id) ?? [],
    customerVisible: true,
    staffUrl: `/agent/work-items/${encodeURIComponent(row.key)}`,
    portalUrl: "/requests",
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
      // AP-21 (`P2R1-04`): an approval email links to the work item for staff and to the
      // portal Approvals screen for a customer approver; never a staff key on the portal.
      staffUrl: `/agent/work-items/${encodeURIComponent(context.workItemKey)}`,
      portalUrl: "/approvals",
    };
  }

  // IQ-12 / IQ-15 (`P2R1-05`): a submission reply or decline links to the submission itself.
  // Recipient eligibility is re-checked by `isCurrentSubmissionNotificationRecipient`.
  if (
    input.resourceType === "submission" &&
    isSupportedNotificationResourceEvent(input.resourceType, input.eventKind)
  ) {
    const submission = await findSubmissionNotificationResource(
      tx,
      input.resourceId,
    );
    if (!submission) return null;
    const ref = formatSubmissionReference(submission.number);
    return {
      workspaceId: submission.workspaceId,
      projectId: null,
      organisationId: submission.organisationId,
      visibleToPersonIds: [submission.requesterId],
      customerVisible: true,
      staffUrl: `/agent/triage?ref=${encodeURIComponent(ref)}`,
      portalUrl: `/submissions/${encodeURIComponent(ref)}`,
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
          staffUrl: resource.staffUrl
            ? `${resource.staffUrl}?comment=${encodeURIComponent(input.resourceId)}`
            : null,
          portalUrl: row.visibility === "public" ? resource.portalUrl : null,
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
      portalUrl: null,
    };
  }

  if (
    input.resourceType === "webhook" &&
    input.workspaceId &&
    isSupportedNotificationResourceEvent(input.resourceType, input.eventKind)
  ) {
    const [webhook] = await tx
      .select({
        id: webhookTable.id,
        workspaceId: webhookTable.workspaceId,
        ownerPersonId: webhookTable.createdBy,
        organisationId: schema.workspaceTable.organisationId,
      })
      .from(webhookTable)
      .innerJoin(
        schema.workspaceTable,
        eq(schema.workspaceTable.id, webhookTable.workspaceId),
      )
      .where(
        and(
          eq(webhookTable.id, input.resourceId),
          eq(webhookTable.workspaceId, input.workspaceId),
          isNull(schema.workspaceTable.deletedAt),
        ),
      )
      .limit(1);
    if (!webhook) return null;
    return {
      workspaceId: webhook.workspaceId,
      projectId: null,
      organisationId: webhook.organisationId,
      visibleToPersonIds: null,
      customerVisible: false,
      staffUrl: `/agent/settings/webhooks/${encodeURIComponent(webhook.id)}`,
      portalUrl: null,
      ownerPersonId: webhook.ownerPersonId,
    };
  }

  return null;
}

/** Current owner facts for the instance-scoped MCP-key auto-disable notification. */
export async function findApiKeyAutoDisableOwner(
  tx: DbTransaction,
  apiKeyId: string,
): Promise<{ userId: string; personId: string } | null> {
  const [row] = await tx
    .select({
      userId: apikeyTable.userId,
      personId: apiKeyExtensionTable.personId,
    })
    .from(apikeyTable)
    .innerJoin(
      apiKeyExtensionTable,
      eq(apiKeyExtensionTable.apikeyId, apikeyTable.id),
    )
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.id, apiKeyExtensionTable.personId),
    )
    .where(
      and(
        eq(apikeyTable.id, apiKeyId),
        eq(apikeyTable.referenceId, apikeyTable.userId),
        eq(schema.personTable.userId, apikeyTable.userId),
        eq(schema.personTable.side, "staff"),
        eq(schema.personTable.active, true),
        isNull(apiKeyExtensionTable.workspaceId),
        eq(apiKeyExtensionTable.isMcp, true),
      ),
    )
    .limit(1);
  return row?.userId && row.personId
    ? { userId: row.userId, personId: row.personId }
    : null;
}

/** Only current, active staff owners can read their personal MCP-key alert. */
export async function findCurrentOwnedApiKeyAutoDisableIds(
  tx: DbTransaction,
  identity: ResolvedIdentity,
  apiKeyIds: readonly string[],
): Promise<Set<string>> {
  if (identity.side !== "staff" || apiKeyIds.length === 0) return new Set();
  const rows = await tx
    .select({ id: apikeyTable.id })
    .from(apikeyTable)
    .innerJoin(
      apiKeyExtensionTable,
      eq(apiKeyExtensionTable.apikeyId, apikeyTable.id),
    )
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.id, apiKeyExtensionTable.personId),
    )
    .where(
      and(
        inArray(apikeyTable.id, [...new Set(apiKeyIds)]),
        eq(apikeyTable.userId, identity.userId),
        eq(apikeyTable.referenceId, identity.userId),
        eq(apiKeyExtensionTable.personId, identity.personId),
        eq(schema.personTable.userId, identity.userId),
        eq(schema.personTable.side, "staff"),
        eq(schema.personTable.active, true),
        isNull(apiKeyExtensionTable.workspaceId),
        eq(apiKeyExtensionTable.isMcp, true),
      ),
    );
  return new Set(rows.map(({ id }) => id));
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
      locale: schema.userTable.locale,
      quietHoursStart: schema.personTable.quietHoursStart,
      quietHoursEnd: schema.personTable.quietHoursEnd,
      quietHoursTimezone: schema.personTable.quietHoursTimezone,
    })
    .from(schema.personTable)
    .leftJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.personTable.userId),
    )
    .where(eq(schema.personTable.id, personId))
    .limit(1);
  return person ?? null;
}

/** The instance IANA zone (`instance_setting.timezone`), the quiet-hours/digest fallback. */
export async function findInstanceTimezone(tx: DbTransaction): Promise<string> {
  const [row] = await tx
    .select({ timezone: schema.instanceSettingTable.timezone })
    .from(schema.instanceSettingTable)
    .where(eq(schema.instanceSettingTable.id, "singleton"))
    .limit(1);
  return row?.timezone ?? "UTC";
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
      workItemKey: schema.workItemTable.key,
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
  return (
    tx
      .select({ personId: schema.watcherTable.personId })
      .from(schema.watcherTable)
      // `WI-29`: `muted` is the suppression flag an implicit watcher sets to opt out; a muted
      // watcher is never an approval-notification recipient.
      .where(
        and(
          eq(schema.watcherTable.workItemId, workItemId),
          eq(schema.watcherTable.muted, false),
        ),
      )
  );
}

/** Every watcher row of a work item with its mute flag; the caller decides who is told. */
export async function listWorkItemWatchers(
  tx: DbTransaction,
  workItemId: string,
) {
  return tx
    .select({
      personId: schema.watcherTable.personId,
      muted: schema.watcherTable.muted,
    })
    .from(schema.watcherTable)
    .where(eq(schema.watcherTable.workItemId, workItemId));
}

/**
 * The stored facts `submission.replied` recipients are resolved from: owner, last handler and
 * the workspace the submission's request type belongs to.
 */
export async function findSubmissionNotificationContext(
  tx: DbTransaction,
  number: number,
) {
  const [row] = await tx
    .select({
      id: schema.submissionTable.id,
      requesterId: schema.submissionTable.requesterId,
      claimedBy: schema.submissionTable.claimedBy,
      workspaceId: schema.requestTypeTable.workspaceId,
    })
    .from(schema.submissionTable)
    .innerJoin(
      schema.requestTypeTable,
      eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
    )
    .where(eq(schema.submissionTable.number, number))
    .limit(1);
  return row ?? null;
}

/**
 * `submission.replied` by the customer goes to "whoever last handled it" (feature-contracts-p4.md
 * NO-21): the author of the latest triager message on the thread (a clarification or any staff
 * message), else the triager who claimed it. Since `P2R1-08` keeps the first claim while another
 * triager clarifies, the claim alone would route the reply to someone who never asked
 * (`P2R2-02`). Shared by the fan-out resolver and the send-time recipient check.
 */
export async function findSubmissionLastHandlerId(
  tx: DbTransaction,
  submission: { id: string; claimedBy: string | null },
): Promise<string | null> {
  const [latest] = await tx
    .select({ authorId: schema.submissionMessageTable.authorId })
    .from(schema.submissionMessageTable)
    .where(
      and(
        eq(schema.submissionMessageTable.submissionId, submission.id),
        eq(schema.submissionMessageTable.actorType, "triager"),
      ),
    )
    .orderBy(
      desc(schema.submissionMessageTable.createdAt),
      desc(schema.submissionMessageTable.id),
    )
    .limit(1);
  return latest?.authorId ?? submission.claimedBy;
}

/** The submission behind a `submission` notification resource, for send-time resolution. */
export async function findSubmissionNotificationResource(
  tx: DbTransaction,
  submissionId: string,
) {
  const [row] = await tx
    .select({
      number: schema.submissionTable.number,
      organisationId: schema.submissionTable.organisationId,
      requesterId: schema.submissionTable.requesterId,
      workspaceId: schema.requestTypeTable.workspaceId,
    })
    .from(schema.submissionTable)
    .innerJoin(
      schema.requestTypeTable,
      eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
    )
    .where(eq(schema.submissionTable.id, submissionId))
    .limit(1);
  return row ?? null;
}

/** The work item's current assignee person id (null when unassigned or missing). */
export async function findWorkItemAssigneeId(
  tx: DbTransaction,
  workItemId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ assigneeId: schema.workItemTable.assigneeId })
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.id, workItemId))
    .limit(1);
  return row?.assigneeId ?? null;
}

/**
 * NO-21 "project leads": persons holding the system `project-lead` role at this project's own
 * scope (`membership.scope = 'project'`). The role is resolved per workspace by key, never by
 * display name; a deactivated person is filtered by the caller's active check.
 */
export async function listProjectLeadPersonIds(
  tx: DbTransaction,
  input: { projectId: string; workspaceId: string },
): Promise<string[]> {
  const rows = await tx
    .select({ personId: schema.membershipTable.personId })
    .from(schema.membershipTable)
    .innerJoin(
      schema.roleTable,
      eq(schema.roleTable.id, schema.membershipTable.roleId),
    )
    .where(
      and(
        eq(schema.membershipTable.scope, "project"),
        eq(schema.membershipTable.scopeId, input.projectId),
        eq(schema.roleTable.scope, "project"),
        eq(schema.roleTable.workspaceId, input.workspaceId),
        eq(schema.roleTable.key, "project-lead"),
      ),
    );
  return [...new Set(rows.map(({ personId }) => personId))];
}

/** The project's stakeholder rows for the escalation walk, ordered (SLA-17 / NO-22). */
export async function listProjectStakeholders(
  tx: DbTransaction,
  projectId: string,
) {
  return tx
    .select({
      personId: schema.stakeholderTable.personId,
      escalationOrder: schema.stakeholderTable.escalationOrder,
      escalationWaitMinutes: schema.stakeholderTable.escalationWaitMinutes,
      active: schema.stakeholderTable.active,
    })
    .from(schema.stakeholderTable)
    .where(eq(schema.stakeholderTable.projectId, projectId))
    .orderBy(
      asc(schema.stakeholderTable.escalationOrder),
      asc(schema.stakeholderTable.personId),
    );
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
