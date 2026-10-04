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

  const apiKey = c.get("apiKey") as
    | { enabled?: boolean; userId?: string }
    | undefined;
  const session = c.get("session") as
    | { impersonatedBy?: string | null }
    | null
    | undefined;
  const identity = await resolveIdentity({
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
  return evaluateProjectRead(
    identity,
    entry.policy.capability,
    entry.policy.scope,
    facts,
  );
}
