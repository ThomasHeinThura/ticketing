import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Project route policies.
 *
 * **Partial by design.** The rest of the inherited project surface is classified by #8, once
 * #6's removals have settled — classifying a route that is about to be deleted or renamed is
 * wasted review and a false sense of coverage. Everything still awaiting a verdict is listed
 * in `tests/permissions/inherited-uncovered.json`.
 */
export const projectPolicies = {
  // Reading one project. The scope is the project itself: reach decides whether this identity
  // can see it at all (404 if not), and authority decides whether they may read it (403).
  "GET /api/project/{id}": {
    capability: "project:read",
    scope: "project",
    reach: "required",
  },
} as const satisfies PolicyMap;
