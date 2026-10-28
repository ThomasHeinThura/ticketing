import { CHANGE_RISK_LEVELS, type ChangeRiskLevel } from "../workflow/types.js";

/**
 * Pure service-management rules (`feature-contracts-p5.md` "Service catalogue, changes and
 * releases"): risk to approval, change-window and freeze overlap, same-service conflicts and
 * cycle-safe impact traversal. No I/O, no clock read: callers pass `now`.
 */

export const SERVICE_STATUSES = ["operational", "degraded", "outage"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const SUPPORT_LEVELS = ["L1", "L2", "L3"] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];

export const RELEASE_STATUSES = [
  "planned",
  "in_progress",
  "released",
  "cancelled",
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

const RISK_RANK: Record<ChangeRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function isChangeRiskLevel(value: unknown): value is ChangeRiskLevel {
  return (
    typeof value === "string" &&
    (CHANGE_RISK_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * `CH-3`: does a change of this risk need CAB approval? High risk always does, and so does a
 * change whose risk is unset (never assume the lowest). Medium and low need CAB unless the
 * workspace's pre-approval ceiling (`preApprovalMaxRisk`, the `change_risk_at_most` guard level of
 * its non-CAB approval path) covers the risk. A ceiling of `high` is ignored: high always needs CAB.
 */
export function requiresCabApproval(
  risk: ChangeRiskLevel | null,
  preApprovalMaxRisk: ChangeRiskLevel | null,
): boolean {
  if (risk === null || risk === "high") return true;
  if (preApprovalMaxRisk === null) return true;
  return RISK_RANK[risk] > RISK_RANK[preApprovalMaxRisk];
}

/** A half-open instant range `[start, end)`; a window with `end <= start` is invalid. */
export interface TimeRange {
  start: Date;
  end: Date;
}

export function isValidRange(range: TimeRange): boolean {
  return (
    Number.isFinite(range.start.getTime()) &&
    Number.isFinite(range.end.getTime()) &&
    range.end.getTime() > range.start.getTime()
  );
}

/** Two half-open ranges overlap when each starts before the other ends. */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return (
    a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime()
  );
}

export interface FreezeLike extends TimeRange {
  id: string;
  /** A cancelled freeze never blocks. */
  cancelledAt?: Date | null;
  /** Optimistic version; an edit bumps it, which voids any override recorded against the old one. */
  version?: number | null;
}

/** A freeze an override was granted for, with the freeze's version at that moment (`CH-4`). */
export interface FreezeOverrideEntry {
  id: string;
  version: number;
}

/** The freezes whose range overlaps the change's deployment window. Empty for an unset window. */
export function freezesCoveringWindow<F extends FreezeLike>(
  window: TimeRange | null,
  freezes: readonly F[],
): F[] {
  if (!window || !isValidRange(window)) return [];
  return freezes.filter(
    (freeze) => !freeze.cancelledAt && rangesOverlap(window, freeze),
  );
}

export interface FreezeDecisionInput {
  window: TimeRange | null;
  freezes: readonly FreezeLike[];
  /** The change's freeze override flag (set only through the elevated override route). */
  overrideGranted: boolean;
  /**
   * The freezes the override was granted for. An override is freeze-scoped: a covering freeze is
   * overridden only when it is listed here AND has not been edited since (same version). Any
   * other covering freeze (declared later, edited since, or never shown) still blocks.
   */
  overrideFreezes?: readonly FreezeOverrideEntry[] | null;
}

export type FreezeDecision =
  | { blocked: false; reason: "no_window" | "no_freeze" | "overridden" }
  | { blocked: true; reason: "frozen"; freezeIds: string[] };

/**
 * `CH-4` has no exemption for a change without a window: approving it is deploying "now", so
 * the freeze check treats it as an instant (a 1 ms range) starting at `now`. A change with a
 * window is checked against that window.
 */
export function approvalFreezeWindow(
  window: TimeRange | null,
  now: Date,
): TimeRange {
  return window ?? { start: now, end: new Date(now.getTime() + 1) };
}

/**
 * True when the override covers this freeze: it was recorded for this freeze id and the freeze has
 * not been edited since (same version). A freeze without a version never counts as covered.
 */
export function overrideCovers(
  overrideGranted: boolean,
  overrideFreezes: readonly FreezeOverrideEntry[] | null | undefined,
  freeze: FreezeLike,
): boolean {
  return (
    overrideGranted &&
    freeze.version != null &&
    (overrideFreezes ?? []).some(
      (entry) => entry.id === freeze.id && entry.version === freeze.version,
    )
  );
}

/**
 * `CH-4`: no change may be approved while its deployment window overlaps a freeze, unless an
 * override recorded for that very freeze still holds. Callers pass
 * `approvalFreezeWindow(window, now)`, so a change with no window is held against the freezes
 * covering now (a null window here means "not placed" and is allowed, which only read-only
 * displays of unplanned drafts use).
 */
export function decideFreeze(input: FreezeDecisionInput): FreezeDecision {
  if (!input.window) return { blocked: false, reason: "no_window" };
  const covering = freezesCoveringWindow(input.window, input.freezes);
  if (covering.length === 0) return { blocked: false, reason: "no_freeze" };
  const blocking = covering.filter(
    (freeze) =>
      !overrideCovers(input.overrideGranted, input.overrideFreezes, freeze),
  );
  if (blocking.length === 0) return { blocked: false, reason: "overridden" };
  return {
    blocked: true,
    reason: "frozen",
    freezeIds: blocking.map((freeze) => freeze.id),
  };
}

/**
 * An edge that approves a change: it needs CAB, or it is a pre-approval path gated by
 * `change_risk_at_most` (`CH-3`). Both are subject to the rollback plan and freeze gates.
 */
export function isChangeApprovalEdge(transition: {
  requiresCab: boolean;
  guards: readonly { type: string }[];
}): boolean {
  return (
    transition.requiresCab ||
    transition.guards.some((guard) => guard.type === "change_risk_at_most")
  );
}

/** `CH-6`: a rollback plan must be present (non-blank) before approval. */
export function hasRollbackPlan(plan: string | null | undefined): boolean {
  return typeof plan === "string" && plan.trim().length > 0;
}

/** Edge case: a window that ended before `now` is recorded retrospectively and marked as such. */
export function isRetrospectiveWindow(window: TimeRange, now: Date): boolean {
  return window.end.getTime() <= now.getTime();
}

export interface PlannedChange {
  id: string;
  window: TimeRange;
  serviceIds: readonly string[];
}

export interface ChangeConflict {
  changeIds: [string, string];
  serviceIds: string[];
}

/**
 * `CH-5`: two changes to the same service in overlapping windows are flagged. Each pair is
 * reported once with the shared services, sorted for a stable result.
 */
export function findChangeConflicts(
  changes: readonly PlannedChange[],
): ChangeConflict[] {
  const conflicts: ChangeConflict[] = [];
  for (let i = 0; i < changes.length; i++) {
    for (let j = i + 1; j < changes.length; j++) {
      const a = changes[i];
      const b = changes[j];
      if (!a || !b) continue;
      if (!isValidRange(a.window) || !isValidRange(b.window)) continue;
      if (!rangesOverlap(a.window, b.window)) continue;
      const bServices = new Set(b.serviceIds);
      const shared = [...new Set(a.serviceIds)]
        .filter((serviceId) => bServices.has(serviceId))
        .sort();
      if (shared.length > 0)
        conflicts.push({ changeIds: [a.id, b.id], serviceIds: shared });
    }
  }
  return conflicts;
}

/** `service depends on dependsOn`: an outage of `dependsOn` impacts `service`. */
export interface DependencyEdge {
  serviceId: string;
  dependsOnServiceId: string;
}

export interface ImpactNode {
  serviceId: string;
  /** 1 = depends directly on the changed service. */
  depth: number;
  /** The service on the changed side of the edge this node was reached through. */
  viaServiceId: string;
}

export interface ImpactResult {
  rootServiceId: string;
  /** Breadth-first, then by service id, so the indented list is stable. */
  impacted: ImpactNode[];
  /** True when the walk met a service it had already visited (a cycle, `SVC-5`). */
  cycleDetected: boolean;
  /** Services that close a cycle: the walk stopped at them. */
  cycleServiceIds: string[];
}

/**
 * `SVC-5`: every service that depends, directly or transitively, on `rootServiceId`. A circular
 * dependency is permitted but flagged: the walk stops at the already visited service and says so.
 */
export function traverseImpact(
  rootServiceId: string,
  edges: readonly DependencyEdge[],
): ImpactResult {
  const dependents = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.serviceId === edge.dependsOnServiceId) continue;
    const list = dependents.get(edge.dependsOnServiceId) ?? [];
    list.push(edge.serviceId);
    dependents.set(edge.dependsOnServiceId, list);
  }
  const visited = new Set<string>([rootServiceId]);
  const impacted: ImpactNode[] = [];
  const cycleServiceIds = new Set<string>();
  let frontier = [rootServiceId];
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: string[] = [];
    for (const parent of [...frontier].sort()) {
      for (const child of [...(dependents.get(parent) ?? [])].sort()) {
        if (visited.has(child)) {
          // Reaching the root or an ancestor again closes a cycle; a diamond (two paths to the
          // same dependent) is not a cycle, so only flag a node that can reach `parent` back.
          if (reaches(child, parent, dependents)) cycleServiceIds.add(child);
          continue;
        }
        visited.add(child);
        impacted.push({ serviceId: child, depth, viaServiceId: parent });
        next.push(child);
      }
    }
    frontier = next;
  }
  return {
    rootServiceId,
    impacted,
    cycleDetected: cycleServiceIds.size > 0,
    cycleServiceIds: [...cycleServiceIds].sort(),
  };
}

function reaches(
  from: string,
  to: string,
  dependents: ReadonlyMap<string, string[]>,
): boolean {
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === to) return true;
    for (const child of dependents.get(current) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        stack.push(child);
      }
    }
  }
  return false;
}

/**
 * Would adding `serviceId depends on dependsOn` create a cycle? Permitted but flagged, so the
 * caller reports it rather than refusing.
 */
export function wouldCreateCycle(
  serviceId: string,
  dependsOnServiceId: string,
  edges: readonly DependencyEdge[],
): boolean {
  if (serviceId === dependsOnServiceId) return true;
  return traverseImpact(serviceId, edges).impacted.some(
    (node) => node.serviceId === dependsOnServiceId,
  );
}

export interface ReleaseNoteChange {
  key: string;
  title: string;
  /** Work item type name, for grouping. */
  typeName: string;
}

/**
 * `REL-4`: release notes generated from the associated changes. A release with no changes has
 * empty notes that say so (edge case).
 */
export function generateReleaseNotes(
  releaseName: string,
  changes: readonly ReleaseNoteChange[],
): string {
  if (changes.length === 0)
    return `# ${releaseName}\n\nNo changes are associated with this release.\n`;
  const lines = [`# ${releaseName}`, ""];
  const byType = new Map<string, ReleaseNoteChange[]>();
  for (const change of changes) {
    const list = byType.get(change.typeName) ?? [];
    list.push(change);
    byType.set(change.typeName, list);
  }
  for (const typeName of [...byType.keys()].sort()) {
    lines.push(`## ${typeName}`, "");
    for (const change of (byType.get(typeName) ?? []).sort((a, b) =>
      a.key.localeCompare(b.key),
    ))
      lines.push(`- ${change.key}: ${change.title}`);
    lines.push("");
  }
  return `${lines.join("\n")}`;
}
