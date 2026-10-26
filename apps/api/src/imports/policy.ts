import type { PolicyMap } from "@taskdesk/permissions";

/** Import authority is instance-wide; services additionally enforce live project reach. */
const instanceAdmin = {
  capability: "instance:admin",
  scope: "instance",
  scopeSource: "instance",
  elevated: false,
  elevationExemptionReason:
    "The retained import API uses existing administrator and destination capabilities without changing authority or credentials. Batches above 50 require owner approval with exact count and fresh step-up through pending actions.",
  reach: {
    exempt: "no_single_resource",
    reason:
      "import history is instance administered; services enforce destination project reach",
  },
} as const;

export const importPolicies = {
  "GET /api/imports": instanceAdmin,
  "POST /api/imports": instanceAdmin,
  "GET /api/imports/{id}": instanceAdmin,
  "GET /api/imports/{id}/report": instanceAdmin,
  "POST /api/imports/{id}/dry-run": instanceAdmin,
  "POST /api/imports/{id}/records": instanceAdmin,
  "POST /api/imports/{id}/links": instanceAdmin,
  "GET /api/imports/{id}/links": instanceAdmin,
} as const satisfies PolicyMap;
