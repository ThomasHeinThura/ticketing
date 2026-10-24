import {
  type Capability,
  capabilityTier,
  isCapability,
  type ResolvedIdentity,
} from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";

/**
 * The principal of a workspace SERVICE key (AK-7): a credential owned by a workspace, with no
 * person behind it. It used to arrive with an empty user id, so every policy check denied it.
 *
 * What it is: a staff-side, agent-portal, `api_key` credential whose only authority is ONE
 * workspace-scope grant over exactly the key's stored capability subset, and whose reach is that
 * workspace's plain membership reach. What it is not, by construction:
 *
 *  - instance authority: there is no instance grant and the reach is never `all`;
 *  - another workspace: the grant is anchored to the key's own workspace id, and `can()` only
 *    applies a workspace grant whose `scopeId` equals the target;
 *  - broader than its subset: the capability list is the stored subset (workspace-tier names
 *    only, instance-tier and unknown names dropped) and the same list is the key ceiling;
 *  - project reach: a service key holds no project membership and no `sees_all`. The contracts
 *    are silent on service-key reach, so none is inferred; project-scoped routes stay denied
 *    until reach is granted explicitly.
 *  - a person: `userId` and `personId` are one synthetic id that cannot equal any real person id
 *    (`service-key:` plus the key id), so an owner or self predicate never matches and the key is
 *    never an approver (`no_approver` stays with the deletion request path).
 */
export function servicePrincipalId(apiKeyId: string): string {
  return `service-key:${apiKeyId}`;
}

export function isServicePrincipalId(value: string): boolean {
  return value.startsWith("service-key:");
}

/** The stored subset reduced to registered workspace-tier capabilities. */
export function serviceKeyCapabilities(
  stored: readonly string[] | null | undefined,
): Capability[] {
  const out = new Set<Capability>();
  for (const name of stored ?? []) {
    if (isCapability(name) && capabilityTier(name) === "workspace") {
      out.add(name);
    }
  }
  return [...out].sort();
}

export type ServicePrincipalFacts = {
  readonly apiKeyId: string;
  readonly workspaceId: string;
  readonly capabilities: readonly string[] | null;
  /** The workspace's owning organisation; `null` when the workspace no longer exists. */
  readonly organisationId: string | null;
};

/** Pure half: facts in, identity out. A missing workspace fails closed to `null`. */
export function servicePrincipalFromFacts(
  facts: ServicePrincipalFacts,
): ResolvedIdentity | null {
  if (!facts.apiKeyId || !facts.workspaceId || facts.organisationId === null) {
    return null;
  }
  const capabilities = serviceKeyCapabilities(facts.capabilities);
  const id = servicePrincipalId(facts.apiKeyId);
  return {
    userId: id,
    personId: id,
    side: "staff",
    organisationId: facts.organisationId,
    portal: "agent",
    credential: "api_key",
    memberships: [
      { scope: "workspace", scopeId: facts.workspaceId, seesAll: false },
    ],
    teamIds: [],
    reach: { kind: "membership" },
    authority: [
      {
        roleKey: "service-key",
        scope: "workspace",
        scopeId: facts.workspaceId,
        // Below every built-in role, so a service key never outranks a person.
        rank: 0,
        capabilities,
      },
    ],
    keyCapabilities: capabilities,
  };
}

/** Loader half: one bounded read of the key's workspace. */
export async function resolveServicePrincipal(
  input: {
    readonly apiKeyId: string;
    readonly workspaceId: string;
    readonly capabilities: readonly string[] | null;
  },
  executor: Pick<Executor, "select"> = db,
): Promise<ResolvedIdentity | null> {
  const [workspace] = await executor
    .select({ organisationId: schema.workspaceTable.organisationId })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, input.workspaceId))
    .limit(1);
  return servicePrincipalFromFacts({
    ...input,
    organisationId: workspace?.organisationId ?? null,
  });
}
