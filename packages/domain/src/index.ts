/**
 * `@taskdesk/domain` — pure business rules. No I/O, no database import, no ambient
 * clock read; see `docs/01-architecture/monorepo-layout.md` § Package boundaries.
 *
 * The service-calendars (#33), workflow-transitions (#31), audit-trail (#37) and SLA
 * computation slices exist so far. Request types, intake, approvals and the assignment
 * rule engine each land in their own follow-on pull request, per the P2 plan
 * (`docs/07-planning/reviews/2026-09-05/` prep) — this barrel only re-exports what is
 * actually implemented, never a typed stub for a module that does not exist yet.
 */

// #30's assign action consumes these two rules; named (not a star export) so a future
// assignment/types star-export cannot make a colliding name ambiguous package-wide.
export {
  evaluateAssigneeEligibility,
  planAssignment,
} from "./assignment/assignment.js";
export * from "./audit/audit.js";
export * from "./audit/types.js";
export * from "./calendar/calendar.js";
export * from "./calendar/types.js";
export * from "./sla/policy.js";
export * from "./sla/sla.js";
export * from "./sla/types.js";
export * from "./workflow/types.js";
export * from "./workflow/workflow.js";
