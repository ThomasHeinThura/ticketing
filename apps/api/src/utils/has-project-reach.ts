import {
  type Capability,
  can,
  isCapabilityPolicy,
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

export type ProjectReadDecision = {
  readonly reachable: boolean;
  readonly capable: boolean;
} | null;

export function hasProjectReadCapability(
  identity: ResolvedIdentity,
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
  if (!identity) return { reachable: false, capable: false };
  return {
    reachable: reaches(identity, facts),
    capable: hasProjectReadCapability(identity, capability, scope, facts),
  };
}

/** The caller's resolved identity for this request's credential (session, key or impersonation). */
export async function resolveCallerIdentity(
  c: Context,
  userId: string,
): Promise<ResolvedIdentity | null> {
  const apiKey = c.get("apiKey") as
    | { enabled?: boolean; userId?: string }
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
  if (!identity || !decision || decision.capable) return decision;
  // `orSelfTarget` / `orOwner` are conjunctions the handler settles against the row or body
  // (assign by self, clear own assignment). Reach is still decided here; the capability is
  // satisfied at this layer when the caller holds the primary OR a declared branch
  // capability, and the handler then applies the branch predicate. A caller holding neither
  // is refused 403 here, exactly as before.
  const branchCapabilities = [
    entry.policy.orSelfTarget?.capability,
    entry.policy.orOwner?.capability,
  ].filter((cap): cap is Capability => cap !== undefined);
  const capable = branchCapabilities.some((cap) =>
    hasProjectReadCapability(identity, cap, scope, facts),
  );
  return { reachable: decision.reachable, capable };
}
