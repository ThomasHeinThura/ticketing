import {
  CAPABILITY_NAMES,
  type Capability,
  capabilityTier,
  expandCapabilities,
  isCapability,
} from "@taskdesk/permissions";

/**
 * AK-9 / MC-16: every personal key is read-only by default. The default (and the "read
 * only" preset of the capability picker) is exactly the workspace-tier capabilities whose
 * action is `read`: nothing is invented here, the set is derived from the registry.
 */
export const READ_ONLY_KEY_CAPABILITIES: readonly Capability[] =
  CAPABILITY_NAMES.filter(
    (name) => name.endsWith(":read") && capabilityTier(name) === "workspace",
  );

export function isReadCapability(capability: Capability): boolean {
  return READ_ONLY_KEY_CAPABILITIES.includes(capability);
}

/** Write opt-in (AK-9): any requested capability outside the read set. */
export function writeCapabilitiesOf(
  capabilities: readonly Capability[],
): Capability[] {
  return capabilities.filter((capability) => !isReadCapability(capability));
}

export class KeyCapabilityError extends Error {
  constructor(
    readonly code:
      | "unknown_capability"
      | "empty_capability_set"
      | "beyond_creator",
    message: string,
    readonly capabilities: readonly string[] = [],
  ) {
    super(message);
    this.name = "KeyCapabilityError";
  }
}

/**
 * Validate a requested subset: every string must be a registered capability (an
 * unrecognised string is never stored, AK-12) and the set must not be empty. Order is
 * normalised so equal sets store equally.
 */
export function parseRequestedCapabilities(
  requested: readonly string[] | undefined,
): Capability[] {
  const names = requested ?? READ_ONLY_KEY_CAPABILITIES;
  const unknown = names.filter((name) => !isCapability(name));
  if (unknown.length > 0)
    throw new KeyCapabilityError(
      "unknown_capability",
      "unknown_capability: the key request names a capability this build does not know",
      unknown,
    );
  const unique = [...new Set(names as readonly Capability[])].sort();
  if (unique.length === 0)
    throw new KeyCapabilityError(
      "empty_capability_set",
      "empty_capability_set: a key needs at least one capability",
    );
  return unique;
}

/**
 * Stored subset in better-auth's `permissions` statement shape (`{ resource: [action] }`),
 * which `apiKeyCapabilitySubset` reads back as `resource:action`. Capability names carry
 * exactly one colon, so the split is lossless.
 */
export function capabilitiesToPermissions(
  capabilities: readonly Capability[],
): Record<string, string[]> {
  const permissions: Record<string, string[]> = {};
  for (const capability of capabilities) {
    const [resource, action] = capability.split(":") as [string, string];
    const actions = permissions[resource] ?? [];
    if (!actions.includes(action)) actions.push(action);
    permissions[resource] = actions;
  }
  return permissions;
}

/**
 * AK-7: a service key's subset is bounded by its creator's authority at creation, evaluated
 * against the expanded closure exactly like a role grant. Instance-tier capabilities are
 * refused outright (a workspace-owned credential never carries instance authority).
 * Returns the frozen, expanded set to store and audit; throws `beyond_creator` naming every
 * capability the creator does not hold.
 */
export function boundServiceKeyCapabilities(
  requested: readonly Capability[],
  creatorHeld: ReadonlySet<Capability>,
): Capability[] {
  const closure = expandCapabilities(requested, { tier: "workspace" });
  const outside: string[] = [];
  for (const capability of requested) {
    if (!closure.has(capability)) outside.push(capability);
  }
  for (const capability of closure) {
    if (!creatorHeld.has(capability)) outside.push(capability);
  }
  if (outside.length > 0)
    throw new KeyCapabilityError(
      "beyond_creator",
      "beyond_creator: a service key cannot hold a capability its creator does not hold",
      [...new Set(outside)].sort(),
    );
  return [...closure].sort();
}
