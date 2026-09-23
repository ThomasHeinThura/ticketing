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

export * from "./audit/audit.js";
export * from "./audit/types.js";
export * from "./calendar/calendar.js";
export * from "./calendar/types.js";
export * from "./intake/request-type.js";
export * from "./intake/submission.js";
export * from "./intake/types.js";
export * from "./sla/policy.js";
export * from "./sla/sla.js";
export * from "./sla/types.js";
export * from "./workflow/types.js";
export * from "./workflow/workflow.js";
