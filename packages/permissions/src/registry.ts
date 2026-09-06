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
  SCOPE_SOURCES,
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
const SCOPE_SOURCE_SET: ReadonlySet<string> = new Set(SCOPE_SOURCES);
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

  // `scopeSource` means something only for a capability policy — self, portal, public and
  // delegated have no scope whose provenance could be a row or a request. It is not merely
  // unused on those four kinds, it is refused: a declared-and-ignored field is how a control
  // gets documented and absent at the same time (the same failure mode `elevated`/`sessionOnly`
  // on kind 4 already closes above). Checked from an untyped view because a well-typed literal
  // of the other four kinds cannot carry this field at all — this is the runtime layer for a
  // policy map that arrived as JSON or from a plugin and never met `tsc`.
  if (!isCapabilityPolicy(policy)) {
    const untyped = policy as { readonly scopeSource?: unknown };
    if (untyped.scopeSource !== undefined) {
      problems.push(
        `${at}: only a capability policy may declare scopeSource — a ${kind} policy has no scope whose provenance applies, and supplying it is refused as incoherent`,
      );
    }
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
    if (!SCOPE_SOURCE_SET.has(policy.scopeSource)) {
      problems.push(
        `${at}: scopeSource must be "row", "request" or "instance" (got ${String(policy.scopeSource)}) — it is not optional, and there is no default`,
      );
    } else if (
      policy.scope === "instance" &&
      policy.scopeSource !== "instance"
    ) {
      problems.push(
        `${at}: scope "instance" has no tenant or resource id whose provenance could be a row or a request — declare scopeSource: "instance"`,
      );
    } else if (
      policy.scope !== "instance" &&
      policy.scopeSource === "instance"
    ) {
      problems.push(
        `${at}: scopeSource "instance" is only valid for scope "instance" — "${policy.scope}" is id-bearing and must declare "row" or "request"`,
      );
    }
    problems.push(
      ...reachProblems(at, policy.reach, policy.orOwner !== undefined),
    );
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

  if (isSelfPolicy(policy)) {
    problems.push(...personParamProblems(at, routeKey, policy.personParam));
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

  // Kind 4 has no identity, so the two identity-shaped flags are contradictions rather than
  // constraints. `PublicElevationFlags` makes them unrepresentable on a well-typed literal;
  // this refuses them again at boot, because a policy map can arrive from JSON or a plugin
  // without meeting the compiler.
  if (kind === "public") {
    const flags = policy as {
      readonly sessionOnly?: unknown;
      readonly elevated?: unknown;
    };
    if (flags.sessionOnly === true) {
      problems.push(
        `${at}: a public route cannot be sessionOnly — kind 4 accepts a request with no credential at all, so there is no session to require`,
      );
    }
    if (flags.elevated === true) {
      problems.push(
        `${at}: a public route cannot be elevated — elevation is a fresh authentication of the caller, and kind 4 has no caller. Declare elevated: false with an elevationExemptionReason instead.`,
      );
    }
  }

  return problems;
}

/**
 * A capability route states, in writing, whether it addresses a resource. There is no default:
 * a missing `reach` is the omission the evaluator would otherwise have to guess about, and a
 * policy map can arrive from JSON or a plugin where the type never ran.
 */
function reachProblems(
  at: string,
  reach: unknown,
  hasOwnerBranch: boolean,
): string[] {
  if (reach === "required") return [];
  if (
    typeof reach === "object" &&
    reach !== null &&
    (reach as { exempt?: unknown }).exempt === "no_single_resource"
  ) {
    if (hasOwnerBranch) {
      return [
        `${at}: an orOwner branch reads a loaded row, so the route does address a single resource — it cannot claim the no_single_resource exemption`,
      ];
    }
    const reason = (reach as { reason?: unknown }).reason;
    if (typeof reason !== "string" || reason.trim() === "") {
      return [
        `${at}: a reach exemption must say why the route addresses no single resource — omitting the reach check is a deliberate, reviewable act`,
      ];
    }
    return [];
  }
  return [
    `${at}: reach must be "required" or { exempt: "no_single_resource", reason } — a route that addresses a resource is reach-checked, and one that does not says so`,
  ];
}

/**
 * A self route names the parameter it scopes by, and the parameter must actually be in the
 * path — which turns "the middleware extracts the right thing" from a promise into a check.
 */
function personParamProblems(
  at: string,
  routeKey: string,
  param: unknown,
): string[] {
  if (typeof param === "string") {
    if (param.trim() === "") {
      return [
        `${at}: personParam must name a path parameter, or declare the exemption`,
      ];
    }
    if (!routeKey.includes(`{${param}}`)) {
      return [
        `${at}: personParam "${param}" is not a parameter of this route — the policy and the path disagree about what names a person`,
      ];
    }
    return [];
  }
  if (
    typeof param === "object" &&
    param !== null &&
    (param as { exempt?: unknown }).exempt === "no_person_parameter"
  ) {
    const reason = (param as { reason?: unknown }).reason;
    if (typeof reason !== "string" || reason.trim() === "") {
      return [
        `${at}: a no_person_parameter exemption must say why this route names no person`,
      ];
    }
    return [];
  }
  return [
    `${at}: personParam must name a path parameter or declare { exempt: "no_person_parameter", reason }`,
  ];
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
