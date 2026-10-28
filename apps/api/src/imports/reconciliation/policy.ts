import type { PolicyMap } from "@taskdesk/permissions";

/** Same authority as the rest of the import API: instance administrator; services re-check reach. */
const instanceAdmin = {
  capability: "instance:admin",
  scope: "instance",
  scopeSource: "instance",
  elevated: false,
  elevationExemptionReason:
    "Reconciliation only reads the run's own records and writes its own snapshot; it grants no authority and changes no source or target record.",
  reach: {
    exempt: "no_single_resource",
    reason:
      "import history is instance administered; services enforce destination project reach",
  },
} as const;

export const importReconciliationPolicies = {
  "GET /api/imports/{id}/reconciliation": instanceAdmin,
  "POST /api/imports/{id}/reconciliation": instanceAdmin,
} as const satisfies PolicyMap;
