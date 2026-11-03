import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Customer portal projects (S4c; `feature-contracts-p3.md` "Customer portal API"). Policy kind 3:
 * the caller is an active customer person and every row is read inside their own organisation
 * (`CP-1`); anything else is the constant 404 (`CP-2`). See `portal-projects.ts`.
 */
export const portalProjectPolicies = {
  "GET /api/portal/projects": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "GET /api/portal/projects/{key}": {
    portal: "customer",
    predicate: "own_organisation",
  },
} as const satisfies PolicyMap;
