import { and, countDistinct, eq, gt, isNull, not, or } from "drizzle-orm";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";
import { reachableWorkspacePredicate } from "./workspace-access-middleware";

/**
 * Query ownership for the small authorization lookups under `utils/` (issue #580): session
 * and principal facts, API-key checks, workspace membership and role reads, and the
 * organisation / project / task / asset / label facts the reach helpers evaluate. Each
 * function is moved verbatim from the helper that used to inline it, awaits, and returns
 * rows; every allow/deny decision, HTTP status and shadow-evidence call stays in the helper.
 */

// --- users and principals -------------------------------------------------------------

/** The user's global role (`admin` / ...), or `undefined`. */
export async function findUserRole(userId: string) {
  const [row] = await db
    .select({ role: schema.userTable.role })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  return row;
}

export async function findUserIsAnonymous(userId: string) {
  const [row] = await db
    .select({ isAnonymous: schema.userTable.isAnonymous })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  return row;
}

export async function findUserLocaleByEmail(email: string) {
  const [user] = await db
    .select({ locale: schema.userTable.locale })
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email))
    .limit(1);
  return user;
}

// --- API keys -------------------------------------------------------------------------

/** An enabled key belonging to `userId` (as reference or owner) by id, or none. */
export async function listEnabledApiKeysOfUser(
  apiKeyId: string,
  userId: string,
) {
  return db
    .select()
    .from(schema.apikeyTable)
    .where(
      and(
        eq(schema.apikeyTable.id, apiKeyId),
        or(
          eq(schema.apikeyTable.referenceId, userId),
          eq(schema.apikeyTable.userId, userId),
        ),
        eq(schema.apikeyTable.enabled, true),
      ),
    )
    .limit(1);
}

/** The enabled, unexpired key with this hash, or `undefined`. */
export async function findActiveApiKeyByHash(hashedKey: string) {
  const [apiKey] = await db
    .select()
    .from(schema.apikeyTable)
    .where(
      and(
        eq(schema.apikeyTable.key, hashedKey),
        eq(schema.apikeyTable.enabled, true),
        or(
          isNull(schema.apikeyTable.expiresAt),
          gt(schema.apikeyTable.expiresAt, new Date()),
        ),
      ),
    )
    .limit(1);
  return apiKey;
}

/** The key owner's banned flag and person-active flag, or `undefined`. */
export async function findApiKeyOwnerStatus(ownerId: string) {
  const [owner] = await db
    .select({
      banned: schema.userTable.banned,
      personActive: schema.personTable.active,
    })
    .from(schema.userTable)
    .leftJoin(
      schema.personTable,
      eq(schema.personTable.userId, schema.userTable.id),
    )
    .where(eq(schema.userTable.id, ownerId))
    .limit(1);
  return owner;
}

// --- workspace membership and roles ---------------------------------------------------

/** The user's workspace membership row (all columns), as an array of at most one. */
export async function listWorkspaceMembershipRows(
  userId: string,
  workspaceId: string,
) {
  return db
    .select()
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
}

/** The user's membership role in the workspace, or `undefined`. */
export async function findMembershipRole(userId: string, workspaceId: string) {
  const [membership] = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return membership;
}

/** The user's membership (user id only), or `undefined`. */
export async function findMembershipUserId(
  userId: string,
  workspaceId: string,
) {
  const [membership] = await db
    .select({ userId: schema.workspaceUserTable.userId })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return membership;
}

/** Every `workspace_member.role` value for one `(workspaceId, userId)` pair. */
export async function listMemberRoleRows(
  executor: Executor,
  workspaceId: string,
  userId: string,
) {
  return executor
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    );
}

/** The number of distinct users holding the exact `owner` role. */
export async function countOwnerRows(executor: Executor, workspaceId: string) {
  const [row] = await executor
    .select({ owners: countDistinct(schema.workspaceUserTable.userId) })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.role, "owner"),
      ),
    );
  return row;
}

/** Stored permission rows for `(workspaceId, role)`; the caller requires exactly one. */
export async function listRolePermissionRows(
  executor: Executor,
  workspaceId: string,
  role: string,
) {
  return executor
    .select({ permission: schema.workspaceRoleTable.permission })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    );
}

/** Whether `(workspaceId, role)` is backed by a seeded system row (`is_system`). */
export async function findRoleIsSystem(
  executor: Executor,
  workspaceId: string,
  role: string,
) {
  const [row] = await executor
    .select({ isSystem: schema.workspaceRoleTable.isSystem })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    )
    .limit(1);
  return row;
}

// --- reach facts ----------------------------------------------------------------------

/** The workspace owning an invitation, or `undefined`. */
export async function findInvitationWorkspaceId(invitationId: string) {
  const [row] = await db
    .select({ workspaceId: schema.invitationTable.workspaceId })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
  return row;
}

/** A task's id, project and workspace when its project is live, or `undefined`. */
export async function findLiveTaskFacts(taskId: string) {
  const [task] = await db
    .select({
      id: schema.taskTable.id,
      projectId: schema.taskTable.projectId,
      workspaceId: schema.projectTable.workspaceId,
    })
    .from(schema.taskTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.taskTable.projectId, schema.projectTable.id),
    )
    .where(
      and(
        eq(schema.taskTable.id, taskId),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .limit(1);
  return task;
}

export async function findLabelTaskId(labelId: string) {
  const [label] = await db
    .select({ taskId: schema.labelTable.taskId })
    .from(schema.labelTable)
    .where(eq(schema.labelTable.id, labelId))
    .limit(1);
  return label;
}

// --- assets ---------------------------------------------------------------------------

/** The asset when its project's workspace is reachable by the caller (and key), else `undefined`. */
export async function findWorkspaceReachableAsset(
  assetId: string,
  userId: string,
  apiKeyId?: string,
) {
  const [asset] = await db
    .select({
      id: schema.assetTable.id,
      objectKey: schema.assetTable.objectKey,
      mimeType: schema.assetTable.mimeType,
      filename: schema.assetTable.filename,
      workspaceId: schema.assetTable.workspaceId,
      projectId: schema.assetTable.projectId,
    })
    .from(schema.assetTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.assetTable.projectId, schema.projectTable.id),
    )
    .where(
      and(
        eq(schema.assetTable.id, assetId),
        reachableWorkspacePredicate(
          schema.projectTable.workspaceId,
          userId,
          apiKeyId,
        ),
      ),
    )
    .limit(1);
  return asset;
}

/** The workspace of a live-project asset the caller does NOT reach (shadow-only evidence). */
export async function findWorkspaceDeniedAsset(
  assetId: string,
  userId: string,
  apiKeyId?: string,
) {
  const [deletedAsset] = await db
    .select({ workspaceId: schema.assetTable.workspaceId })
    .from(schema.assetTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.assetTable.projectId, schema.projectTable.id),
    )
    .where(
      and(
        eq(schema.assetTable.id, assetId),
        isNull(schema.projectTable.deletedAt),
        not(
          reachableWorkspacePredicate(
            schema.projectTable.workspaceId,
            userId,
            apiKeyId,
          ),
        ),
      ),
    )
    .limit(1);
  return deletedAsset;
}
