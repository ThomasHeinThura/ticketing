import type { JsonValue } from "@taskdesk/domain";
import { can, type ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import db from "../database";
import {
  currentInstanceAdminPredicate,
  currentProjectReachPredicate,
  currentWorkspaceReachPredicate,
} from "../database/repositories/identity-scope.repository";
import {
  commentTable,
  notificationTable,
  personTable,
  projectTable,
  taskTable,
  workItemTable,
  workspaceTable,
} from "../database/schema";
import { resolveIdentity } from "../permissions/resolve-identity";
import type { AuthenticatedApiKey } from "../permissions/resolve-request-identity";
import { projectAncestryFor } from "../utils/project-ancestry";
import { apiKeyCapabilitySubset } from "../utils/require-api-key-permission-scope";
import { approvalNotificationReadable } from "./approval-reach.repository";
import {
  canReadNativeInboxCandidate,
  type NativeInboxCandidate,
  nativeInboxResourceKey,
} from "./native-inbox-reach";
import {
  findCurrentNotificationResources,
  type NativeNotificationResourceRequest,
} from "./repository";
import { reachableTaskNotificationPredicate } from "./task-reach.repository";

type NotificationRow = typeof notificationTable.$inferSelect;
type NotificationCandidate = Pick<
  NotificationRow,
  | "id"
  | "userId"
  | "personId"
  | "type"
  | "isRead"
  | "resourceId"
  | "resourceType"
  | "eventId"
  | "kind"
  | "readAt"
  | "createdAt"
  | "updatedAt"
>;
type PolicyCandidate = NotificationCandidate & { eventKind: string | null };
interface MaterializedNotificationRow {
  id: NotificationRow["id"];
  userId: NotificationRow["userId"];
  title: NotificationRow["title"];
  content: NotificationRow["content"];
  type: NotificationRow["type"];
  eventData: JsonValue | null;
  isRead: NotificationRow["isRead"];
  resourceId: NotificationRow["resourceId"];
  resourceType: NotificationRow["resourceType"];
  personId: NotificationRow["personId"];
  eventId: NotificationRow["eventId"];
  kind: NotificationRow["kind"];
  body: NotificationRow["body"];
  readAt: NotificationRow["readAt"];
  createdAt: NotificationRow["createdAt"];
  updatedAt: NotificationRow["updatedAt"];
}
type NativeInboxCredential = {
  apiKey?: AuthenticatedApiKey;
  impersonatedBy?: string | null;
};
type InboxExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

type Cursor = { createdAt: Date; id: string };
const CANDIDATE_PAGE_SIZE = 100;

/**
 * `event_data` is PostgreSQL JSONB. The app Pool installs no custom parser;
 * node-postgres' JSONB parser uses `JSON.parse`, and Drizzle's JSONB mapper returns
 * that materialized JSON value unchanged. Narrow only this persisted JSON leaf to the
 * domain's existing JSON value type; preserve every value, including SQL/JSON null.
 */
function materializeNotification(
  row: NotificationRow,
): MaterializedNotificationRow {
  return { ...row, eventData: row.eventData as JsonValue | null };
}

function isSerializationFailure(error: unknown) {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 5 && current && typeof current === "object";
    depth += 1
  ) {
    const value = current as { code?: unknown; cause?: unknown };
    if (value.code === "40001") return true;
    current = value.cause;
  }
  return false;
}

async function inboxTransaction<T>(
  operation: (tx: InboxExecutor) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.transaction(operation, {
        isolationLevel: "repeatable read",
      });
    } catch (error) {
      if (!isSerializationFailure(error) || attempt === 2) throw error;
    }
  }
  throw new Error("Notification inbox transaction exhausted its retries");
}

/** Only resource classes with a current closed policy may enter an inbox candidate page. */
function registeredNotificationResource() {
  return or(
    eq(notificationTable.resourceType, "task"),
    eq(notificationTable.resourceType, "approval"),
    eq(notificationTable.resourceType, "work_item"),
    eq(notificationTable.resourceType, "comment"),
    eq(notificationTable.resourceType, "workspace"),
    eq(notificationTable.resourceType, "pending_action"),
    eq(notificationTable.resourceType, "instance"),
    eq(notificationTable.resourceType, "person"),
    sql`false`,
  );
}

function taskNotificationReadable(
  userId: string,
  executor: InboxExecutor,
  credentialCanReadTask?: boolean,
) {
  return or(
    ne(notificationTable.resourceType, "task"),
    credentialCanReadTask === undefined
      ? reachableTaskNotificationPredicate(userId, true, executor)
      : reachableTaskNotificationPredicate(
          userId,
          credentialCanReadTask,
          executor,
        ),
  );
}

function cursorPredicate(cursor?: Cursor) {
  return cursor
    ? or(
        lt(notificationTable.createdAt, cursor.createdAt),
        and(
          eq(notificationTable.createdAt, cursor.createdAt),
          lt(notificationTable.id, cursor.id),
        ),
      )
    : undefined;
}

function bindSameRow(row: NotificationCandidate) {
  return and(
    eq(notificationTable.id, row.id),
    eq(notificationTable.userId, row.userId),
    eq(notificationTable.type, row.type),
    row.personId === null
      ? isNull(notificationTable.personId)
      : eq(notificationTable.personId, row.personId),
    row.resourceType === null
      ? isNull(notificationTable.resourceType)
      : eq(notificationTable.resourceType, row.resourceType),
    row.resourceId === null
      ? isNull(notificationTable.resourceId)
      : eq(notificationTable.resourceId, row.resourceId),
    row.kind === null
      ? isNull(notificationTable.kind)
      : eq(notificationTable.kind, row.kind),
  );
}

async function resolveInboxIdentity(
  tx: InboxExecutor,
  userId: string,
  credential: NativeInboxCredential = {},
): Promise<ResolvedIdentity | null> {
  const { apiKey, impersonatedBy } = credential;
  return resolveIdentity(
    {
      userId,
      credential: apiKey
        ? "api_key"
        : impersonatedBy
          ? "impersonation"
          : "session",
      ...(apiKey
        ? {
            apiKey: {
              enabled: apiKey.enabled,
              ownerUserId: apiKey.userId,
              capabilities: apiKeyCapabilitySubset(apiKey),
            },
          }
        : {}),
    },
    tx,
  );
}

function nativeRequests(rows: readonly NotificationCandidate[]) {
  return rows.flatMap((row): NativeNotificationResourceRequest[] =>
    (row.resourceType === "work_item" || row.resourceType === "comment") &&
    row.resourceId &&
    row.kind
      ? [
          {
            resourceType: row.resourceType,
            resourceId: row.resourceId,
            eventKind: row.kind,
          },
        ]
      : [],
  );
}

function canReadInstanceAlerts(identity: ResolvedIdentity | null) {
  return (
    identity?.side === "staff" &&
    can(identity, "instance:admin", "instance", {})
  );
}

async function readableNativeRows(
  tx: InboxExecutor,
  rows: readonly PolicyCandidate[],
  identity: ResolvedIdentity | null,
) {
  if (!identity) return [];
  const resources = await findCurrentNotificationResources(
    tx,
    identity,
    nativeRequests(rows),
  );
  // PR-2/PR-3: reach and read authority follow each resource project's ancestor chain.
  const ancestorsByProject = new Map<string, string[]>();
  for (const resource of resources.values()) {
    if (
      resource.projectId !== null &&
      !ancestorsByProject.has(resource.projectId)
    )
      ancestorsByProject.set(
        resource.projectId,
        await projectAncestryFor(
          tx,
          identity,
          resource.workspaceId,
          resource.projectId,
        ),
      );
  }
  const workspaceRows = rows.filter(
    (row) =>
      row.resourceType === "workspace" &&
      (row.type === "workspace_created" || row.kind === "workspace.created") &&
      row.resourceId,
  );
  const workspaceIds = [
    ...new Set(
      workspaceRows
        .map((row) => row.resourceId)
        .filter((resourceId): resourceId is string => resourceId !== null),
    ),
  ];
  const currentWorkspaces = workspaceIds.length
    ? await tx
        .select({
          id: workspaceTable.id,
          organisationId: workspaceTable.organisationId,
        })
        .from(workspaceTable)
        .where(
          and(
            inArray(workspaceTable.id, workspaceIds),
            isNull(workspaceTable.deletedAt),
            currentWorkspaceReachPredicate(identity, workspaceTable.id, tx),
          ),
        )
    : [];
  const workspaceFacts = new Map(currentWorkspaces.map((row) => [row.id, row]));
  return rows.filter((row) => {
    if (
      !identity ||
      row.userId !== identity.userId ||
      !row.resourceType ||
      !row.resourceId
    )
      return false;
    if (row.resourceType === "task") {
      return [
        "task_created",
        "task_status_changed",
        "task_assignee_changed",
        "time_entry_created",
        "task_mention",
        "task_comment",
        "due_date_reminder",
        "task_overdue",
      ].includes(row.type);
    }
    if (row.resourceType === "approval") {
      return (
        row.personId === identity.personId &&
        [
          "approval.requested",
          "approval.decided",
          "approval.expiring",
          "approval.expired",
          "approval.withdrawn",
        ].includes(row.kind ?? "")
      );
    }
    if (row.resourceType === "pending_action") {
      return (
        row.personId === identity.personId &&
        ["pending_action.requested", "pending_action.executed"].includes(
          row.kind ?? "",
        )
      );
    }
    if (row.resourceType === "workspace") {
      const workspace = workspaceFacts.get(row.resourceId);
      const reachable =
        workspace &&
        (identity.reach.kind === "all" ||
          (identity.reach.kind === "organisation" &&
            identity.reach.ids.includes(workspace.organisationId)) ||
          (identity.reach.kind === "membership_with_workspaces" &&
            identity.reach.workspaceIds.includes(workspace.id)) ||
          identity.memberships.some(
            (membership) =>
              membership.scope === "workspace" &&
              membership.scopeId === workspace.id,
          ) ||
          identity.authority.some(
            (grant) =>
              grant.scope === "workspace" && grant.scopeId === workspace.id,
          ));
      return (
        (row.type === "workspace_created" ||
          row.kind === "workspace.created") &&
        Boolean(
          workspace &&
            reachable &&
            can(identity, "workspace:read", "workspace", {
              workspaceId: workspace.id,
            }),
        )
      );
    }
    if (row.resourceType === "instance") {
      return (
        row.resourceId === "singleton" &&
        canReadInstanceAlerts(identity) &&
        (row.type === "audit_write_failed" ||
          (row.type === "security_alert" &&
            row.eventKind === "instance_admin_granted"))
      );
    }
    if (row.resourceType === "person") {
      return (
        row.type === "security_alert" &&
        row.eventKind === "mfa_reset" &&
        row.resourceId === identity.personId &&
        row.personId === identity.personId
      );
    }
    if (row.resourceType !== "work_item" && row.resourceType !== "comment")
      return false;
    const candidate: NativeInboxCandidate = {
      userId: row.userId,
      personId: row.personId,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      kind: row.kind,
    };
    const resource =
      row.resourceType && row.resourceId
        ? resources.get(
            nativeInboxResourceKey(row.resourceType, row.resourceId),
          )
        : undefined;
    return canReadNativeInboxCandidate(
      identity,
      candidate,
      resource,
      resource?.projectId
        ? ancestorsByProject.get(resource.projectId)
        : undefined,
    );
  });
}

async function selectCandidatePage(
  tx: InboxExecutor,
  userId: string,
  cursor: Cursor | undefined,
  credentialCanReadTask?: boolean,
  excludeInstanceAdminRows = false,
) {
  const selfScoped = and(
    eq(notificationTable.userId, userId),
    registeredNotificationResource(),
    approvalNotificationReadable(userId, tx),
    taskNotificationReadable(userId, tx, credentialCanReadTask),
  );
  const visibleToUser = excludeInstanceAdminRows
    ? and(
        selfScoped,
        ne(notificationTable.resourceType, "instance"),
        ne(notificationTable.type, "audit_write_failed"),
      )
    : selfScoped;
  const cursorFilter = cursorPredicate(cursor);
  return tx
    .select({
      notification: {
        id: notificationTable.id,
        userId: notificationTable.userId,
        personId: notificationTable.personId,
        type: notificationTable.type,
        isRead: notificationTable.isRead,
        resourceId: notificationTable.resourceId,
        resourceType: notificationTable.resourceType,
        eventId: notificationTable.eventId,
        kind: notificationTable.kind,
        eventKind: sql<string | null>`${notificationTable.eventData}->>'kind'`,
        readAt: notificationTable.readAt,
        createdAt: notificationTable.createdAt,
        updatedAt: notificationTable.updatedAt,
      },
      projectId: projectTable.id,
      workspaceId: workspaceTable.id,
    })
    .from(notificationTable)
    .leftJoin(
      taskTable,
      and(
        eq(notificationTable.resourceId, taskTable.id),
        eq(notificationTable.resourceType, "task"),
      ),
    )
    .leftJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .where(cursorFilter ? and(visibleToUser, cursorFilter) : visibleToUser)
    .orderBy(desc(notificationTable.createdAt), desc(notificationTable.id))
    .limit(CANDIDATE_PAGE_SIZE);
}

function currentOwnerPredicate(
  row: NotificationCandidate,
  identity: ResolvedIdentity,
  executor: InboxExecutor,
  credentialCanReadTask = true,
) {
  if (row.resourceType === "task") {
    return exists(
      executor
        .select({ one: sql`1` })
        .from(taskTable)
        .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
        .innerJoin(
          workspaceTable,
          eq(workspaceTable.id, projectTable.workspaceId),
        )
        .where(
          and(
            eq(taskTable.id, notificationTable.resourceId),
            isNull(projectTable.deletedAt),
            isNull(workspaceTable.deletedAt),
            reachableTaskNotificationPredicate(
              identity.userId,
              credentialCanReadTask,
              executor,
            ),
          ),
        ),
    );
  }
  if (row.resourceType === "approval")
    return approvalNotificationReadable(row.userId, executor);
  if (row.resourceType === "pending_action") {
    return and(
      eq(notificationTable.personId, identity.personId),
      inArray(notificationTable.kind, [
        "pending_action.requested",
        "pending_action.executed",
      ]),
    );
  }
  if (row.resourceType === "workspace") {
    return exists(
      executor
        .select({ one: sql`1` })
        .from(workspaceTable)
        .where(
          and(
            eq(workspaceTable.id, notificationTable.resourceId),
            isNull(workspaceTable.deletedAt),
            currentWorkspaceReachPredicate(
              identity,
              workspaceTable.id,
              executor,
            ),
            or(
              eq(notificationTable.type, "workspace_created"),
              eq(notificationTable.kind, "workspace.created"),
            ),
          ),
        ),
    );
  }
  if (row.resourceType === "person") {
    return exists(
      executor
        .select({ one: sql`1` })
        .from(personTable)
        .where(
          and(
            eq(personTable.id, notificationTable.resourceId),
            eq(personTable.id, notificationTable.personId),
            eq(personTable.userId, identity.userId),
            eq(notificationTable.userId, identity.userId),
          ),
        ),
    );
  }
  if (row.resourceType === "work_item") {
    return exists(
      executor
        .select({ one: sql`1` })
        .from(workItemTable)
        .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
        .innerJoin(
          workspaceTable,
          eq(workspaceTable.id, projectTable.workspaceId),
        )
        .where(
          and(
            eq(workItemTable.id, notificationTable.resourceId),
            isNull(workItemTable.deletedAt),
            isNull(workItemTable.archivedAt),
            isNull(projectTable.deletedAt),
            isNull(workspaceTable.deletedAt),
            currentProjectReachPredicate(
              identity,
              projectTable.id,
              projectTable.workspaceId,
              projectTable.organisationId,
              executor,
            ),
          ),
        ),
    );
  }
  if (row.resourceType === "comment") {
    return exists(
      executor
        .select({ one: sql`1` })
        .from(commentTable)
        .innerJoin(workItemTable, eq(workItemTable.id, commentTable.workItemId))
        .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
        .innerJoin(
          workspaceTable,
          eq(workspaceTable.id, projectTable.workspaceId),
        )
        .where(
          and(
            eq(commentTable.id, notificationTable.resourceId),
            isNull(workItemTable.deletedAt),
            isNull(workItemTable.archivedAt),
            isNull(projectTable.deletedAt),
            isNull(workspaceTable.deletedAt),
            currentProjectReachPredicate(
              identity,
              projectTable.id,
              projectTable.workspaceId,
              projectTable.organisationId,
              executor,
            ),
          ),
        ),
    );
  }
  return and(
    eq(notificationTable.resourceId, "singleton"),
    currentInstanceAdminPredicate(identity, executor),
  );
}

async function fetchAllowedRows(
  tx: InboxExecutor,
  rows: readonly NotificationCandidate[],
  identity: ResolvedIdentity,
  credentialCanReadTask = true,
) {
  if (rows.length === 0) return [];
  return tx
    .select({
      notification: notificationTable,
      projectId: projectTable.id,
      workspaceId: workspaceTable.id,
    })
    .from(notificationTable)
    .leftJoin(
      taskTable,
      and(
        eq(notificationTable.resourceId, taskTable.id),
        eq(notificationTable.resourceType, "task"),
      ),
    )
    .leftJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .where(
      or(
        ...rows.map((row) =>
          and(
            bindSameRow(row),
            currentOwnerPredicate(row, identity, tx, credentialCanReadTask),
          ),
        ),
      ),
    )
    .orderBy(desc(notificationTable.createdAt), desc(notificationTable.id));
}

async function bulkMutation(userId: string, mode: "read" | "delete") {
  await inboxTransaction(async (tx) => {
    const identity = await resolveInboxIdentity(tx, userId);
    if (!identity) return;
    const excludeInstanceAlerts = !canReadInstanceAlerts(identity);
    let cursor: Cursor | undefined;
    while (true) {
      const page = await selectCandidatePage(
        tx,
        userId,
        cursor,
        undefined,
        excludeInstanceAlerts,
      );
      if (page.length === 0) break;
      const rows = page.map(({ notification }) => notification);
      const allowed = await readableNativeRows(tx, rows, identity);
      if (allowed.length > 0) {
        const rowGuard = or(
          ...allowed.map((row) =>
            and(bindSameRow(row), currentOwnerPredicate(row, identity, tx)),
          ),
        );
        if (mode === "read") {
          await tx
            .update(notificationTable)
            .set({ isRead: true })
            .where(and(eq(notificationTable.userId, userId), rowGuard));
        } else {
          await tx
            .delete(notificationTable)
            .where(and(eq(notificationTable.userId, userId), rowGuard));
        }
      }
      const last = rows.at(-1);
      if (!last) break;
      cursor = { createdAt: last.createdAt, id: last.id };
      if (page.length < CANDIDATE_PAGE_SIZE) break;
    }
  });
}

export async function deleteReadableNotifications(userId: string) {
  await bulkMutation(userId, "delete");
}

export async function markReadableNotificationsRead(userId: string) {
  await bulkMutation(userId, "read");
}

/** The caller's own notification type, or `undefined` (used to hide admin-only alerts). */
export async function findOwnNotificationType(id: string, userId: string) {
  const [existing] = await db
    .select({ type: notificationTable.type })
    .from(notificationTable)
    .where(
      and(eq(notificationTable.id, id), eq(notificationTable.userId, userId)),
    )
    .limit(1);
  return existing;
}

export async function markOwnReadableNotificationRead(
  id: string,
  userId: string,
): Promise<MaterializedNotificationRow | undefined> {
  return inboxTransaction(async (tx) => {
    const [row] = await tx
      .select({
        notification: {
          id: notificationTable.id,
          userId: notificationTable.userId,
          personId: notificationTable.personId,
          type: notificationTable.type,
          isRead: notificationTable.isRead,
          resourceId: notificationTable.resourceId,
          resourceType: notificationTable.resourceType,
          eventId: notificationTable.eventId,
          kind: notificationTable.kind,
          readAt: notificationTable.readAt,
          eventKind: sql<
            string | null
          >`${notificationTable.eventData}->>'kind'`,
          createdAt: notificationTable.createdAt,
          updatedAt: notificationTable.updatedAt,
        },
      })
      .from(notificationTable)
      .where(
        and(
          eq(notificationTable.id, id),
          eq(notificationTable.userId, userId),
          registeredNotificationResource(),
          approvalNotificationReadable(userId, tx),
          taskNotificationReadable(userId, tx),
        ),
      )
      .limit(1);
    if (!row) return undefined;
    const identity = await resolveInboxIdentity(tx, userId);
    if (!identity) return undefined;
    const allowed = await readableNativeRows(tx, [row.notification], identity);
    if (allowed.length === 0) return undefined;
    const [content] = await fetchAllowedRows(tx, allowed, identity);
    if (!content) return undefined;
    const notification = content.notification;
    const [updated] = await tx
      .update(notificationTable)
      .set({ isRead: true })
      .where(
        and(
          bindSameRow(notification),
          currentOwnerPredicate(notification, identity, tx),
          registeredNotificationResource(),
          approvalNotificationReadable(userId, tx),
          taskNotificationReadable(userId, tx),
        ),
      )
      .returning();
    return updated ? materializeNotification(updated) : undefined;
  });
}

/** The newest 50 visible inbox rows; native work-item/comment rows are authorized in
 * keyset pages before the response limit is applied. */
export async function listVisibleNotificationRows(params: {
  userId: string;
  credentialCanReadTask: boolean;
  credential?: NativeInboxCredential;
}): Promise<
  Array<{
    notification: MaterializedNotificationRow;
    projectId: string | null;
    workspaceId: string | null;
  }>
> {
  const { userId, credentialCanReadTask, credential = {} } = params;
  return inboxTransaction(async (tx) => {
    const identity = await resolveInboxIdentity(tx, userId, credential);
    if (!identity) return [];
    const includeInstanceAlerts = canReadInstanceAlerts(identity);
    const results: Array<{
      notification: MaterializedNotificationRow;
      projectId: string | null;
      workspaceId: string | null;
    }> = [];
    let cursor: Cursor | undefined;
    while (results.length < 50) {
      const page = await selectCandidatePage(
        tx,
        userId,
        cursor,
        credentialCanReadTask,
        !includeInstanceAlerts,
      );
      const candidates = page.map(({ notification }) => notification);
      const allowed = await readableNativeRows(tx, candidates, identity);
      const contentRows = await fetchAllowedRows(
        tx,
        allowed,
        identity,
        credentialCanReadTask,
      );
      for (const item of contentRows) {
        results.push({
          ...item,
          notification: materializeNotification(item.notification),
        });
        if (results.length === 50) break;
      }
      const last = page.at(-1)?.notification;
      if (!last || page.length < CANDIDATE_PAGE_SIZE) break;
      cursor = { createdAt: last.createdAt, id: last.id };
    }
    return results;
  });
}

export async function findNotificationPreferenceRow(userId: string) {
  return db.query.userNotificationPreferenceTable.findFirst({
    where: (table, { eq }) => eq(table.userId, userId),
  });
}

export async function insertNotificationRow(
  values: typeof notificationTable.$inferInsert,
): Promise<MaterializedNotificationRow | undefined> {
  const [notification] = await db
    .insert(notificationTable)
    .values(values)
    .returning();
  return notification ? materializeNotification(notification) : undefined;
}

/** The project's workspace id, or `undefined`. */
export async function findProjectWorkspaceId(projectId: string) {
  const [project] = await db
    .select({ workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  return project;
}

/** The task's project id, or `undefined`. */
export async function findTaskProjectId(taskId: string) {
  const [task] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);
  return task;
}
