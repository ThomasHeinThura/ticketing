/**
 * The policy registry.
 *
 * Feature folders each own a `policy.ts` exporting a `PolicyMap`; the registry is those maps
 * merged, with every key canonicalised and every value validated against the five kinds. It is
 * the single answer to "who may call this route", and it is built at module load so a bad
 * entry fails at boot rather than at request time (ADR 0010 §1).
 */

import { type Capability, isCapability } from "./capabilities";
import {
  BODY_PREDICATES,
  DELEGATED_SURFACES,
  isCapabilityPolicy,
  isDelegatedPolicy,
  isPortalPolicy,
  isPublicPolicy,
  isSelfPolicy,
  normaliseRouteKey,
  OWNER_PREDICATES,
  PORTAL_PREDICATES,
  type Policy,
  type PolicyKind,
  type PolicyMap,
  policyKind,
  type RouteKey,
  SCOPES,
} from "./policy";

/** One feature folder's `policy.ts`. */
export type PolicySource = {
  /** Where these came from, for error messages: `"apps/api/src/work-item/policy.ts"`. */
  readonly name: string;
  readonly policies: PolicyMap;
};

export type RegistryEntry = {
  readonly routeKey: RouteKey;
  readonly policy: Policy;
  readonly kind: PolicyKind;
  readonly source: string;
};

export class PolicyRegistryError extends Error {}

export type PolicyRegistry = {
  /** Every entry, sorted by route key. */
  readonly entries: readonly RegistryEntry[];
  /** Look one up. The key is canonicalised first, so `:id` and `{id}` find the same entry. */
  get(routeKey: string): RegistryEntry | undefined;
  has(routeKey: string): boolean;
  readonly routeKeys: readonly RouteKey[];
};

const SCOPE_SET: ReadonlySet<string> = new Set(SCOPES);
const OWNER_PREDICATE_SET: ReadonlySet<string> = new Set(OWNER_PREDICATES);
const BODY_PREDICATE_SET: ReadonlySet<string> = new Set(BODY_PREDICATES);
const PORTAL_PREDICATE_SET: ReadonlySet<string> = new Set(PORTAL_PREDICATES);
const DELEGATED_SET: ReadonlySet<string> = new Set(DELEGATED_SURFACES);

/**
 * Reject anything that is not one of the five kinds, or is one of them with a field the
 * closed sets do not contain. "The specs may use no other form."
 */
export function validatePolicy(routeKey: string, policy: Policy): string[] {
  const problems: string[] = [];
  const at = `${routeKey}`;

  let kind: PolicyKind;
  try {
    kind = policyKind(policy);
  } catch {
    problems.push(
      `${at}: policy matches none of the five kinds in rbac.md (capability | self | portal | public | delegated)`,
    );
    return problems;
  }

  const shapes = [
    isCapabilityPolicy(policy),
    isSelfPolicy(policy),
    isPortalPolicy(policy),
    isPublicPolicy(policy),
    isDelegatedPolicy(policy),
  ].filter(Boolean).length;
  if (shapes > 1) {
    problems.push(`${at}: policy mixes ${shapes} of the five kinds`);
  }

  if (isCapabilityPolicy(policy)) {
    if (!isCapability(policy.capability)) {
      problems.push(
        `${at}: unknown capability ${String(policy.capability)} — add it to rbac.md and capabilities.ts in the same change`,
      );
    }
    if (!SCOPE_SET.has(policy.scope)) {
      problems.push(`${at}: unknown scope ${String(policy.scope)}`);
    }
    if (policy.orOwner !== undefined) {
      if (!OWNER_PREDICATE_SET.has(policy.orOwner.predicate)) {
        problems.push(
          `${at}: unknown owner predicate ${String(policy.orOwner.predicate)}`,
        );
      }
      if (!isCapability(policy.orOwner.capability)) {
        problems.push(
          `${at}: unknown owner-branch capability ${String(policy.orOwner.capability)}`,
        );
      }
      if (
        policy.orOwner.withinMinutes !== undefined &&
        !(policy.orOwner.withinMinutes > 0)
      ) {
        problems.push(`${at}: withinMinutes must be a positive number`);
      }
    }
    if (policy.orSelfTarget !== undefined) {
      if (!BODY_PREDICATE_SET.has(policy.orSelfTarget.predicate)) {
        problems.push(
          `${at}: unknown body predicate ${String(policy.orSelfTarget.predicate)}`,
        );
      }
      if (!isCapability(policy.orSelfTarget.capability)) {
        problems.push(
          `${at}: unknown self-target capability ${String(policy.orSelfTarget.capability)}`,
        );
      }
    }
  }

  if (isPortalPolicy(policy)) {
    if (policy.portal !== "customer") {
      problems.push(`${at}: the only portal is "customer"`);
    }
    if (!PORTAL_PREDICATE_SET.has(policy.predicate)) {
      problems.push(
        `${at}: unknown portal predicate ${String(policy.predicate)}`,
      );
    }
  }

  if (isPublicPolicy(policy) && policy.reason.trim() === "") {
    problems.push(
      `${at}: a public route must state a reason — "public" is a deliberate, reviewable act`,
    );
  }

  if (isDelegatedPolicy(policy)) {
    if (!DELEGATED_SET.has(policy.delegated)) {
      problems.push(
        `${at}: ${String(policy.delegated)} is not in the closed delegated union — adding a member is a decision-log entry, not an edit`,
      );
    }
    if (policy.reason.trim() === "") {
      problems.push(
        `${at}: a delegated mount must say what it delegates to and why`,
      );
    }
  }

  if (policy.elevated === false && !policy.elevationExemptionReason?.trim()) {
    problems.push(
      `${at}: elevated: false needs elevationExemptionReason — an explicit, written opt-out`,
    );
  }

  if (kind === "public" && policy.sessionOnly === true) {
    problems.push(`${at}: a public route cannot be sessionOnly`);
  }

  return problems;
}

/** Merge feature policy maps into one registry, or throw with every problem listed at once. */
export function createPolicyRegistry(
  sources: readonly PolicySource[],
): PolicyRegistry {
  const byKey = new Map<RouteKey, RegistryEntry>();
  const problems: string[] = [];

  for (const source of sources) {
    for (const [rawKey, policy] of Object.entries(source.policies)) {
      let routeKey: RouteKey;
      try {
        routeKey = normaliseRouteKey(rawKey);
      } catch (error) {
        problems.push(`${source.name}: ${(error as Error).message}`);
        continue;
      }

      const existing = byKey.get(routeKey);
      if (existing !== undefined) {
        problems.push(
          `${routeKey}: declared twice — in ${existing.source} and ${source.name}. One route, one policy.`,
        );
        continue;
      }

      problems.push(
        ...validatePolicy(routeKey, policy).map((p) => `${source.name} → ${p}`),
      );

      byKey.set(routeKey, {
        routeKey,
        policy,
        kind: policyKind(policy),
        source: source.name,
      });
    }
  }

  if (problems.length > 0) {
    throw new PolicyRegistryError(
      `The route-policy registry is invalid:\n  ${problems.join("\n  ")}`,
    );
  }

  const entries = [...byKey.values()].sort((a, b) =>
    a.routeKey.localeCompare(b.routeKey),
  );

  return {
    entries,
    routeKeys: entries.map((entry) => entry.routeKey),
    get(routeKey: string) {
      return byKey.get(normaliseRouteKey(routeKey));
    },
    has(routeKey: string) {
      return byKey.has(normaliseRouteKey(routeKey));
    },
  };
}

/** Every capability named by a policy in the registry — what the "unreferenced capability" rule reads. */
export function capabilitiesReferencedBy(
  registry: PolicyRegistry,
): Set<Capability> {
  const referenced = new Set<Capability>();
  for (const entry of registry.entries) {
    if (!isCapabilityPolicy(entry.policy)) continue;
    referenced.add(entry.policy.capability);
    if (entry.policy.orOwner !== undefined) {
      referenced.add(entry.policy.orOwner.capability);
    }
    if (entry.policy.orSelfTarget !== undefined) {
      referenced.add(entry.policy.orSelfTarget.capability);
    }
  }
  return referenced;
}
