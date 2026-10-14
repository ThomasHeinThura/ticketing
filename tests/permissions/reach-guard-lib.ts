import {
  WORK_ITEM_REACH_MARK,
  type WorkItemReachMark,
} from "../../apps/api/src/utils/reach-mark";

/**
 * Shared checkers for the structural reach guards (`work-item-reach-guard.test.ts`,
 * `project-reach-guard.test.ts`). Pure functions, so each guard's negative cases can prove the
 * checker is not vacuous. A route's reach mark is SELF-ATTESTED by its middleware; it proves
 * declaration, so every guard also requires a behavioural-table row (`findCoverageProblems`).
 */

export type Handler = (...args: never[]) => unknown;

export type ReachFinding = { readonly route: string; readonly problem: string };

export function markOf(handler: Handler): WorkItemReachMark | undefined {
  return (handler as unknown as Record<symbol, WorkItemReachMark | undefined>)[
    WORK_ITEM_REACH_MARK
  ];
}

export function handlerWith(mark?: WorkItemReachMark): Handler {
  const fn = (() => undefined) as unknown as Handler;
  if (mark) Object.assign(fn, { [WORK_ITEM_REACH_MARK]: mark });
  return fn;
}

/**
 * Every listed route must carry a reach middleware that resolves PROJECT reach, or an
 * explicit workspace-only opt-out that names its reason, or a reasoned entry in `exempt`
 * (reach decided by another mechanism). Stale or contradictory exemptions also fail.
 */
export function findReachProblems(
  routes: ReadonlyMap<string, readonly Handler[]>,
  routeKeys: readonly string[],
  exempt: Readonly<Record<string, string>>,
): ReachFinding[] {
  const findings: ReachFinding[] = [];
  for (const routeKey of routeKeys) {
    const handlers = routes.get(routeKey) ?? [];
    const marks = handlers
      .map(markOf)
      .filter((m): m is WorkItemReachMark => m !== undefined);
    const exemption = exempt[routeKey];
    if (marks.length === 0) {
      if (exemption === undefined || exemption.trim() === "") {
        findings.push({
          route: routeKey,
          problem: "no project-reach middleware and no reasoned exemption",
        });
      }
      continue;
    }
    if (exemption !== undefined) {
      findings.push({
        route: routeKey,
        problem: "exempted but carries a reach middleware: drop the exemption",
      });
    }
    // The route is sound when SOME middleware on it resolves PROJECT reach, or an explicit
    // opt-out names its reason (`workspaceReachOnlyReason`). A bare `workspaceAccess.*`
    // middleware that checks workspace membership only is the exact weakness this guard exists
    // for: it satisfies neither, so the route fails unless it has a reasoned exemption.
    const sound = marks.some(
      (mark) =>
        mark.projectReach ||
        (mark.workspaceReachOnlyReason !== undefined &&
          mark.workspaceReachOnlyReason.trim() !== ""),
    );
    if (!sound && exemption === undefined) {
      findings.push({
        route: routeKey,
        problem: "workspace-only reach without a stated reason",
      });
    }
  }
  for (const key of Object.keys(exempt)) {
    if (!routeKeys.includes(key)) {
      findings.push({ route: key, problem: "stale exemption: no such route" });
    }
  }
  return findings;
}

/**
 * A marker proves declaration, not enforcement. Every route in the set must ALSO appear in a
 * behavioural table (the integration suites drive the real middleware and assert 404/403/key
 * outcomes), or carry a reasoned exemption.
 */
export function findCoverageProblems(
  routeKeys: readonly string[],
  covered: ReadonlySet<string>,
  exempt: Readonly<Record<string, string>>,
): string[] {
  const problems: string[] = [];
  for (const key of routeKeys) {
    if (!covered.has(key) && exempt[key] === undefined) {
      problems.push(`${key}: marked but no behavioural test row`);
    }
  }
  for (const key of covered) {
    if (!routeKeys.includes(key)) {
      problems.push(
        `${key}: behavioural row for a route outside the guard set`,
      );
    }
  }
  return problems;
}
