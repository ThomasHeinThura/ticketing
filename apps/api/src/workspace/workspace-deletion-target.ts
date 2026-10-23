import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { schema } from "../database";
import {
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import { reportPendingActionAuditFailures } from "../pending-action/lifecycle-invalidation";
import {
  captureWorkspaceDeletionAccess,
  invalidateWorkspaceDeletionAccessLosses,
} from "../pending-action/workspace-access-invalidation";
import {
  assertWorkspaceNotUnderLegalHold,
  WorkspaceUnderLegalHoldError,
} from "../utils/workspace-legal-hold";
import { invalidateNativeAuthorization } from "../ws";
import { roleIsReferencedBy } from "./controllers/delete-workspace-role";
import {
  acquireWorkspaceDeletionProvisioningLock,
  deleteWorkspaceRoleDependents,
  WorkspaceDeleteLockBusyError,
  WorkspaceInUseByIdentityConnectionError,
} from "./controllers/delete-workspace-role-dependents";
import {
  RoleAssignedToMembersError,
  RoleNameReservedError,
} from "./controllers/workspace-role-errors";
import { lockWorkspaceRoleAssignment } from "./workspace-role-assignment.repository";

export const WORKSPACE_DELETION_ROUTE =
  "DELETE /api/workspace/{workspaceId}" as const;
export const WORKSPACE_ROLE_DELETION_ROUTE =
  "DELETE /api/workspace/{workspaceId}/roles/{roleId}" as const;

/**
 * `DELETE /api/workspace/{workspaceId}`: typed exact workspace name + step-up, browser session
 * only. Execution is the hard delete `controllers/delete-workspace.ts` performs, inside the
 * approval transaction. The approval already holds the pending-action lifecycle gate, so this
 * uses the tx-taking capture/invalidate pair rather than `withWorkspaceDeletionAccessLifecycle`
 * (which would open a second transaction and re-take that gate).
 */
export const workspaceDeletionTarget: RegisteredDeletionTarget = {
  targetType: "workspace",
  routeKey: WORKSPACE_DELETION_ROUTE,
  confirmation: "typed_name_step_up",
  sessionOnly: true,
  notFound: "Workspace not found",
  load: async (tx, id) => {
    const [workspace] = await tx
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, id))
      .for("update")
      .limit(1);
    if (!workspace) return undefined;
    return {
      id: workspace.id,
      workspaceId: workspace.id,
      projectId: null,
      organisationId: null,
      name: workspace.name,
      summary: {
        workspaceId: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      },
      version: registeredDeletionFingerprint(workspace),
    };
  },
  execute: async (tx, { loaded, input }) => {
    const before = await captureWorkspaceDeletionAccess(tx, loaded.id);
    let deleted: { id: string } | undefined;
    try {
      // PA-12: an open legal hold over the organisation or any person in the workspace
      // suspends this hard delete. The SHARE lock keeps a hold from being placed before the
      // delete commits.
      await assertWorkspaceNotUnderLegalHold(tx, loaded.id);
      await lockWorkspaceRoleAssignment(tx, loaded.id);
      await acquireWorkspaceDeletionProvisioningLock(tx);
      // The approving session's selection is cleared, matching the inherited blast radius of
      // the direct route (the caller's own session only).
      await tx
        .update(schema.sessionTable)
        .set({ activeOrganizationId: null, activeTeamId: null })
        .where(
          and(
            eq(schema.sessionTable.id, input.sessionId),
            eq(schema.sessionTable.activeOrganizationId, loaded.id),
          ),
        );
      await deleteWorkspaceRoleDependents(tx, [loaded.id]);
      [deleted] = await tx
        .delete(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, loaded.id))
        .returning({ id: schema.workspaceTable.id });
    } catch (error) {
      if (error instanceof WorkspaceUnderLegalHoldError)
        throw new HTTPException(409, { message: "legal_hold" });
      if (
        error instanceof WorkspaceInUseByIdentityConnectionError ||
        error instanceof WorkspaceDeleteLockBusyError
      )
        throw new HTTPException(409, { message: error.message });
      throw error;
    }
    if (!deleted)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    const auditFailures = await invalidateWorkspaceDeletionAccessLosses(
      tx,
      before,
    );
    return {
      afterCommit: async () => {
        await reportPendingActionAuditFailures(auditFailures);
        await invalidateNativeAuthorization({ workspaceId: loaded.id });
      },
    };
  },
};

/**
 * `DELETE /api/workspace/{workspaceId}/roles/{roleId}`: click-confirmed. Same refusals as
 * `controllers/delete-workspace-role.ts` (reserved `owner`, role still assigned), checked at
 * request time and again under the membership→role lock at execution.
 */
export const workspaceRoleDeletionTarget: RegisteredDeletionTarget = {
  targetType: "workspace_role",
  routeKey: WORKSPACE_ROLE_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: true,
  notFound: "Role not found",
  load: async (tx, id) => {
    const [anchor] = await tx
      .select({ workspaceId: schema.workspaceRoleTable.workspaceId })
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.id, id))
      .limit(1);
    if (!anchor) return undefined;
    await lockWorkspaceRoleAssignment(tx, anchor.workspaceId);
    const [role] = await tx
      .select()
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.id, id),
          eq(schema.workspaceRoleTable.workspaceId, anchor.workspaceId),
        ),
      )
      .for("update")
      .limit(1);
    if (!role) return undefined;
    return {
      id: role.id,
      workspaceId: role.workspaceId,
      projectId: null,
      organisationId: null,
      name: role.role,
      summary: { roleId: role.id, name: role.role },
      version: registeredDeletionFingerprint(role),
    };
  },
  assertDeletable: async (tx, loaded) => {
    // Defensive only: `owner` is never a DB row (see delete-workspace-role.ts).
    if (loaded.name === "owner")
      throw new HTTPException(400, {
        message: new RoleNameReservedError().message,
      });
    const members = await tx
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, loaded.workspaceId));
    if (
      roleIsReferencedBy(
        members.map((member) => member.role),
        loaded.name,
      )
    )
      throw new HTTPException(400, {
        message: new RoleAssignedToMembersError(loaded.name).message,
      });
  },
  execute: async (tx, { loaded }) => {
    const [deleted] = await tx
      .delete(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.id, loaded.id),
          eq(schema.workspaceRoleTable.workspaceId, loaded.workspaceId),
        ),
      )
      .returning({ id: schema.workspaceRoleTable.id });
    if (!deleted)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    return {
      afterCommit: () =>
        invalidateNativeAuthorization({ workspaceId: loaded.workspaceId }),
    };
  },
};
