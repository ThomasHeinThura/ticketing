import { isCapabilityPolicy, normaliseRouteKey } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import { requireAssetProjectReach } from "../../apps/api/src/utils/authorize-asset-access";
import {
  requireReachContext,
  requireReachFilteredList,
} from "../../apps/api/src/utils/reach-filtered-list";
import {
  requireBodyTaskReach,
  requireLabelRowTaskReach,
} from "../../apps/api/src/utils/task-target-reach";
import {
  PROJECT_BODY_TARGET_ROUTE_KEYS,
  PROJECT_LIST_ROUTE_KEYS,
  PROJECT_READ_ROUTE_KEYS,
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

/**
 * Workspace-level collection routes (a GET whose only path parameter is `workspaceId`) that do
 * NOT return project-bearing rows, each with the reason. Every other such route must declare
 * `requireReachFilteredList` (#740): a list or search that returns rows from more than one
 * project must restrict them to the caller's reachable projects, not to workspace membership.
 * A stale entry, or one that also carries the declaration, fails.
 */
const LIST_REACH_EXEMPT: Readonly<Record<string, string>> = {
  "GET /api/canned-responses":
    "workspace-level reply templates; no project, task or work-item rows",
  "GET /api/project/organisations":
    "customer organisations (project:create picker); organisation rows, not project rows",
  "GET /api/request-types":
    "intake request-type definitions; configuration rows. They expose a default project id only, behind request_type:read",
  "GET /api/service-calendars":
    "SLA calendar definitions; configuration rows, not project rows",
  "GET /api/sla-policies":
    "SLA policy definitions; configuration rows, not project rows",
  "GET /api/submissions":
    "the intake queue, gated by intake:triage; rows carry the reference, form summary, state, claim, request type, requester and organisation, with no work item or project id, name, key or title (verified in #742 review)",
  "GET /api/views/team-audiences":
    "teams the caller belongs to; team rows, not project rows",
  "GET /api/workflows":
    "workflow definitions; configuration rows, not project rows",
  "GET /api/invitation/{id}": "a workspace invitation row; no project rows",
  "GET /api/request-types/{id}":
    "one request-type definition; configuration row with a default project id only",
  "GET /api/service-calendars/{id}":
    "one calendar definition; configuration row",
  "GET /api/service-calendars/{id}/preview":
    "computes calendar dates from the calendar's own configuration; no project rows",
  "GET /api/service-calendars/{id}/usage":
    "aggregate reference counts for deletion safety (sla_policy:read); no project or work item ids, names or titles",
  "GET /api/sla-policies/{id}": "one SLA policy definition; configuration row",
  "GET /api/submissions/{ref}":
    "one submission thread inside the intake queue; no project or work item fields, same row shape as the queue",
  "GET /api/submissions/{ref}/attachments":
    "the submission's own attachments; submissions are not project-bound until accepted",
  "GET /api/submissions/{ref}/attachments/{id}":
    "one attachment of the submission; not project-bound",
  "GET /api/views/{id}/count":
    "counts only the work items the caller reaches (the saved-view run applies per-row reach); returns a number, never a row",
  "GET /api/workflows/{id}": "one workflow definition; configuration row",
  "GET /api/workspace/{workspaceId}": "the workspace row itself",
  "GET /api/workspace/{workspaceId}/invitations":
    "workspace invitations; no project rows",
  "GET /api/workspace/{workspaceId}/members":
    "workspace members; no project rows",
  "GET /api/workspace/{workspaceId}/roles":
    "workspace role definitions; no project rows",
  "GET /api/workspace/{workspaceId}/work-item-types":
    "work-item type definitions; configuration rows, not project rows",
  "GET /api/workspaces/{workspaceId}/audit":
    "audit rows are filtered by project reach inside the audit reader (#319/#334)",
};

/** Pure, so the negative cases can prove the check is not vacuous. */
function findListReachProblems(
  routes: ReadonlyMap<string, readonly Handler[]>,
  candidateKeys: readonly string[],
  exempt: Readonly<Record<string, string>>,
): string[] {
  const problems: string[] = [];
  for (const key of candidateKeys) {
    const declared = (routes.get(key) ?? [])
      .map(markOf)
      .some((mark) => mark?.reachFilteredList === true || mark?.projectReach);
    const reason = exempt[key];
    const exempted = reason !== undefined && reason.trim() !== "";
    if (!declared && !exempted) {
      problems.push(
        `${key}: a workspace-level list/search with no reach-filtering declaration and no reasoned exemption`,
      );
    }
    if (declared && reason !== undefined) {
      problems.push(`${key}: exempted but declares reach filtering`);
    }
  }
  for (const key of Object.keys(exempt)) {
    if (!candidateKeys.includes(key)) {
      problems.push(`${key}: stale exemption`);
    }
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

  it("the list check flags an undeclared list, a contradictory exemption and a stale one", () => {
    const listKey = "GET /api/things";
    const bare = new Map([[listKey, [handlerWith({ projectReach: false })]]]);
    expect(findListReachProblems(bare, [listKey], {})).toHaveLength(1);
    expect(
      findListReachProblems(bare, [listKey], { [listKey]: " " }),
    ).toHaveLength(1);
    expect(
      findListReachProblems(bare, [listKey], { [listKey]: "no project rows" }),
    ).toEqual([]);
    const declared = new Map([
      [listKey, [handlerWith({ projectReach: true, reachFilteredList: true })]],
    ]);
    expect(findListReachProblems(declared, [listKey], {})).toEqual([]);
    expect(
      findListReachProblems(declared, [listKey], { [listKey]: "why" }),
    ).toHaveLength(1);
    // A single-row project-reach mark also satisfies the check; a bare workspace mark does not.
    const singleRow = new Map([
      [listKey, [handlerWith({ projectReach: true })]],
    ]);
    expect(findListReachProblems(singleRow, [listKey], {})).toEqual([]);
    expect(
      findListReachProblems(declared, [listKey], { "GET /gone": "why" }),
    ).toHaveLength(1);
  });

  it("the list and body-target middleware factories carry the marks the guard reads", () => {
    expect(markOf(requireReachFilteredList as unknown as Handler)).toEqual({
      projectReach: true,
      reachFilteredList: true,
    });
    expect(markOf(requireReachContext as unknown as Handler)).toEqual({
      projectReach: true,
    });
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

    // Family 3 (#741): writes whose target project is named in the body or chosen by the
    // handler, so the policy cannot declare it. Each must carry the reach context.
    for (const key of PROJECT_BODY_TARGET_ROUTE_KEYS) {
      expect(
        registry.entries.some((entry) => entry.routeKey === key),
        `${key} is not a registered route`,
      ).toBe(true);
    }
    expect(
      findReachProblems(handlersByKey, [...PROJECT_BODY_TARGET_ROUTE_KEYS], {}),
    ).toEqual([]);

    // Family 4 (#740): workspace-level LIST and SEARCH routes. The candidates are derived from
    // the real policy registry: EVERY GET on the workspace scope, whatever its path
    // parameters (so `/submissions/{ref}/duplicates` is seen, not just collections whose
    // only parameter is `workspaceId`). A NEW such route must declare reach filtering (or
    // single-row project reach) or give a reason.
    const listCandidates = registry.entries
      .filter(
        (entry) =>
          entry.routeKey.startsWith("GET ") &&
          isCapabilityPolicy(entry.policy) &&
          entry.policy.scope === "workspace",
      )
      .map((entry) => entry.routeKey);
    // Non-vacuous: the routes this family exists for are candidates, and are declared.
    for (const required of PROJECT_LIST_ROUTE_KEYS) {
      expect(listCandidates).toContain(required);
    }
    expect(listCandidates.length).toBeGreaterThanOrEqual(15);
    expect(
      findListReachProblems(handlersByKey, listCandidates, LIST_REACH_EXEMPT),
    ).toEqual([]);
    for (const key of PROJECT_LIST_ROUTE_KEYS) {
      expect(
        (handlersByKey.get(key) ?? [])
          .map(markOf)
          .some((mark) => mark?.reachFilteredList === true),
        `${key} must declare requireReachFilteredList`,
      ).toBe(true);
    }
  });
});
