import type { PolicyMap } from "@taskdesk/permissions";
import { importReconciliationPolicies } from "./reconciliation/policy";

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
  // P6 import engine (engine/routes.ts): same instance-admin authority; services re-check reach.
  "POST /api/import-sources": instanceAdmin,
  "GET /api/import-sources": instanceAdmin,
  "POST /api/import-sources/{id}/runs": instanceAdmin,
  "GET /api/imports/{id}/engine": instanceAdmin,
  "POST /api/imports/{id}/discover": instanceAdmin,
  "GET /api/imports/{id}/mapping": instanceAdmin,
  "POST /api/imports/{id}/mapping": instanceAdmin,
  "POST /api/imports/{id}/dry-run-all": instanceAdmin,
  "GET /api/imports/{id}/dry-run-all": instanceAdmin,
  "POST /api/imports/{id}/execute": instanceAdmin,
  "POST /api/imports/{id}/pause": instanceAdmin,
  "POST /api/imports/{id}/resume": instanceAdmin,
  "GET /api/imports/{id}/losses": instanceAdmin,
  ...importReconciliationPolicies,
} as const satisfies PolicyMap;
