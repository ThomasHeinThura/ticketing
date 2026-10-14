import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, isNull } from "drizzle-orm";
import db, { schema } from "../database";
import { resolveIdentity } from "../permissions/resolve-identity";
import { evaluateProjectRead } from "../utils/has-project-reach";
import { apiKeyCapabilitySubset } from "../utils/require-api-key-permission-scope";
import { reachableWorkspacePredicate } from "../utils/workspace-access-middleware";

/**
 * The credential facts a realtime socket holds for its caller. The native socket and the
 * legacy project socket both build one and ask the same question below, so the two sockets
 * can never disagree about who may read a project (#748).
 */
export type ProjectSocketCredential = {
  userId: string;
  apiKeyId?: string;
  apiKeyEnabled?: boolean;
  apiKeyOwnerUserId?: string;
  apiKeyPermissions?: Record<string, string[]> | null;
  impersonated?: boolean;
};

export type AuthorizedProjectTopic = {
  projectId: string;
  workspaceId: string;
};

/** What a key must also be scoped to: both sockets deliver work-item events for a project. */
const PROJECT_TOPIC_KEY_RESOURCE = "work_item";

/**
 * Whether this caller may hold a subscription to one project's events, on EITHER socket.
 * `null` is the single refusal, so an unknown project, a soft-deleted or archived one, one in
 * another workspace, one outside the caller's reach and one the caller lacks the capability
 * for are all indistinguishable to the caller.
 *
 * The rule, in one place:
 *  - the project exists and is neither soft-deleted nor archived;
 *  - the caller reaches the project's workspace (membership or instance admin; a key must be
 *    live and belong to the caller), decided inside the project lookup;
 *  - `reaches()` over the PROJECT row's own facts. The customer organisation is the project's
 *    (`project.organisation_id`, `rbac.md` Reach step 6: "the project's customer"), never the
 *    workspace's: a workspace row names the operating organisation, not the customer;
 *  - the caller holds `project:read` on the project (`can()`), clamped by an API key's stored
 *    scope (the key's registered capabilities), so a key scoped to something else cannot
 *    subscribe even where its owner could;
 *  - a key must additionally hold `work_item:read`, because the topic delivers work-item events.
 *
 * Identity is resolved BEFORE the project lookup so a missing project costs the same work as a
 * hidden one.
 */
export async function authorizeProjectSocketRead(
  credential: ProjectSocketCredential,
  projectId: string,
): Promise<AuthorizedProjectTopic | null> {
  if (!credential.userId || !projectId || projectId.includes("\u0000")) {
    return null;
  }
  const identity = await resolveSocketIdentity(credential);
  const project = await findSocketProject(credential, projectId);
  if (!project || !identity) return null;
  const decision = evaluateProjectRead(identity, "project:read", "project", {
    projectId,
    workspaceId: project.workspaceId,
    organisationId: project.organisationId,
    ancestorProjectIds: [],
    ownerTeamId: null,
  });
  if (!decision?.reachable || !decision.capable) return null;
  if (
    credential.apiKeyId &&
    !credential.apiKeyPermissions?.[PROJECT_TOPIC_KEY_RESOURCE]?.includes(
      "read",
    )
  ) {
    return null;
  }
  return { projectId, workspaceId: project.workspaceId };
}

export function resolveSocketIdentity(
  credential: ProjectSocketCredential,
): Promise<ResolvedIdentity | null> {
  const isKey = credential.apiKeyId !== undefined;
  return resolveIdentity({
    userId: credential.userId,
    credential: isKey
      ? "api_key"
      : credential.impersonated
        ? "impersonation"
        : "session",
    ...(isKey
      ? {
          apiKey: {
            enabled: credential.apiKeyEnabled === true,
            ownerUserId: credential.apiKeyOwnerUserId ?? "",
            capabilities: apiKeyCapabilitySubset({
              permissions: credential.apiKeyPermissions ?? null,
            }),
          },
        }
      : {}),
  });
}

/**
 * The project row both sockets decide against, or `null` when it does not exist, is
 * soft-deleted or archived, or sits in a workspace the caller cannot reach. The organisation
 * is the PROJECT's own (`rbac.md` Reach step 6), never the workspace's.
 */
export async function findSocketProject(
  credential: Pick<ProjectSocketCredential, "userId" | "apiKeyId">,
  projectId: string,
): Promise<{ workspaceId: string; organisationId: string | null } | null> {
  const [project] = await db
    .select({
      workspaceId: schema.projectTable.workspaceId,
      organisationId: schema.projectTable.organisationId,
    })
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.id, projectId),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
        reachableWorkspacePredicate(
          schema.projectTable.workspaceId,
          credential.userId,
          credential.apiKeyId,
        ),
      ),
    )
    .limit(1);
  return project ?? null;
}
