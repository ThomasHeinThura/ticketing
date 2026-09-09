/**
 * `@taskdesk/domain` — pure business rules. No I/O, no database import, no ambient
 * clock read; see `docs/01-architecture/monorepo-layout.md` § Package boundaries.
 *
 * The service-calendars (#33) and workflow-transitions (#31) slices exist so far. SLA,
 * request types, intake, approvals, audit trail and the assignment rule engine each
 * land in their own follow-on pull request, per the P2 plan
 * (`docs/07-planning/reviews/2026-09-05/` prep) — this barrel only re-exports what is
 * actually implemented, never a typed stub for a module that does not exist yet.
 */

export * from "./calendar/calendar.js";
export * from "./calendar/types.js";
export * from "./workflow/types.js";
export * from "./workflow/workflow.js";
