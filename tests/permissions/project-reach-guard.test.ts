import { isCapabilityPolicy, normaliseRouteKey } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import { requireAssetProjectReach } from "../../apps/api/src/utils/authorize-asset-access";
import {
  requireBodyTaskReach,
  requireLabelRowTaskReach,
} from "../../apps/api/src/utils/task-target-reach";
import {
  PROJECT_READ_ROUTE_KEYS,
  PROJECT_SOCKET_ROUTE_KEYS,
  PROJECT_WRITE_ROUTE_KEYS,
  TASK_TARGET_ROUTE_KEYS,
} from "../api-integration/helpers/project-reach-route-keys";
import { loadApiApp, loadPolicyRegistry } from "./api-app";
import {
  findCoverageProblems,
  findReachProblems,
  type Handler,
  handlerWith,
  markOf,
} from "./reach-guard-lib";

/**
 * Structural guard for the project-scoped routes (#720, extending the work-item guard of #712).
 *
 * Three families are checked against the REAL router and the REAL policy registry:
 *
 *  1. every `reach: "required"` policy on the `project` scope (a route that acts on one
 *     project, directly or through a child row: milestones, stakeholders, columns, workflow
 *     rules, project create-into routes) must carry a middleware that resolves PROJECT reach,
 *     or a reasoned opt-out;
 *  2. every route that acts on a specific task, or on an asset's own project, but whose policy
 *     stays workspace-scoped (labels bound to a task, the asset download, the legacy bulk
 *     update) must carry project reach through its own middleware;
 *  3. every route in either set must appear in a behavioural integration table, because a mark
 *     is self-attested and proves declaration, not enforcement.
 *
 * A new project-scoped route that forgets the middleware, opts out silently, or has no
 * behavioural row fails here instead of shipping with the weaker workspace-membership gate the
 * defect class closed by #712 and #720 describes.
 */

/** Project-scoped routes whose reach is decided by another mechanism. Each needs a reason. */
const PROJECT_REACH_EXEMPT: Readonly<Record<string, string>> = {};

/** Resource kinds whose lookup means the route acts on a project, or on a row inside one. */
const PROJECT_BEARING_RESOURCES = [
  "project",
  "task",
  "timeEntry",
  "activity",
  "comment",
  "column",
  "workflowRule",
] as const;

/**
 * Routes that resolve a project-bearing row but legitimately decide reach by another means.
 * Each needs a reason; a stale entry also fails.
 */
const PROJECT_LOOKUP_WITHOUT_PROJECT_REACH: Readonly<Record<string, string>> =
  {};

/** Pure, so the negative cases below can prove the derived check is not vacuous. */
function findDerivedProjectLookupProblems(
  routes: ReadonlyMap<string, readonly Handler[]>,
  exempt: Readonly<Record<string, string>>,
): string[] {
  const problems: string[] = [];
  for (const [routeKey, handlers] of routes) {
    const marks = handlers
      .map(markOf)
      .filter((mark): mark is NonNullable<typeof mark> => mark !== undefined);
    const resolves = marks.some((mark) =>
      (mark.resources ?? []).some((resource) =>
        (PROJECT_BEARING_RESOURCES as readonly string[]).includes(resource),
      ),
    );
    if (!resolves) continue;
    const sound = marks.some((mark) => mark.projectReach);
    const reason = exempt[routeKey];
    if (!sound && (reason === undefined || reason.trim() === "")) {
      problems.push(
        `${routeKey}: resolves a project-bearing row without project reach`,
      );
    }
    if (sound && reason !== undefined) {
      problems.push(`${routeKey}: exempted but carries project reach`);
    }
  }
  for (const key of Object.keys(exempt)) {
    if (!routes.has(key)) problems.push(`${key}: stale exemption`);
  }
  return problems;
}

describe("project reach guard: the checker is not vacuous", () => {
  it("the derived check flags a project-bearing lookup with no project reach", () => {
    const key = "POST /api/thing/{id}";
    const bare = new Map([
      [key, [handlerWith({ projectReach: false, resources: ["task"] })]],
    ]);
    expect(findDerivedProjectLookupProblems(bare, {})).toHaveLength(1);
    const reached = new Map([
      [key, [handlerWith({ projectReach: true, resources: ["task"] })]],
    ]);
    expect(findDerivedProjectLookupProblems(reached, {})).toEqual([]);
    // A workspace-level lookup (a label definition) is not project-bearing.
    const workspaceLevel = new Map([
      [key, [handlerWith({ projectReach: false, resources: ["label"] })]],
    ]);
    expect(findDerivedProjectLookupProblems(workspaceLevel, {})).toEqual([]);
    expect(findDerivedProjectLookupProblems(bare, { [key]: "why" })).toEqual(
      [],
    );
    expect(
      findDerivedProjectLookupProblems(reached, { [key]: "why" }),
    ).toHaveLength(1);
    expect(
      findDerivedProjectLookupProblems(bare, { "GET /gone": "why" }),
    ).toHaveLength(2);
  });

  const key = "PUT /api/project/{id}";

  it("flags a route with no reach middleware", () => {
    const routes = new Map([[key, [handlerWith()]]]);
    expect(findReachProblems(routes, [key], {})).toHaveLength(1);
  });

  it("flags a bare workspace-membership middleware (the exact defect), and accepts project reach", () => {
    const bare = new Map([[key, [handlerWith({ projectReach: false })]]]);
    expect(findReachProblems(bare, [key], {})).toHaveLength(1);
    const reached = new Map([[key, [handlerWith({ projectReach: true })]]]);
    expect(findReachProblems(reached, [key], {})).toEqual([]);
  });

  it("accepts a route when any one of its middlewares resolves project reach", () => {
    const routes = new Map([
      [
        key,
        [
          handlerWith({ projectReach: false }),
          handlerWith({ projectReach: true }),
        ],
      ],
    ]);
    expect(findReachProblems(routes, [key], {})).toEqual([]);
  });

  it("accepts a reasoned opt-out and rejects an unreasoned one", () => {
    const reasoned = new Map([
      [
        key,
        [handlerWith({ projectReach: false, workspaceReachOnlyReason: "why" })],
      ],
    ]);
    expect(findReachProblems(reasoned, [key], {})).toEqual([]);
    const blank = new Map([
      [
        key,
        [handlerWith({ projectReach: false, workspaceReachOnlyReason: " " })],
      ],
    ]);
    expect(findReachProblems(blank, [key], {})).toHaveLength(1);
  });

  it("flags stale and contradictory exemptions, and accepts a reasoned one", () => {
    const none = new Map([[key, [handlerWith()]]]);
    expect(
      findReachProblems(none, [key], { [key]: "decided elsewhere" }),
    ).toEqual([]);
    expect(findReachProblems(none, [key], { [key]: " " })).toHaveLength(1);
    const reached = new Map([[key, [handlerWith({ projectReach: true })]]]);
    expect(findReachProblems(reached, [key], { [key]: "why" })).toHaveLength(1);
    expect(findReachProblems(none, [key], { "GET /gone": "why" })).toHaveLength(
      2,
    );
  });

  it("flags a marked route with no behavioural row, and a stale row", () => {
    expect(findCoverageProblems([key], new Set(), {})).toHaveLength(1);
    expect(findCoverageProblems([key], new Set([key]), {})).toEqual([]);
    expect(
      findCoverageProblems([key], new Set([key, "GET /gone"]), {}),
    ).toHaveLength(1);
    expect(findCoverageProblems([key], new Set(), { [key]: "why" })).toEqual(
      [],
    );
  });

  it("the task-target middleware factories carry a project-reach mark", () => {
    for (const middleware of [
      requireBodyTaskReach(),
      requireLabelRowTaskReach(),
      requireAssetProjectReach,
    ]) {
      expect(markOf(middleware as unknown as Handler)).toEqual({
        projectReach: true,
      });
    }
  });
});

describe("project reach guard: the real router", () => {
  it("every project-scoped route resolves project reach and has a behavioural row", async () => {
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

    const projectRouteKeys = registry.entries
      .filter(
        (entry) =>
          isCapabilityPolicy(entry.policy) &&
          entry.policy.scope === "project" &&
          entry.policy.reach === "required",
      )
      .map((entry) => entry.routeKey);

    // Non-vacuous: the routes this guard exists for are in the set.
    expect(projectRouteKeys.length).toBeGreaterThanOrEqual(38);
    for (const required of [
      "PUT /api/project/{id}",
      "PUT /api/project/{id}/archive",
      "POST /api/project/{id}/milestones",
      "POST /api/project/{id}/stakeholders",
      "POST /api/projects/{projectId}/work-items",
      "POST /api/task/{projectId}",
      "POST /api/column/{projectId}",
      "PUT /api/column/{id}",
      "PUT /api/workflow-rule/{projectId}",
      "DELETE /api/workflow-rule/{id}",
    ]) {
      expect(projectRouteKeys).toContain(required);
    }

    expect(
      findReachProblems(handlersByKey, projectRouteKeys, PROJECT_REACH_EXEMPT),
    ).toEqual([]);
    expect(
      findCoverageProblems(
        projectRouteKeys,
        new Set<string>([
          ...PROJECT_WRITE_ROUTE_KEYS,
          ...PROJECT_READ_ROUTE_KEYS,
        ]),
        PROJECT_REACH_EXEMPT,
      ),
    ).toEqual([]);

    // Derived check: ANY route whose middleware resolves a project, task, column, time entry
    // or workflow rule from the request must carry project reach (or be listed with a reason),
    // whatever scope its policy declares. This is what catches a new route that reaches a
    // project through `workspaceAccess.fromTask()` and forgets `requireProjectReach`.
    expect(
      findDerivedProjectLookupProblems(
        handlersByKey,
        PROJECT_LOOKUP_WITHOUT_PROJECT_REACH,
      ),
    ).toEqual([]);
    // Non-vacuous: the derivation really sees a large set of project-bearing lookups.
    const projectBearing = [...handlersByKey.values()].filter((handlers) =>
      handlers
        .map(markOf)
        .some((mark) =>
          (mark?.resources ?? []).some((resource) =>
            (PROJECT_BEARING_RESOURCES as readonly string[]).includes(resource),
          ),
        ),
    );
    expect(projectBearing.length).toBeGreaterThanOrEqual(60);

    // Family 3 (#745): the project WebSocket upgrade. Its policy is `delegated: "websocket"`,
    // so the capability-policy derivation above cannot see it; the upgrade handler must carry
    // the project-reach mark itself, and `ws-project-reach.test.ts` drives it behaviourally.
    for (const key of PROJECT_SOCKET_ROUTE_KEYS) {
      expect(
        registry.entries.some((entry) => entry.routeKey === key),
        `${key} is not a registered route`,
      ).toBe(true);
      expect(
        (handlersByKey.get(key) ?? []).map(markOf),
        `${key} must declare project reach`,
      ).toContainEqual(expect.objectContaining({ projectReach: true }));
    }
    expect(
      findReachProblems(handlersByKey, [...PROJECT_SOCKET_ROUTE_KEYS], {}),
    ).toEqual([]);

    // Family 2: task-targeting routes whose policy stays workspace-scoped / list-addressed.
    for (const key of TASK_TARGET_ROUTE_KEYS) {
      expect(
        registry.entries.some((entry) => entry.routeKey === key),
        `${key} is not a registered route`,
      ).toBe(true);
    }
    expect(
      findReachProblems(handlersByKey, [...TASK_TARGET_ROUTE_KEYS], {}),
    ).toEqual([]);
  });
});
