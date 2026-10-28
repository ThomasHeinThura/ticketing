import { and, eq, inArray, isNotNull, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { revokeWorkspaceServiceKeyCredentials } from "../../api-key/accountability";
import { type DatabaseInstance, schema } from "../../database";
import { customFieldTable } from "../../database/migration-schema";
import { retireImportProjectTargets } from "../../imports/project-retention";
import { queueAttachmentObjectsForWorkspaces } from "../../utils/attachment-object-queue";
import { isLockNotAvailable } from "../../utils/is-lock-not-available";

type WorkspaceDeletionTransaction = Parameters<
  Parameters<DatabaseInstance["transaction"]>[0]
>[0];

const WORKSPACE_DELETE_LOCK_TIMEOUT_MS = 3_000;

export class WorkspaceInUseByIdentityConnectionError extends Error {
  readonly workspaceIds: readonly string[];

  constructor(workspaceIds: readonly string[]) {
    super(
      "Cannot delete workspace while an identity connection still uses it as default_workspace_id",
    );
    this.name = "WorkspaceInUseByIdentityConnectionError";
    this.workspaceIds = workspaceIds;
  }
}

export class WorkspaceDeleteLockBusyError extends Error {
  constructor() {
    super(
      "Could not delete workspace right now because workspace access is being updated; please retry.",
    );
    this.name = "WorkspaceDeleteLockBusyError";
  }
}

/**
 * Serialize workspace deletion against concurrent OIDC/SCIM provisioning and workspace-admin
 * reach writers using the same canonical table-lock order (`person, membership_grant, membership`)
 * and bounded wait (`3000ms`) that account erasure uses (#731).
 */
export async function acquireWorkspaceDeletionProvisioningLock(
  tx: WorkspaceDeletionTransaction,
): Promise<void> {
  const priorLockTimeout = (
    await tx.execute(sql`SELECT current_setting('lock_timeout') AS value`)
  ).rows[0]?.value;
  await tx.execute(
    sql`SELECT set_config('lock_timeout', ${`${WORKSPACE_DELETE_LOCK_TIMEOUT_MS}ms`}, true)`,
  );
  try {
    await tx.execute(
      sql`LOCK TABLE person, membership_grant, membership IN SHARE ROW EXCLUSIVE MODE`,
    );
  } catch (error) {
    if (isLockNotAvailable(error)) {
      throw new WorkspaceDeleteLockBusyError();
    }
    throw error;
  }
  await tx.execute(
    sql`SELECT set_config('lock_timeout', ${String(priorLockTimeout ?? "0")}, true)`,
  );
}

/**
 * THE one definition of which `membership` and `membership_grant` rows belong to a workspace
 * (its role set, its scope set and, for grants, the group mappings that belong to it). Both
 * workspace deletion (which removes these rows) and the account-erasure access check (which
 * refuses to remove them while another person holds one, #734) are built from it, so what
 * deletion removes and what erasure protects cannot drift apart.
 *
 * A row qualifies when its role is owned by one of the workspaces, or its scope is one of them
 * or one of their projects. A grant also qualifies when it derives from an OIDC or SCIM group
 * mapping that itself qualifies by the same two rules.
 */
export function workspaceDependentPredicates(
  tx: WorkspaceDeletionTransaction,
  workspaceIds: readonly string[],
) {
  const ids = [...workspaceIds];
  const workspaceRoleIds = tx
    .select({ id: schema.roleTable.id })
    .from(schema.roleTable)
    .where(inArray(schema.roleTable.workspaceId, ids));
  const projectIds = tx
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(inArray(schema.projectTable.workspaceId, ids));

  // `scope`/`scope_id` is polymorphic (no FK), so a row is "in" the workspace when it
  // targets the workspace or one of its projects.
  const inWorkspaceScope = (
    scope: AnyPgColumn,
    scopeId: AnyPgColumn,
  ): SQL | undefined =>
    or(
      and(eq(scope, "workspace"), inArray(scopeId, ids)),
      and(eq(scope, "project"), inArray(scopeId, projectIds)),
    );

  const oidcMappingIds = tx
    .select({ id: schema.oidcGroupMappingTable.id })
    .from(schema.oidcGroupMappingTable)
    .where(
      or(
        inArray(schema.oidcGroupMappingTable.roleId, workspaceRoleIds),
        inWorkspaceScope(
          schema.oidcGroupMappingTable.scope,
          schema.oidcGroupMappingTable.scopeId,
        ),
      ),
    );
  const scimMappingIds = tx
    .select({ id: schema.scimGroupMappingTable.id })
    .from(schema.scimGroupMappingTable)
    .where(
      or(
        inArray(schema.scimGroupMappingTable.roleId, workspaceRoleIds),
        inWorkspaceScope(
          schema.scimGroupMappingTable.scope,
          schema.scimGroupMappingTable.scopeId,
        ),
      ),
    );

  const membershipWhere = or(
    inArray(schema.membershipTable.roleId, workspaceRoleIds),
    inWorkspaceScope(
      schema.membershipTable.scope,
      schema.membershipTable.scopeId,
    ),
  );
  const grantWhere = or(
    inArray(schema.membershipGrantTable.roleId, workspaceRoleIds),
    inWorkspaceScope(
      schema.membershipGrantTable.scope,
      schema.membershipGrantTable.scopeId,
    ),
    inArray(schema.membershipGrantTable.oidcGroupMappingId, oidcMappingIds),
    inArray(schema.membershipGrantTable.scimGroupMappingId, scimMappingIds),
  );
  return {
    oidcMappingIds,
    scimMappingIds,
    membershipWhere,
    grantWhere,
    workspaceRoleIds,
    projectIds,
    inWorkspaceScope,
  };
}

/**
 * Explicitly remove every row that holds a RESTRICT reference to a role or entity owned by
 * the workspace(s) being deleted, or that is scoped to the workspace or one of its
 * projects, BEFORE the workspace row itself is deleted (issues #180, #731).
 */
export async function deleteWorkspaceRoleDependents(
  tx: WorkspaceDeletionTransaction,
  workspaceIds: readonly string[],
): Promise<void> {
  if (workspaceIds.length === 0) return;
  const ids = [...workspaceIds];

  // Refuse cleanly (409) when an instance-scoped `identity_connection` still points its
  // `default_workspace_id` at one of the workspaces being deleted (#731).
  const inUseByIdentityConnections = await tx
    .select({
      workspaceId: schema.identityConnectionTable.defaultWorkspaceId,
    })
    .from(schema.identityConnectionTable)
    .where(inArray(schema.identityConnectionTable.defaultWorkspaceId, ids))
    .for("update");
  const referencedWorkspaceIds = [
    ...new Set(
      inUseByIdentityConnections
        .map((row) => row.workspaceId)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  if (referencedWorkspaceIds.length > 0) {
    throw new WorkspaceInUseByIdentityConnectionError(referencedWorkspaceIds);
  }

  // Revoke parent credentials before workspace cascades erase their ownership metadata.
  // This also covers sole-member workspace deletion during account erasure.
  for (const workspaceId of [...ids].sort()) {
    await revokeWorkspaceServiceKeyCredentials(tx, workspaceId);
  }

  // PA-12: attachment rows cascade away with the work items below. Queue their stored objects
  // for `attachment-gc` in this same transaction so the files are collected, not orphaned.
  await queueAttachmentObjectsForWorkspaces(tx, ids);

  const { oidcMappingIds, scimMappingIds, membershipWhere, grantWhere } =
    workspaceDependentPredicates(tx, ids);
  const grantIds = tx
    .select({ id: schema.membershipGrantTable.id })
    .from(schema.membershipGrantTable)
    .where(grantWhere);

  // Materialise the id sets before the first delete so every later statement works
  // from the same snapshot regardless of delete order.
  const grantIdList = (await grantIds).map((row) => row.id);
  const oidcIdList = (await oidcMappingIds).map((row) => row.id);
  const scimIdList = (await scimMappingIds).map((row) => row.id);

  // 1. `scim_group_member` rows keyed to a doomed grant or mapping.
  if (grantIdList.length > 0) {
    await tx
      .delete(schema.scimGroupMemberTable)
      .where(
        inArray(schema.scimGroupMemberTable.membershipGrantId, grantIdList),
      );
  }
  if (scimIdList.length > 0) {
    await tx
      .delete(schema.scimGroupMemberTable)
      .where(
        inArray(schema.scimGroupMemberTable.scimGroupMappingId, scimIdList),
      );
  }

  // 2. Grants.
  if (grantIdList.length > 0) {
    await tx
      .delete(schema.membershipGrantTable)
      .where(inArray(schema.membershipGrantTable.id, grantIdList));
  }

  // 3. Group mappings.
  if (oidcIdList.length > 0) {
    await tx
      .delete(schema.oidcGroupMappingTable)
      .where(inArray(schema.oidcGroupMappingTable.id, oidcIdList));
  }
  if (scimIdList.length > 0) {
    await tx
      .delete(schema.scimGroupMappingTable)
      .where(inArray(schema.scimGroupMappingTable.id, scimIdList));
  }

  // 4. Memberships: those holding a workspace-owned role, plus any scoped to the
  // workspace or its projects.
  await tx.delete(schema.membershipTable).where(membershipWhere);

  // 5. Approvals (`approval.transition_id` is ON DELETE RESTRICT to `workflow_transition`,
  // and `approval.work_item_id` is ON DELETE RESTRICT to `work_item`).
  await tx
    .delete(schema.approvalTable)
    .where(inArray(schema.approvalTable.workspaceId, ids));

  // 6. Workflows (`workflow_transition` restricts `state_template` and `role`).
  // `work_item_type.workflow_id` is ON DELETE RESTRICT, and every seeded default type is
  // bound to its workspace's default workflow, so release that binding first; the type rows
  // themselves go with the workspace (or are removed below).
  await tx
    .update(schema.workItemTypeTable)
    .set({ workflowId: null })
    .where(
      and(
        inArray(schema.workItemTypeTable.workspaceId, ids),
        isNotNull(schema.workItemTypeTable.workflowId),
      ),
    );
  await tx
    .delete(schema.workflowTable)
    .where(inArray(schema.workflowTable.workspaceId, ids));

  // 7. Submissions and request types (`submission` restricts `work_item` and
  // `request_type_version`; `request_type_version` and `request_type` restrict
  // `project`, `work_item_type`, and `sla_policy`).
  const workspaceRequestTypeIds = tx
    .select({ id: schema.requestTypeTable.id })
    .from(schema.requestTypeTable)
    .where(inArray(schema.requestTypeTable.workspaceId, ids));
  const workspaceWorkItemIds = tx
    .select({ id: schema.workItemTable.id })
    .from(schema.workItemTable)
    .where(inArray(schema.workItemTable.workspaceId, ids));
  await tx
    .delete(schema.submissionTable)
    .where(
      or(
        inArray(schema.submissionTable.requestTypeId, workspaceRequestTypeIds),
        inArray(schema.submissionTable.workItemId, workspaceWorkItemIds),
      ),
    );
  await tx
    .delete(schema.requestTypeVersionTable)
    .where(inArray(schema.requestTypeVersionTable.workspaceId, ids));
  await tx
    .delete(schema.requestTypeTable)
    .where(inArray(schema.requestTypeTable.workspaceId, ids));

  // 8. Custom fields scoped to the workspace.
  await tx
    .delete(customFieldTable)
    .where(inArray(customFieldTable.workspaceId, ids));

  // 9. Work items and projects (`work_item.parent_id` self-FK and `project.parent_id`
  // self-FK are ON DELETE RESTRICT; `work_item` restricts `state`, `work_item_type`,
  // and `sla_policy_version`; `project` restricts `sla_policy`; `state` restricts
  // `state_template`).
  await tx
    .update(schema.workItemTable)
    .set({ parentId: null })
    .where(
      and(
        inArray(schema.workItemTable.workspaceId, ids),
        isNotNull(schema.workItemTable.parentId),
      ),
    );
  await tx
    .delete(schema.workItemTable)
    .where(inArray(schema.workItemTable.workspaceId, ids));
  const importProjectIds = await tx
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(inArray(schema.projectTable.workspaceId, ids));
  await retireImportProjectTargets(
    tx,
    importProjectIds.map((row) => row.id),
  );
  await tx
    .delete(schema.projectTable)
    .where(inArray(schema.projectTable.workspaceId, ids));

  // 10. SLA goals, policy versions, and policies (`sla_goal` restricts
  // `sla_policy_version` and `work_item_type`; `sla_policy.active_version_id`
  // restricts `sla_policy_version`; `sla_policy_version` restricts `sla_policy`
  // and `service_calendar`).
  await tx
    .delete(schema.slaGoalTable)
    .where(inArray(schema.slaGoalTable.workspaceId, ids));
  await tx
    .update(schema.slaPolicyTable)
    .set({ activeVersionId: null })
    .where(
      and(
        inArray(schema.slaPolicyTable.workspaceId, ids),
        isNotNull(schema.slaPolicyTable.activeVersionId),
      ),
    );
  await tx
    .delete(schema.slaPolicyVersionTable)
    .where(inArray(schema.slaPolicyVersionTable.workspaceId, ids));
  await tx
    .delete(schema.slaPolicyTable)
    .where(inArray(schema.slaPolicyTable.workspaceId, ids));

  // 11. Work item types, state templates, and workspace-scoped roles.
  await tx
    .delete(schema.workItemTypeTable)
    .where(inArray(schema.workItemTypeTable.workspaceId, ids));
  await tx
    .delete(schema.stateTemplateTable)
    .where(inArray(schema.stateTemplateTable.workspaceId, ids));
  await tx
    .delete(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, "workspace"),
        inArray(schema.roleTable.workspaceId, ids),
      ),
    );
}
