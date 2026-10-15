import {
  type Capability,
  can,
  isCapabilityPolicy,
  isKeyCredential,
  normaliseRouteKey,
  type ProjectReachFacts,
  type ResolvedIdentity,
  reaches,
  type Scope,
  type ScopeTarget,
} from "@taskdesk/permissions";
import type { Context } from "hono";
import { resolveIdentity } from "../permissions/resolve-identity";
import { policyRegistry } from "../policy-registry";
import {
  type ApiKeyPermissionScope,
  apiKeyCapabilitySubset,
} from "./require-api-key-permission-scope";

export type ProjectReadDecision = {
  readonly reachable: boolean;
  /**
   * The credential's own capability: for a session the owner's authority in the project; for
   * a key the owner's authority in the project INTERSECTED with the key's stored scope.
   */
  readonly capable: boolean;
  /**
   * The OWNER's authority in this project (workspace role overridden by the project role),
   * ignoring any key scope. Equal to `capable` for a session. A key's effective authority is
   * its stored scope ∩ this (#724), so the key can never do what the owner's session could
   * not do in the project. Gates that leave the key SCOPE to a downstream legacy check must
   * still require this.
   */
  readonly ownerCapable: boolean;
} | null;

/** The authority this identity's OWNER holds, with any key credential's scope removed. */
export function ownerAuthorityView(
  identity: ResolvedIdentity,
): Pick<ResolvedIdentity, "authority" | "keyCapabilities" | "credential"> {
  return {
    authority: identity.authority,
    credential: "session",
    keyCapabilities: undefined,
  };
}

/**
 * Whether a gate must refuse a caller that is reachable but not capable. A key whose scope is
 * judged by a downstream legacy gate (`deferApiKeyCapability`) is still held to its owner's
 * project authority here; `deferCapability` leaves the whole decision to the handler.
 */
export function projectCapabilityRefused(
  decision: { readonly capable: boolean; readonly ownerCapable: boolean },
  options: {
    readonly deferCapability?: boolean;
    readonly deferApiKeyCapability?: boolean;
    readonly isApiKey: boolean;
  },
): boolean {
  if (options.deferCapability === true) return false;
  if (options.isApiKey && options.deferApiKeyCapability === true)
    return !decision.ownerCapable;
  return !decision.capable;
}

export function hasProjectReadCapability(
  identity: Pick<ResolvedIdentity, "authority" | "keyCapabilities"> & {
    readonly credential?: ResolvedIdentity["credential"];
  },
  capability: Capability,
  scope: Extract<Scope, "project" | "work_item">,
  facts: ProjectReachFacts & { readonly workItemId?: string },
): boolean {
  const target: ScopeTarget =
    scope === "project"
      ? { projectId: facts.projectId, workspaceId: facts.workspaceId }
      : {
          projectId: facts.projectId,
          workItemProjectId: facts.projectId,
          workItemId: facts.workItemId,
          workspaceId: facts.workspaceId,
        };
  return can(identity, capability, scope, target);
}

export function evaluateProjectRead(
  identity: ResolvedIdentity | null,
  capability: Capability,
  scope: Extract<Scope, "project" | "work_item">,
  facts: ProjectReachFacts & { readonly workItemId?: string },
): ProjectReadDecision {
  if (!identity)
    return { reachable: false, capable: false, ownerCapable: false };
  const capable = hasProjectReadCapability(identity, capability, scope, facts);
  return {
    reachable: reaches(identity, facts),
    capable,
    ownerCapable: isKeyCredential(identity.credential)
      ? hasProjectReadCapability(
          ownerAuthorityView(identity),
          capability,
          scope,
          facts,
        )
      : capable,
  };
}

/**
 * The caller's resolved identity for this request's credential (session, key or impersonation).
 *
 * A key identity carries the key's STORED capability scope (#750), projected by the same
 * `apiKeyCapabilitySubset` the request adapter and the sockets use, so `can()` evaluates owner
 * RBAC ∩ key scope. A missing, null or malformed stored scope projects to no capabilities and
 * is refused; a key can never hold more than its owner.
 */
export async function resolveCallerIdentity(
  c: Context,
  userId: string,
): Promise<ResolvedIdentity | null> {
  const apiKey = c.get("apiKey") as
    | ({ enabled?: boolean; userId?: string } & ApiKeyPermissionScope)
    | undefined;
  const session = c.get("session") as
    | { impersonatedBy?: string | null }
    | null
    | undefined;
  return resolveIdentity({
    userId,
    credential: apiKey
      ? "api_key"
      : session?.impersonatedBy
        ? "impersonation"
        : "session",
    ...(apiKey
      ? {
          apiKey: {
            enabled: apiKey.enabled === true,
            ownerUserId: apiKey.userId ?? "",
            capabilities: apiKeyCapabilitySubset(apiKey),
          },
        }
      : {}),
  });
}

/** Evaluate the registered project/work-item read policy against live persisted facts. */
export async function projectReadDecision(
  c: Context,
  userId: string,
  facts: ProjectReachFacts & { readonly workItemId?: string },
): Promise<ProjectReadDecision> {
  const routePath = c.req.routePath;
  if (!routePath) return null;

  let routeKey: string;
  try {
    routeKey = normaliseRouteKey(`${c.req.method} ${routePath}`);
  } catch {
    return null;
  }

  const entry = policyRegistry.get(routeKey);
  if (
    !entry ||
    !isCapabilityPolicy(entry.policy) ||
    entry.policy.reach !== "required" ||
    (entry.policy.scope !== "project" && entry.policy.scope !== "work_item")
  ) {
    return null;
  }

  const policy = entry.policy;
  // Narrowed by the guard above (project or work_item scope only).
  const scope = policy.scope as "project" | "work_item";
  const identity = await resolveCallerIdentity(c, userId);
  const decision = evaluateProjectRead(
    identity,
    entry.policy.capability,
    entry.policy.scope,
    facts,
  );
  if (!identity || !decision || (decision.capable && decision.ownerCapable))
    return decision;
  // `orSelfTarget` / `orOwner` are conjunctions the handler settles against the row or body
  // (assign by self, clear own assignment). Reach is still decided here; the capability is
  // satisfied at this layer when the caller holds the primary OR a declared branch
  // capability, and the handler then applies the branch predicate. A caller holding neither
  // is refused 403 here, exactly as before.
  const branchCapabilities = [
    entry.policy.orSelfTarget?.capability,
    entry.policy.orOwner?.capability,
  ].filter((cap): cap is Capability => cap !== undefined);
  const owner = ownerAuthorityView(identity);
  return {
    reachable: decision.reachable,
    capable:
      decision.capable ||
      branchCapabilities.some((cap) =>
        hasProjectReadCapability(identity, cap, scope, facts),
      ),
    ownerCapable:
      decision.ownerCapable ||
      branchCapabilities.some((cap) =>
        hasProjectReadCapability(owner, cap, scope, facts),
      ),
  };
}
