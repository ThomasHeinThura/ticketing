import { isCapabilityPolicy, normaliseRouteKey } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import {
  requireWorkItemReach,
  WORK_ITEM_REACH_MARK,
  type WorkItemReachMark,
} from "../../apps/api/src/work-item/require-work-item-reach";
import { loadApiApp, loadPolicyRegistry } from "./api-app";

/**
 * Structural guard for the item-scoped work-item routes.
 *
 * Every `/api/work-items/{key}...` route whose policy is `reach: "required"` on the
 * `work_item` scope must be wired through `requireWorkItemReach()` in PROJECT-reach mode
 * (the default). Weaker workspace-only reach is possible only through an explicit opt-out
 * that names its reason. A new item-scoped route that forgets the middleware, or that opts
 * out silently, fails here instead of shipping with a weaker gate than its declared policy
 * and the permission matrix (the defect class tracked in #708).
 */

type Handler = (...args: never[]) => unknown;

function markOf(handler: Handler): WorkItemReachMark | undefined {
  return (handler as unknown as Record<symbol, WorkItemReachMark | undefined>)[
    WORK_ITEM_REACH_MARK
  ];
}

/**
 * `{key}` routes that deliberately do not use `requireWorkItemReach()`. Each needs a reason;
 * a stale entry (the route no longer exists, or now uses the middleware) also fails.
 */
const OTHER_REACH_MECHANISM: Readonly<Record<string, string>> = {
  "GET /api/work-items/{key}/approvals":
    "approval domain: row evidence via approvalWorkItemEvidence, decided by the approval handlers and strict policy enforcement; reviewed under the approval lane",
  "POST /api/work-items/{key}/approvals":
    "approval domain: row evidence via approvalWorkItemEvidence, decided by the approval handlers and strict policy enforcement; reviewed under the approval lane",
};

type ReachFinding = { readonly route: string; readonly problem: string };

/** Pure so the negative cases below can prove the guard is not vacuous. */
function findReachProblems(
  routes: ReadonlyMap<string, readonly Handler[]>,
  itemRouteKeys: readonly string[],
  exempt: Readonly<Record<string, string>>,
): ReachFinding[] {
  const findings: ReachFinding[] = [];
  for (const routeKey of itemRouteKeys) {
    const handlers = routes.get(routeKey) ?? [];
    const marks = handlers
      .map(markOf)
      .filter((m): m is WorkItemReachMark => m !== undefined);
    const exemption = exempt[routeKey];
    if (marks.length === 0) {
      if (exemption === undefined || exemption.trim() === "") {
        findings.push({
          route: routeKey,
          problem: "no requireWorkItemReach() and no reasoned exemption",
        });
      }
      continue;
    }
    if (exemption !== undefined) {
      findings.push({
        route: routeKey,
        problem: "exempted but uses requireWorkItemReach(): drop the exemption",
      });
    }
    for (const mark of marks) {
      if (
        !mark.projectReach &&
        (mark.workspaceReachOnlyReason === undefined ||
          mark.workspaceReachOnlyReason.trim() === "")
      ) {
        findings.push({
          route: routeKey,
          problem: "workspace-only reach without a stated reason",
        });
      }
    }
  }
  for (const key of Object.keys(exempt)) {
    if (!itemRouteKeys.includes(key)) {
      findings.push({ route: key, problem: "stale exemption: no such route" });
    }
  }
  return findings;
}

function handlerWith(mark?: WorkItemReachMark): Handler {
  const fn = (() => undefined) as unknown as Handler;
  if (mark) Object.assign(fn, { [WORK_ITEM_REACH_MARK]: mark });
  return fn;
}

describe("work-item reach guard: the checker is not vacuous", () => {
  const key = "PATCH /api/work-items/{key}";

  it("flags a route with no reach middleware", () => {
    const routes = new Map([[key, [handlerWith()]]]);
    expect(findReachProblems(routes, [key], {})).toHaveLength(1);
  });

  it("flags a workspace-only opt-out that gives no reason", () => {
    const routes = new Map([
      [
        key,
        [handlerWith({ projectReach: false, workspaceReachOnlyReason: " " })],
      ],
    ]);
    expect(findReachProblems(routes, [key], {})).toHaveLength(1);
    const noReason = new Map([[key, [handlerWith({ projectReach: false })]]]);
    expect(findReachProblems(noReason, [key], {})).toHaveLength(1);
  });

  it("accepts project reach and a reasoned opt-out", () => {
    const routes = new Map([[key, [handlerWith({ projectReach: true })]]]);
    expect(findReachProblems(routes, [key], {})).toEqual([]);
    const reasoned = new Map([
      [
        key,
        [
          handlerWith({
            projectReach: false,
            workspaceReachOnlyReason: "documented",
          }),
        ],
      ],
    ]);
    expect(findReachProblems(reasoned, [key], {})).toEqual([]);
  });

  it("flags stale and contradictory exemptions", () => {
    const routes = new Map([[key, [handlerWith({ projectReach: true })]]]);
    expect(findReachProblems(routes, [key], { [key]: "why" })).toHaveLength(1);
    expect(
      findReachProblems(routes, [key], { "GET /gone": "why" }),
    ).toHaveLength(1);
  });

  it("requireWorkItemReach() defaults to project reach and records its opt-out reason", () => {
    expect(markOf(requireWorkItemReach() as unknown as Handler)).toEqual({
      projectReach: true,
    });
    expect(
      markOf(
        requireWorkItemReach("key", {
          requireProjectReach: false,
          workspaceReachOnlyReason: "because",
        }) as unknown as Handler,
      ),
    ).toEqual({ projectReach: false, workspaceReachOnlyReason: "because" });
  });
});

describe("work-item reach guard: the real router", () => {
  it("every item-scoped route uses project reach, or states why not", async () => {
    const app = await loadApiApp();
    const registry = await loadPolicyRegistry();

    const handlersByKey = new Map<string, Handler[]>();
    for (const entry of app.routes) {
      let routeKey: string;
      try {
        routeKey = normaliseRouteKey(`${entry.method} ${entry.path}`);
      } catch {
        continue;
      }
      handlersByKey.set(routeKey, [
        ...(handlersByKey.get(routeKey) ?? []),
        entry.handler as Handler,
      ]);
    }

    const itemRouteKeys = registry.entries
      .filter(
        (entry) =>
          isCapabilityPolicy(entry.policy) &&
          entry.policy.scope === "work_item" &&
          entry.policy.reach === "required" &&
          entry.routeKey.includes("/api/work-items/{key}"),
      )
      .map((entry) => entry.routeKey);

    // Non-vacuous: the routes this guard exists for are in the set and carry the marker.
    expect(itemRouteKeys.length).toBeGreaterThanOrEqual(20);
    for (const required of [
      "PATCH /api/work-items/{key}",
      "POST /api/work-items/{key}/rank",
      "POST /api/work-items/{key}/transition",
      "POST /api/work-items/{key}/comments",
      "POST /api/work-items/{key}/attachments/presign",
    ]) {
      expect(itemRouteKeys).toContain(required);
    }

    expect(
      findReachProblems(handlersByKey, itemRouteKeys, OTHER_REACH_MECHANISM),
    ).toEqual([]);
  });
});
