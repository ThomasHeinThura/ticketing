import {
  type Capability,
  expandCapabilities,
  isCapability,
  normaliseRouteKey,
} from "@taskdesk/permissions";
import type { Context } from "hono";
import { capabilitiesSatisfyLegacyStatements } from "../permissions/legacy-statements";
import { serviceKeyCapabilities } from "../permissions/service-principal";
import { policyRegistry } from "../policy-registry";

/**
 * Workspace SERVICE keys (AK-7) on the legacy workspace gates.
 *
 * A service key has no person: its request carries an empty `userId`, so every gate that looks
 * up a membership row answered 401. The canonical principal (`permissions/service-principal.ts`)
 * already exists for the strict engine; these helpers let the three workspace-level legacy gates
 * (`workspaceAccess`, `requireWorkspacePermission`, `requireWorkspaceCapability`) answer from the
 * same facts, and nothing else:
 *
 *  - its own workspace only (the resolved workspace must equal the key's workspace);
 *  - exactly the key's stored workspace-tier capability subset (expanded the same way a role's
 *    grants are), never a role, never instance authority, never `sees_all`;
 *  - no project reach: routes addressed by a project / work item / row lookup stay denied (404),
 *    because a service key holds no project membership;
 *  - never a person: `userId` stays empty, so owner/self predicates cannot match and a handler
 *    that needs a person refuses (401) instead of acting as one.
 */
export type ServiceKeyFacts = {
  readonly id: string;
  readonly workspaceId: string;
  readonly capabilities: readonly string[] | null;
};

type WithService = {
  readonly id?: string;
  readonly service?: {
    readonly workspaceId: string;
    readonly capabilities: readonly string[] | null;
  };
};

/** The service-key facts of a credential object (`c.get("apiKey")`), or `null`. */
export function serviceKeyOfCredential(
  credential: unknown,
): ServiceKeyFacts | null {
  const key = credential as WithService | null | undefined;
  if (!key?.service || !key.id || !key.service.workspaceId) return null;
  return {
    id: key.id,
    workspaceId: key.service.workspaceId,
    capabilities: key.service.capabilities,
  };
}

export function serviceKeyOfRequest(c: Context): ServiceKeyFacts | null {
  return serviceKeyOfCredential(c.get("apiKey"));
}

function heldCapabilities(service: ServiceKeyFacts): ReadonlySet<Capability> {
  return expandCapabilities(serviceKeyCapabilities(service.capabilities), {
    tier: "workspace",
  });
}

/** Whether the key holds `capability` in `workspaceId` (its own workspace only). */
export function serviceKeyHolds(
  service: ServiceKeyFacts,
  workspaceId: string,
  capability: Capability,
): boolean {
  return (
    workspaceId === service.workspaceId &&
    isCapability(capability) &&
    heldCapabilities(service).has(capability)
  );
}

/** Legacy `{ resource: action[] }` statements answered from the key's capability subset. */
export function serviceKeySatisfiesStatements(
  service: ServiceKeyFacts,
  workspaceId: string,
  required: Record<string, readonly string[]>,
): boolean {
  return (
    workspaceId === service.workspaceId &&
    capabilitiesSatisfyLegacyStatements(heldCapabilities(service), required)
  );
}

/**
 * The registered policy of the route being served, or `undefined` when it cannot be decided.
 *
 * Every matched entry for the request method whose normalised key is registered counts; catch-all
 * middleware never has a registered key, so it is ignored. Exactly one distinct registered key is
 * the route; none, or a sibling parameter route that also matches (two keys), is ambiguous and the
 * caller must fail closed.
 */
export function registeredPolicyOfRequest(c: Context) {
  const keys = new Set<string>();
  for (const matched of c.req.matchedRoutes) {
    if (matched.method.toUpperCase() !== c.req.method.toUpperCase()) continue;
    try {
      const key = normaliseRouteKey(`${matched.method} ${matched.path}`);
      if (policyRegistry.get(key)) keys.add(key);
    } catch {
      // A path the registry cannot key is not a registered route.
    }
  }
  if (keys.size !== 1) return undefined;
  return policyRegistry.get([...keys][0] as string)?.policy;
}
