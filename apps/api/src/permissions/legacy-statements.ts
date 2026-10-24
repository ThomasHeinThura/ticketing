import {
  type Capability,
  expandCapabilities,
  isCapability,
} from "@taskdesk/permissions";

/**
 * The one translation between the inherited Better Auth `{ resource: action[] }` statement
 * vocabulary and the canonical `resource:action` capability vocabulary.
 *
 * WHY IT EXISTS. Custom-role capabilities live in the canonical `role` table (Thomas, 23 Oct).
 * About a hundred legacy gates still ask `requireWorkspacePermission({ ac: ["update"] })`, and
 * the role-editing API has always spoken statements. Every pair below is mapped to the
 * capability the route's registered policy declares, so the legacy gate and the policy gate
 * answer the same question from the same stored capability set.
 *
 * Reverse direction (capabilities to statements) is only for the backward-compatible `permission`
 * field of the role list response: a statement pair is shown as held when its capability is in
 * the role's expanded set.
 *
 * Mapping choices that are not identity (checked against `*policy.ts` declarations):
 * `ac:read` is `workspace:read`; `ac:create|update|delete` are `workspace:manage_roles`;
 * `member:create|update` are `workspace:manage_members`; `member:delete` and
 * `invitation:create|cancel` follow `member:remove` / `member:invite`; `team:*` is
 * `workspace:manage_settings` (teams.md); `organization:update|delete` are
 * `workspace:update|delete`; `project:share` is `project:manage_members`; every `label:*`
 * write is `label:manage` and `label:read` is `workspace:read`.
 */
export const LEGACY_PAIR_CAPABILITY: Readonly<Record<string, Capability>> = {
  "organization:update": "workspace:update",
  "organization:delete": "workspace:delete",
  "member:create": "workspace:manage_members",
  "member:update": "workspace:manage_members",
  "member:delete": "member:remove",
  "invitation:create": "member:invite",
  "invitation:cancel": "member:invite",
  "team:create": "workspace:manage_settings",
  "team:update": "workspace:manage_settings",
  "team:delete": "workspace:manage_settings",
  "ac:read": "workspace:read",
  "ac:create": "workspace:manage_roles",
  "ac:update": "workspace:manage_roles",
  "ac:delete": "workspace:manage_roles",
  "project:create": "project:create",
  "project:read": "project:read",
  "project:update": "project:update",
  "project:delete": "project:delete",
  "project:share": "project:manage_members",
  "work_item:create": "work_item:create",
  "work_item:read": "work_item:read",
  "work_item:update": "work_item:update",
  "work_item:delete": "work_item:delete",
  "work_item:assign": "work_item:assign",
  "label:create": "label:manage",
  "label:read": "workspace:read",
  "label:update": "label:manage",
  "label:delete": "label:manage",
  "workspace:read": "workspace:read",
  "workspace:update": "workspace:update",
  "workspace:delete": "workspace:delete",
  "workspace:manage_settings": "workspace:manage_settings",
};

type StatementMap = Record<string, readonly string[]>;

/**
 * Capabilities a stored legacy statement map grants. An unknown pair grants nothing (fail
 * closed); a pair that is itself a registered capability and has no explicit mapping maps to
 * itself, so a canonical-looking pair is never silently dropped.
 */
export function capabilitiesFromLegacyStatements(
  permission: StatementMap,
): Capability[] {
  const out = new Set<Capability>();
  for (const [resource, actions] of Object.entries(permission)) {
    for (const action of actions) {
      const pair = `${resource}:${action}`;
      const mapped = Object.hasOwn(LEGACY_PAIR_CAPABILITY, pair)
        ? LEGACY_PAIR_CAPABILITY[pair]
        : isCapability(pair)
          ? pair
          : undefined;
      if (mapped) out.add(mapped);
    }
  }
  return [...out].sort();
}

/**
 * Does the (already expanded) capability set satisfy every required legacy pair? A pair with
 * no capability mapping is never satisfied.
 */
export function capabilitiesSatisfyLegacyStatements(
  held: ReadonlySet<Capability>,
  required: StatementMap,
): boolean {
  for (const [resource, actions] of Object.entries(required)) {
    for (const action of actions) {
      const pair = `${resource}:${action}`;
      const capability = Object.hasOwn(LEGACY_PAIR_CAPABILITY, pair)
        ? LEGACY_PAIR_CAPABILITY[pair]
        : isCapability(pair)
          ? pair
          : undefined;
      if (!capability || !held.has(capability)) return false;
    }
  }
  return true;
}

/** Statement view of a capability set, for the backward-compatible `permission` response field. */
export function legacyStatementsFromCapabilities(
  capabilities: readonly string[],
): Record<string, string[]> {
  const held = expandCapabilities(capabilities, { tier: "workspace" });
  const out: Record<string, string[]> = {};
  for (const [pair, capability] of Object.entries(LEGACY_PAIR_CAPABILITY)) {
    if (!held.has(capability)) continue;
    const [resource, action] = pair.split(":") as [string, string];
    const actions = out[resource] ?? [];
    actions.push(action);
    out[resource] = actions;
  }
  return out;
}

/**
 * Apply a capability delta to a stored legacy statement map, for the built-in default roles
 * (`viewer` / `member` / `admin`) whose legacy `workspace_role.permission` row the legacy gates
 * still read. Every pair whose capability was removed is dropped; every pair whose capability was
 * added is added. Pairs outside `LEGACY_PAIR_CAPABILITY` (and pairs whose capability did not
 * change) are left exactly as stored, so a first edit never drifts the rest of the row.
 */
export function applyCapabilityDeltaToLegacyStatements(
  current: Record<string, readonly string[]>,
  delta: { added: readonly string[]; removed: readonly string[] },
): Record<string, string[]> {
  const removed = new Set(delta.removed);
  const added = new Set(delta.added);
  const out: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(current)) {
    out[resource] = actions.filter((action) => {
      const capability = LEGACY_PAIR_CAPABILITY[`${resource}:${action}`];
      return capability === undefined || !removed.has(capability);
    });
  }
  for (const [pair, capability] of Object.entries(LEGACY_PAIR_CAPABILITY)) {
    if (!added.has(capability)) continue;
    const [resource, action] = pair.split(":") as [string, string];
    const actions = out[resource] ?? [];
    if (!actions.includes(action)) actions.push(action);
    out[resource] = actions;
  }
  return out;
}
