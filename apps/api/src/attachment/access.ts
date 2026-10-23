import type { Capability, ResolvedIdentity } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import type { Executor } from "../database/executor";
import { personTable, workspaceTable } from "../database/schema";
import { loadProjectAncestorIdsFor } from "../project/hierarchy.repository";
import {
  evaluateProjectRead,
  hasProjectReadCapability,
} from "../utils/has-project-reach";
import { builtInRoleHasCapability } from "../utils/require-workspace-capability";
import {
  isUnambiguousMembership,
  workspaceMemberRoles,
} from "../utils/workspace-member-roles";

export type AttachmentScope = {
  workspaceId: string;
  projectId: string;
  workItemId: string;
};
export type AttachmentCaller = {
  personId: string;
  capabilities: ReadonlySet<Capability>;
};
/** Uses a freshly resolved canonical identity, retaining its original API-key ceiling. */
export async function loadAttachmentCaller(
  executor: Executor,
  identity: ResolvedIdentity | null,
  scope: AttachmentScope,
): Promise<AttachmentCaller | null> {
  if (identity?.side !== "staff") return null;
  const [person] = await executor
    .select({ userId: personTable.userId })
    .from(personTable)
    .where(eq(personTable.id, identity.personId));
  if (!person?.userId) return null;
  const [workspace] = await executor
    .select({ organisationId: workspaceTable.organisationId })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, scope.workspaceId));
  if (!workspace) return null;
  const facts = {
    ...scope,
    organisationId: workspace.organisationId,
    // PR-2/PR-3: reach and attachment authority follow the ancestor chain.
    ancestorProjectIds: await loadProjectAncestorIdsFor(
      executor,
      executor,
      identity,
      scope.workspaceId,
      scope.projectId,
    ),
    ownerTeamId: null,
  };
  if (
    !evaluateProjectRead(identity, "work_item:read", "work_item", facts)
      ?.reachable
  )
    return null;
  const roles = await workspaceMemberRoles(
    executor,
    scope.workspaceId,
    person.userId,
  );
  if (!isUnambiguousMembership(roles)) return null;
  const capabilities = new Set<Capability>();
  for (const capability of [
    "attachment:delete_own",
    "attachment:delete_any",
  ] as const) {
    if (
      hasProjectReadCapability(identity, capability, "work_item", facts) &&
      (await builtInRoleHasCapability(
        scope.workspaceId,
        roles[0],
        capability,
        executor,
      ))
    )
      capabilities.add(capability);
  }
  return { personId: identity.personId, capabilities };
}
export function attachmentDeletionAccess(
  caller: AttachmentCaller | null,
  row: { uploadedBy: string | null; state: string; deletedAt: Date | null },
) {
  const mayDelete = Boolean(
    caller &&
      (caller.capabilities.has("attachment:delete_any") ||
        (row.uploadedBy === caller.personId &&
          caller.capabilities.has("attachment:delete_own"))),
  );
  return {
    mayDelete,
    canDelete: mayDelete && row.state !== "deleted" && row.deletedAt === null,
  };
}
