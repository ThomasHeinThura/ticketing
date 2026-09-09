/**
 * `@taskdesk/domain` — pure business rules. No I/O, no database import, no ambient
 * clock read; see `docs/01-architecture/monorepo-layout.md` § Package boundaries.
 *
 * Only the service-calendars slice (issue #33) exists so far. Workflow, SLA, request
 * types, intake, approvals, audit trail and the assignment rule engine each land in
 * their own follow-on pull request, per the P2 plan
 * (`docs/07-planning/reviews/2026-09-05/` prep) — this barrel only re-exports what is
 * actually implemented, never a typed stub for a module that does not exist yet.
 */

export * from "./calendar/calendar.js";
export * from "./calendar/types.js";
