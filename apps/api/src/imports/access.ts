import { can, reaches } from "@taskdesk/permissions";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { loadApiKeyKind } from "../api-key/repository";
import { schema } from "../database";
import type { Transaction } from "../database/executor";
import type { ResolveIdentityInput } from "../permissions/resolve-identity";
import { resolveIdentity } from "../permissions/resolve-identity";
import { policyRegistry } from "../policy-registry";
import {
  loadProjectAncestorIdsFor,
  loadProjectOwnerTeamIdFor,
} from "../project/hierarchy.repository";
import { dbNowUtc } from "../utils/db-time";
import {
  apiKeyCapabilitySubset,
  apiKeyScopeFromStoredPermissions,
} from "../utils/require-api-key-permission-scope";

export type ImportActor = {
  userId: string;
  actorType: "person" | "api_key";
  apiKeyId: string | null;
  apiKey?: { id: string };
  impersonatedBy: string | null;
};

export function importActor(c: Context): ImportActor {
  const userId = c.get("userId") as string | undefined;
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  const key = c.get("apiKey") as
    | {
        id: string;
        userId: string;
        enabled: boolean;
        isMcp?: boolean;
        permissions?: Record<string, string[]> | null;
      }
    | undefined;
  const session = c.get("session") as
    | { impersonatedBy?: string | null }
    | undefined;
  return {
    userId,
    actorType: key ? "api_key" : "person",
    apiKeyId: key?.id ?? null,
    ...(key ? { apiKey: { id: key.id } } : {}),
    impersonatedBy: session?.impersonatedBy ?? null,
  };
}

async function identityInput(
  actor: ImportActor,
  tx: Transaction,
): Promise<ResolveIdentityInput> {
  if (actor.apiKeyId) {
    const [stored] = await tx
      .select({
        id: schema.apikeyTable.id,
        userId: schema.apikeyTable.userId,
        enabled: schema.apikeyTable.enabled,
        permissions: schema.apikeyTable.permissions,
      })
      .from(schema.apikeyTable)
      .where(
        and(
          eq(schema.apikeyTable.id, actor.apiKeyId),
          eq(schema.apikeyTable.userId, actor.userId),
          eq(schema.apikeyTable.enabled, true),
          or(
            isNull(schema.apikeyTable.expiresAt),
            gt(schema.apikeyTable.expiresAt, dbNowUtc()),
          ),
        ),
      )
      .for("share")
      .limit(1);
    if (!stored?.enabled || !stored.userId)
      throw new HTTPException(403, { message: "Invalid API credential" });
    const keyKind = await loadApiKeyKind(actor.apiKeyId, tx);
    if (keyKind.kind !== "personal")
      throw new HTTPException(403, { message: "Forbidden" });
    return {
      userId: actor.userId,
      credential: keyKind.isMcp ? "mcp_key" : "api_key",
      apiKey: {
        enabled: stored.enabled,
        ownerUserId: stored.userId,
        capabilities: apiKeyCapabilitySubset(
          apiKeyScopeFromStoredPermissions(stored.permissions),
        ),
      },
    };
  }
  return {
    userId: actor.userId,
    credential: actor.impersonatedBy ? "impersonation" : "session",
  };
}

export async function requireImportProjectCapability(
  tx: Transaction,
  actor: ImportActor,
  workspaceId: string,
  projectId: string,
  capability: "work_item:read" | "work_item:create" | "work_item:update",
) {
  const [project] = await tx
    .select()
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.id, projectId),
        eq(schema.projectTable.workspaceId, workspaceId),
        isNull(schema.projectTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .for("share")
    .limit(1);
  if (!project)
    throw new HTTPException(404, { message: "Import run not found" });

  const identity = await resolveIdentity(await identityInput(actor, tx), tx);
  if (identity?.side !== "staff")
    throw new HTTPException(404, { message: "Import run not found" });
  const ancestorProjectIds = await loadProjectAncestorIdsFor(
    tx,
    tx,
    identity,
    workspaceId,
    projectId,
  );
  const target = {
    projectId,
    workItemProjectId: projectId,
    workspaceId,
    ancestorProjectIds,
  };
  const inReach = reaches(identity, {
    projectId,
    workspaceId,
    organisationId: project.organisationId,
    ancestorProjectIds,
    ownerTeamId: await loadProjectOwnerTeamIdFor(
      tx,
      identity,
      workspaceId,
      projectId,
    ),
  });
  if (!inReach)
    throw new HTTPException(404, { message: "Import run not found" });
  const scope = capability === "work_item:update" ? "work_item" : "project";
  if (!can(identity, capability, scope, target))
    throw new HTTPException(403, { message: "Insufficient permissions" });
  return { project, identity };
}

export async function requireImportWorkspaceRead(
  tx: Transaction,
  actor: ImportActor,
  workspaceId: string,
) {
  const [workspace] = await tx
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId))
    .for("share")
    .limit(1);
  if (!workspace)
    throw new HTTPException(404, { message: "Workspace not found" });
  const identity = await resolveIdentity(await identityInput(actor, tx), tx);
  if (identity?.side !== "staff")
    throw new HTTPException(404, { message: "Workspace not found" });
  if (!can(identity, "work_item:read", "workspace", { workspaceId }))
    throw new HTTPException(403, { message: "Insufficient permissions" });
}

/** Revalidate route-level instance-admin authority inside the mutation transaction. */
export async function requireImportInstanceAdmin(
  tx: Transaction,
  actor: ImportActor,
  routeKey: string,
) {
  if (actor.impersonatedBy)
    throw new HTTPException(403, { message: "Forbidden" });
  const route = policyRegistry.get(routeKey);
  if (
    route?.kind !== "capability" ||
    !("capability" in route.policy) ||
    route.policy.capability !== "instance:admin" ||
    route.policy.scope !== "instance"
  )
    throw new HTTPException(403, { message: "Forbidden" });
  const identity = await resolveIdentity(await identityInput(actor, tx), tx);
  if (
    !identity ||
    identity.side !== "staff" ||
    !can(identity, "instance:admin", "instance", { instance: true })
  )
    throw new HTTPException(403, { message: "Forbidden" });
  return identity;
}

/** Derive MCP audit origin from the persisted key kind within the caller transaction. */
export async function importOrigin(
  tx: Transaction,
  actor: ImportActor,
): Promise<"mcp" | undefined> {
  if (!actor.apiKeyId) return undefined;
  const kind = await loadApiKeyKind(actor.apiKeyId, tx);
  return kind.kind === "personal" && kind.isMcp ? "mcp" : undefined;
}
