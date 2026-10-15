import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, desc, eq, isNull, lt, ne, or } from "drizzle-orm";
import db from "../database";
import {
  notificationTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../database/schema";
import { resolveIdentity } from "../permissions/resolve-identity";
import type { AuthenticatedApiKey } from "../permissions/resolve-request-identity";
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
type NativeInboxCredential = {
  apiKey?: AuthenticatedApiKey;
  impersonatedBy?: string | null;
};
type InboxExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

type Cursor = { createdAt: Date; id: string };
const CANDIDATE_PAGE_SIZE = 100;

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

/** Legacy task and approval restrictions remain in SQL; other old resource types retain
 * their existing behavior. Native work-item/comment decisions run in the canonical policy
 * evaluator before any row is returned or changed. */
function taskNotificationReadable(
  userId: string,
  credentialCanReadTask?: boolean,
) {
  return or(
    isNull(notificationTable.resourceType),
    ne(notificationTable.resourceType, "task"),
    credentialCanReadTask === undefined
      ? reachableTaskNotificationPredicate(userId)
      : reachableTaskNotificationPredicate(userId, credentialCanReadTask),
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

function bindSameRow(row: NotificationRow) {
  return and(
    eq(notificationTable.id, row.id),
    eq(notificationTable.userId, row.userId),
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

function nativeRequests(rows: readonly NotificationRow[]) {
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

async function readableNativeRows(
  tx: InboxExecutor,
  rows: readonly NotificationRow[],
  identity: ResolvedIdentity | null,
) {
  const resources = await findCurrentNotificationResources(
    tx,
    nativeRequests(rows),
  );
  return rows.filter((row) => {
    if (row.resourceType !== "work_item" && row.resourceType !== "comment") {
      return true;
    }
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
    return canReadNativeInboxCandidate(identity, candidate, resource);
  });
}

async function selectCandidatePage(
  tx: InboxExecutor,
  userId: string,
  cursor: Cursor | undefined,
  credentialCanReadTask?: boolean,
  excludeInstanceAlerts = false,
) {
  const selfScoped = and(
    eq(notificationTable.userId, userId),
    approvalNotificationReadable(userId),
    taskNotificationReadable(userId, credentialCanReadTask),
  );
  const visibleToUser = excludeInstanceAlerts
    ? and(selfScoped, ne(notificationTable.type, "audit_write_failed"))
    : selfScoped;
  const cursorFilter = cursorPredicate(cursor);
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
    .where(cursorFilter ? and(visibleToUser, cursorFilter) : visibleToUser)
    .orderBy(desc(notificationTable.createdAt), desc(notificationTable.id))
    .limit(CANDIDATE_PAGE_SIZE);
}

async function bulkMutation(userId: string, mode: "read" | "delete") {
  await inboxTransaction(async (tx) => {
    const identity = await resolveInboxIdentity(tx, userId);
    let cursor: Cursor | undefined;
    while (true) {
      const page = await selectCandidatePage(tx, userId, cursor);
      if (page.length === 0) break;
      const rows = page.map(({ notification }) => notification);
      const allowed = await readableNativeRows(tx, rows, identity);
      if (allowed.length > 0) {
        const rowGuard = or(...allowed.map(bindSameRow));
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
) {
  return inboxTransaction(async (tx) => {
    const [row] = await tx
      .select({ notification: notificationTable })
      .from(notificationTable)
      .where(
        and(
          eq(notificationTable.id, id),
          eq(notificationTable.userId, userId),
          approvalNotificationReadable(userId),
          taskNotificationReadable(userId),
        ),
      )
      .limit(1);
    if (!row) return undefined;
    const notification = row.notification;
    if (
      notification.resourceType === "work_item" ||
      notification.resourceType === "comment"
    ) {
      const identity = await resolveInboxIdentity(tx, userId);
      const allowed = await readableNativeRows(tx, [notification], identity);
      if (allowed.length === 0) return undefined;
    }
    const [updated] = await tx
      .update(notificationTable)
      .set({ isRead: true })
      .where(
        and(
          bindSameRow(notification),
          approvalNotificationReadable(userId),
          taskNotificationReadable(userId),
        ),
      )
      .returning();
    return updated;
  });
}

/** The newest 50 visible inbox rows; native work-item/comment rows are authorized in
 * keyset pages before the response limit is applied. */
export async function listVisibleNotificationRows(params: {
  userId: string;
  canReadInstanceAlerts: boolean;
  credentialCanReadTask: boolean;
  credential?: NativeInboxCredential;
}) {
  const {
    userId,
    canReadInstanceAlerts,
    credentialCanReadTask,
    credential = {},
  } = params;
  return inboxTransaction(async (tx) => {
    const identity = await resolveInboxIdentity(tx, userId, credential);
    const results: Array<{
      notification: NotificationRow;
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
        !canReadInstanceAlerts,
      );
      const userScoped = page;
      const rows = userScoped.map(({ notification }) => notification);
      const allowed = new Set(
        (await readableNativeRows(tx, rows, identity)).map(({ id }) => id),
      );
      for (const item of userScoped) {
        const type = item.notification.resourceType;
        if (
          (type === "work_item" || type === "comment") &&
          !allowed.has(item.notification.id)
        ) {
          continue;
        }
        results.push(item);
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
) {
  const [notification] = await db
    .insert(notificationTable)
    .values(values)
    .returning();
  return notification;
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
