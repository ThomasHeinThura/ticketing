import type { Capability, ResolvedIdentity } from "@taskdesk/permissions";
import { eq, inArray, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Executor } from "../database/executor";
import { personTable, userTable, workspaceTable } from "../database/schema";
import type { ApiKey } from "../openapi";
import { resolveIdentity } from "../permissions/resolve-identity";
import {
  loadProjectAncestorIdsFor,
  loadProjectOwnerTeamIdFor,
} from "../project/hierarchy.repository";
import {
  evaluateProjectRead,
  hasProjectReadCapability,
} from "../utils/has-project-reach";
import { apiKeyCapabilitySubset } from "../utils/require-api-key-permission-scope";
import { builtInRoleHasCapability } from "../utils/require-workspace-capability";
import {
  isUnambiguousMembership,
  workspaceMemberRoles,
} from "../utils/workspace-member-roles";

export type CommentViewer = {
  userId: string;
  apiKey?: ApiKey;
  impersonated?: boolean;
};
export type CommentScope = {
  workspaceId: string;
  projectId: string;
  workItemId: string;
};
export type CommentCaller = {
  personId: string;
  identity: ResolvedIdentity;
  capabilities: ReadonlySet<Capability>;
};
const COMMENT_CAPABILITIES = [
  "comment:update_own",
  "comment:update_any",
  "comment:delete_own",
  "comment:delete_any",
] as const;

/** Historical author IDs may be person IDs or old auth-user IDs. Collisions never transfer authorship. */
export async function resolveCommentAuthorProfiles(
  executor: Executor,
  authorIds: readonly (string | null)[],
) {
  const ids = [...new Set(authorIds.filter((id): id is string => Boolean(id)))];
  const resolved = new Map<
    string,
    { personId: string; displayName: string | null } | null
  >();
  if (!ids.length) return resolved;
  const people = await executor
    .select({
      id: personTable.id,
      userId: personTable.userId,
      displayName: sql<
        string | null
      >`coalesce(nullif(btrim(${personTable.displayName}), ''), nullif(btrim(${userTable.name}), ''))`,
    })
    .from(personTable)
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .where(or(inArray(personTable.id, ids), inArray(personTable.userId, ids)));
  for (const id of ids) {
    const candidates = new Set(
      people
        .filter((person) => person.id === id || person.userId === id)
        .map((person) => person.id),
    );
    const personId = candidates.size === 1 ? [...candidates][0] : undefined;
    const person = personId
      ? people.find((candidate) => candidate.id === personId)
      : undefined;
    resolved.set(
      id,
      person ? { personId: person.id, displayName: person.displayName } : null,
    );
  }
  return resolved;
}

export async function resolveCommentAuthors(
  executor: Executor,
  authorIds: readonly (string | null)[],
) {
  const profiles = await resolveCommentAuthorProfiles(executor, authorIds);
  return new Map(
    [...profiles].map(([id, profile]) => [id, profile?.personId ?? null]),
  );
}

/** Canonical identity and original credential ceiling, constrained by the existing workspace checks and project authority. */
export async function loadCommentCaller(
  executor: Executor,
  viewer: CommentViewer,
  scope: CommentScope,
  resolvedIdentity?: ResolvedIdentity,
): Promise<CommentCaller | null> {
  const identity =
    resolvedIdentity ??
    (await resolveIdentity(
      {
        userId: viewer.userId,
        credential: viewer.apiKey
          ? viewer.apiKey.isMcp
            ? "mcp_key"
            : "api_key"
          : viewer.impersonated
            ? "impersonation"
            : "session",
        ...(viewer.apiKey
          ? {
              apiKey: {
                enabled: viewer.apiKey.enabled,
                ownerUserId: viewer.apiKey.userId,
                capabilities: apiKeyCapabilitySubset(viewer.apiKey),
              },
            }
          : {}),
      },
      executor,
    ));
  if (identity?.side !== "staff" || !identity.personId) return null;
  const [workspace] = await executor
    .select({ organisationId: workspaceTable.organisationId })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, scope.workspaceId));
  if (!workspace) return null;
  const facts = {
    ...scope,
    organisationId: workspace.organisationId,
    // PR-2/PR-3: inherited reach AND authority are both decided from this chain.
    ancestorProjectIds: await loadProjectAncestorIdsFor(
      executor,
      executor,
      identity,
      scope.workspaceId,
      scope.projectId,
    ),
    ownerTeamId: await loadProjectOwnerTeamIdFor(
      executor,
      identity,
      scope.workspaceId,
      scope.projectId,
    ),
  };
  const reach = evaluateProjectRead(
    identity,
    "work_item:read",
    "work_item",
    facts,
  );
  if (!reach?.reachable) return null;
  const roles = await workspaceMemberRoles(
    executor,
    scope.workspaceId,
    viewer.userId,
  );
  if (!isUnambiguousMembership(roles)) return null;
  const capabilities = new Set<Capability>();
  for (const capability of COMMENT_CAPABILITIES) {
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
  return { personId: identity.personId, identity, capabilities };
}

export function commentAccess(
  caller: Pick<CommentCaller, "personId" | "capabilities"> | null,
  authorPersonId: string | null,
  row: { createdAt: Date; deletedAt: Date | null },
  now = Date.now(),
) {
  const owner = Boolean(
    caller && authorPersonId && caller.personId === authorPersonId,
  );
  const age = now - row.createdAt.getTime();
  const canEdit = Boolean(
    !row.deletedAt &&
      caller &&
      (caller.capabilities.has("comment:update_any") ||
        (owner &&
          age >= 0 &&
          age <= 15 * 60 * 1000 &&
          caller.capabilities.has("comment:update_own"))),
  );
  const mayDelete = Boolean(
    caller &&
      (caller.capabilities.has("comment:delete_any") ||
        (owner && caller.capabilities.has("comment:delete_own"))),
  );
  return { canEdit, canDelete: !row.deletedAt && mayDelete, mayDelete };
}

export function requireCommentPerson(
  caller: Pick<CommentCaller, "personId"> | null,
): string {
  if (!caller)
    throw new HTTPException(403, { message: "Insufficient permissions" });
  return caller.personId;
}
