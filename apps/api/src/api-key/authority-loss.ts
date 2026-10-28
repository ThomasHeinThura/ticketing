import { authorityFor, type Capability } from "@taskdesk/permissions";
import { and, eq, sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import type { Executor } from "../database/executor";
import { apiKeyExtensionTable, apikeyTable } from "../database/schema";
import { resolveIdentity } from "../permissions/resolve-identity";

/** Canonical live workspace authority captured inside the caller's transaction. */
export type WorkspaceServiceKeyAuthoritySnapshot = {
  readonly userId: string;
  readonly personId: string;
  readonly workspaceId: string;
  readonly capabilities: readonly Capability[];
};

export type WorkspaceServiceKeyAuthorityChange = {
  readonly before: WorkspaceServiceKeyAuthoritySnapshot | null;
  /** Null means the identity no longer resolves as active staff. */
  readonly after: WorkspaceServiceKeyAuthoritySnapshot | null;
  readonly now: Date;
};

/**
 * Read effective authority from the canonical identity resolver, using the same transaction
 * that will perform the workspace membership mutation.
 */
export async function captureWorkspaceServiceKeyAuthority(
  tx: Executor,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceServiceKeyAuthoritySnapshot | null> {
  const identity = await resolveIdentity({ userId, credential: "session" }, tx);
  if (!identity || identity.side !== "staff") return null;

  return {
    userId,
    personId: identity.personId,
    workspaceId,
    capabilities: [...authorityFor(identity, "workspace", { workspaceId })],
  };
}

/** Pure set difference, exported for the later role/grant lifecycle hooks. */
export function lostWorkspaceCapabilities(
  before: readonly Capability[],
  after: readonly Capability[],
): Capability[] {
  const current = new Set(after);
  return [...new Set(before)].filter((capability) => !current.has(capability));
}

/**
 * Transfer accountability and request fresh acknowledgement only for real authority loss
 * affecting an existing service key. The key's hash, enabled state, and frozen grants are
 * deliberately untouched. A departed workspace member is not labelled a former person;
 * that marker is reserved for identity deactivation in the lifecycle hook.
 */
export async function markServiceKeysForAuthorityLoss(
  tx: Executor,
  change: WorkspaceServiceKeyAuthorityChange,
): Promise<number> {
  const { before, after, now } = change;
  if (!before) return 0;
  if (
    after &&
    (after.userId !== before.userId ||
      after.personId !== before.personId ||
      after.workspaceId !== before.workspaceId)
  ) {
    throw new Error("Workspace service-key authority snapshots do not match");
  }

  const lost = lostWorkspaceCapabilities(
    before.capabilities,
    after?.capabilities ?? [],
  );
  if (lost.length === 0) return 0;
  const lostSet = new Set<string>(lost);
  const lostKeyManagement = lostSet.has("api_key:manage");

  // Lock the extension rows in the same order used by re-attestation. This prevents a
  // concurrent acknowledgement from erasing a newly discovered authority loss.
  const keys = await tx
    .select({
      apikeyId: apiKeyExtensionTable.apikeyId,
      enabled: apikeyTable.enabled,
      capabilities: apiKeyExtensionTable.capabilities,
      adminOwnershipTransferredAt:
        apiKeyExtensionTable.adminOwnershipTransferredAt,
      reattestationRequiredAt: apiKeyExtensionTable.reattestationRequiredAt,
    })
    .from(apiKeyExtensionTable)
    .innerJoin(apikeyTable, eq(apikeyTable.id, apiKeyExtensionTable.apikeyId))
    .where(
      and(
        eq(apiKeyExtensionTable.workspaceId, before.workspaceId),
        eq(apiKeyExtensionTable.createdByPersonId, before.personId),
      ),
    )
    .orderBy(apiKeyExtensionTable.apikeyId)
    .for("update", { of: apiKeyExtensionTable });

  let changed = 0;
  for (const key of keys) {
    const stored = Array.isArray(key.capabilities)
      ? key.capabilities.filter(
          (capability): capability is string => typeof capability === "string",
        )
      : [];
    if (
      !lostKeyManagement &&
      !stored.some((capability) => lostSet.has(capability))
    ) {
      continue;
    }

    const needsNewReattestation =
      key.enabled && key.reattestationRequiredAt === null;
    const transfersOwnership = key.adminOwnershipTransferredAt === null;
    if (!needsNewReattestation && !transfersOwnership) continue;

    await tx
      .update(apiKeyExtensionTable)
      .set({
        adminOwnershipTransferredAt: key.adminOwnershipTransferredAt ?? now,
        ...(key.enabled ? { reattestationRequiredAt: now } : {}),
        accountabilityVersion: sql`${apiKeyExtensionTable.accountabilityVersion} + 1`,
      })
      .where(eq(apiKeyExtensionTable.apikeyId, key.apikeyId));

    await appendAuditLog(tx, {
      actorId: null,
      actorType: "system",
      workspaceId: before.workspaceId,
      action: "api_key.ownership_transferred",
      entityType: "api_key",
      entityId: key.apikeyId,
      after: {
        ownedByWorkspaceAdmins: true,
        requiresReattestation: key.enabled,
        reason: "workspace_authority_lost",
      },
    });
    changed += 1;
  }
  return changed;
}
