import {
  BUILT_IN_ROLES,
  CAPABILITIES,
  CAPABILITY_GROUPS,
  CAPABILITY_NAMES,
  type Capability,
  expandCapabilities,
  isCapability,
} from "@taskdesk/permissions";

/**
 * The capability vocabulary as the role editor shows it (RL-1, RL-2): grouped by area, each with
 * the one-line plain-English description. Everything comes from `@taskdesk/permissions`'
 * `CAPABILITIES`, the same table the API validates against, so the UI never carries its own list.
 * Instance-tier capabilities are never grantable from a workspace role (RL-6) and are not listed.
 */
export type CapabilityItem = {
  id: Capability;
  label: string;
  description: string;
  group: string;
};

/**
 * The vocabulary's descriptions are written in markdown for the documentation (`**not**`,
 * `[Reach](#reach)`, backticks). The editor shows plain sentences.
 */
export function plainDescription(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function titleCase(value: string): string {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** `work_item:update_any` becomes "Work item: update any". */
export function capabilityLabel(id: string): string {
  const [resource = "", action = ""] = id.split(":");
  return `${titleCase(resource)}: ${action.replaceAll("_", " ")}`;
}

const GROUP_ORDER: readonly string[] = CAPABILITY_GROUPS;

export const ROLE_CAPABILITY_ITEMS: readonly CapabilityItem[] =
  CAPABILITY_NAMES.filter((id) => CAPABILITIES[id].group !== "Instance")
    .map((id) => ({
      id,
      label: capabilityLabel(id),
      description: plainDescription(CAPABILITIES[id].description),
      group: CAPABILITIES[id].group as string,
    }))
    .sort(
      (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
    );

export function describeCapability(id: string): string {
  return isCapability(id) ? plainDescription(CAPABILITIES[id].description) : id;
}

/** The stored closure of an explicit selection (RL-5): implications are transitive. */
export function capabilityClosure(selected: readonly string[]): string[] {
  return [...expandCapabilities(selected, { tier: "workspace" })].sort();
}

/**
 * For every capability in the closure, the explicitly ticked capabilities that imply it. A
 * capability that something else still requires cannot be unticked until that is, which is how
 * the editor shows RL-5 instead of silently re-ticking it.
 */
export function requiredByMap(
  explicit: readonly string[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const name of explicit) {
    if (!isCapability(name)) continue;
    for (const implied of expandCapabilities([name], { tier: "workspace" })) {
      if (implied === name) continue;
      const list = out[implied] ?? [];
      list.push(name);
      out[implied] = list;
    }
  }
  return out;
}

/** What a selection added to and removed from a baseline, sorted. */
export function diffSelections(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((name) => !beforeSet.has(name)).sort(),
    removed: before.filter((name) => !afterSet.has(name)).sort(),
  };
}

export type RoleLike = {
  role: string;
  rank: number;
  capabilities: readonly string[];
};

/** The capability set the signed-in person holds, from their own role: `owner` is compiled. */
export function heldCapabilities(
  roleKey: string | undefined,
  roles: readonly RoleLike[],
): ReadonlySet<string> {
  if (!roleKey) return new Set();
  if (roleKey === "owner") {
    return expandCapabilities(BUILT_IN_ROLES.owner.capabilities, {
      tier: "workspace",
    });
  }
  const own = roles.find((role) => role.role === roleKey);
  return own
    ? expandCapabilities(own.capabilities, { tier: "workspace" })
    : new Set();
}

/** The caller's rank: `owner` is compiled, every other key reads its row; none means 0. */
export function callerRank(
  roleKey: string | undefined,
  roles: readonly RoleLike[],
): number {
  if (!roleKey) return 0;
  if (roleKey === "owner") return BUILT_IN_ROLES.owner.rank;
  return roles.find((role) => role.role === roleKey)?.rank ?? 0;
}

export type CapabilityGroupSummary = {
  group: string;
  items: { id: string; description: string }[];
};

/** RL-11: the capability set in plain sentences, grouped by area. */
export function summariseCapabilities(
  capabilities: readonly string[],
): CapabilityGroupSummary[] {
  const held = new Set(capabilityClosure(capabilities));
  const groups = new Map<string, CapabilityGroupSummary>();
  for (const item of ROLE_CAPABILITY_ITEMS) {
    if (!held.has(item.id)) continue;
    const entry = groups.get(item.group) ?? { group: item.group, items: [] };
    entry.items.push({ id: item.id, description: item.description });
    groups.set(item.group, entry);
  }
  return [...groups.values()];
}

export type CompareRow = {
  id: string;
  description: string;
  group: string;
  inLeft: boolean;
  inRight: boolean;
};

/** RL-13: only where the two roles differ, in vocabulary order. */
export function compareCapabilities(
  left: readonly string[],
  right: readonly string[],
): CompareRow[] {
  const leftSet = new Set(capabilityClosure(left));
  const rightSet = new Set(capabilityClosure(right));
  return ROLE_CAPABILITY_ITEMS.filter(
    (item) => leftSet.has(item.id) !== rightSet.has(item.id),
  ).map((item) => ({
    id: item.id,
    description: item.description,
    group: item.group,
    inLeft: leftSet.has(item.id),
    inRight: rightSet.has(item.id),
  }));
}
