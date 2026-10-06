/**
 * `@taskdesk/domain` — pure business rules. No I/O, no database import, no ambient
 * clock read; see `docs/01-architecture/monorepo-layout.md` § Package boundaries.
 *
 * The service-calendars (#33), workflow-transitions (#31), audit-trail (#37), SLA
 * computation, hierarchy (#26), request types, intake and approvals (#36) slices exist so
 * far. This barrel only re-exports implemented modules, never a typed stub.
 */

export * from "./approvals/approvals.js";
export * from "./approvals/types.js";
// #30's assign action consumes these two rules; named (not a star export) so a future
// assignment/types star-export cannot make a colliding name ambiguous package-wide.
export {
  evaluateAssigneeEligibility,
  planAssignment,
} from "./assignment/assignment.js";
export * from "./audit/audit.js";
export * from "./audit/types.js";
export * from "./calendar/calendar.js";
export * from "./calendar/holiday-import.js";
export * from "./calendar/types.js";
export * from "./hierarchy/hierarchy.js";
export * from "./hierarchy/types.js";
export * from "./identity/claim-mapping.js";
export * from "./identity/identity.js";
export * from "./identity/jit-policy.js";
export * from "./identity/membership-projection.js";
export * from "./identity/portal.js";
export * from "./identity/profile-mapping.js";
export * from "./identity/scim-admin.js";
export * from "./identity/scim-match-attributes.js";
export * from "./identity/types.js";
export * from "./intake/duplicate.js";
export * from "./intake/request-type.js";
export * from "./intake/submission.js";
export * from "./intake/types.js";
export * from "./sla/policy.js";
export * from "./sla/scan.js";
export * from "./sla/sla.js";
export * from "./sla/types.js";
export * from "./workflow/types.js";
export * from "./workflow/workflow.js";
