# 0009 — SLA computed on read, never stored

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

## Context

An SLA answers: given this work item, its request type, its priority and its project's
service calendar, when is the deadline, and are we `ok`, `at-risk`, `breached`, `met` or
`missed`?

The obvious implementation stores a `sla_due_at` timestamp on the work item when it is
created, and a scheduled job flips a `sla_state` column as deadlines pass. Most ticketing
systems do this.

v1 did **not**. It computed SLA state lazily on read, from
`created_at + policy target` evaluated against the service calendar. This turned out to be
one of v1's better decisions and is worth preserving deliberately rather than by accident.

## Decision

**SLA state is a pure function of stored facts, computed on read. No `sla_due_at` column.
No `sla_state` column.**

```ts
computeSlaState({
  createdAt, resolvedAt, priority, workItemTypeId,
  policy,          // the version effective at createdAt
  calendar,        // windows + holidays + timezone
  pauses,          // [{ startedAt, endedAt }]
  now,
}): { dueAt, consumedMinutes, remainingMinutes, state }
```

- Lives in `packages/domain/src/sla/`. Pure, no I/O, exhaustively unit-tested.
- All durations are in **covered minutes** — time inside the service calendar's windows,
  excluding holidays and excluding paused intervals. Never wall-clock.
- The policy **version effective at creation** is used, so changing a policy does not
  retroactively rewrite whether past tickets were met.
- The only persisted SLA artefact is `work_item_sla_cache`, holding the *last observed
  state*, used solely by `sla-scan` to detect an edge and fire an event once. It is a
  denormalisation for notification purposes and is never read to answer "what is the SLA
  state?".

## Consequences

### Positive

- **Changing a policy or a calendar requires no backfill.** Every open item is instantly
  evaluated against the new configuration. A stored-deadline design would need a migration
  job touching every open row, and would get it wrong for items straddling the change.
- **Nothing can drift.** There is no timer to miss, no state column to become
  inconsistent with reality after a restore, a clock change or a daylight-saving
  transition.
- **A missed scan delays a notification, not the truth.** If `sla-scan` does not run for
  an hour, the UI still shows correct SLA state; only the breach email is late. In a
  stored-state design, a missed scan means the data is wrong.
- **Exhaustively testable.** A pure function over plain data can be tested across
  timezones, DST boundaries, holidays, pauses and policy versions without a database.
- **The same function serves the API, the UI, reports and the scan job.** One
  implementation, one behaviour. v1 had two — C# and Go — and they could disagree.
- Pausing ("waiting on customer") is trivially expressible as an interval to subtract,
  rather than as a stored-deadline adjustment that must be recomputed.

### Negative

- **You cannot `ORDER BY sla_state` or `WHERE sla_due_at < now()` in SQL.** This is the
  real cost. Filtering and sorting a large list by SLA state requires either computing in
  application code over a candidate set, or maintaining a denormalised column.

  Mitigation: `work_item_sla_cache` is maintained by `sla-scan` **for query purposes
  only**, refreshed every five minutes, and clearly documented as eventually consistent.
  Lists that filter by SLA use it; the work item detail view and the API always compute
  fresh. Where the two disagree, the computed value wins.

- **Computation cost on large lists.** Rendering 200 work items means 200 calendar
  evaluations. Mitigated by memoising calendar window expansion per calendar per day and
  by the function being genuinely cheap — arithmetic over a small window array.

- **Historical reporting needs care.** "What was our SLA attainment in March?" must
  evaluate each item against the policy version effective at its creation, not today's.
  The design supports this correctly; the reporting queries must remember to.

### Neutral

- Reports over closed periods read `metric_snapshot` aggregates rather than recomputing,
  so the per-item cost does not appear in dashboards.

## Alternatives considered

**Store `sla_due_at` at creation, flip `sla_state` in a job.** Rejected. Every policy or
calendar change needs a backfill; a missed job makes the data wrong rather than merely
late; DST and holiday changes silently corrupt stored deadlines; and it invites two
implementations to drift apart.

**Store `sla_due_at` but recompute `sla_state` on read.** Rejected as the worst of both:
still needs backfill when a policy changes, still has a stored value that can be wrong.

**A Postgres generated column.** Rejected. Service calendar evaluation — weekday windows,
holidays, timezone, pauses — is not expressible in a generated column without a large,
untestable PL/pgSQL function, which is exactly the code we want in TypeScript where it can
be unit-tested.

**A materialised view refreshed periodically.** Rejected. This is `work_item_sla_cache`
with more machinery and less control over refresh granularity.

## Related

- [SLA feature](../../03-features/sla.md) · [Service calendars](../../03-features/service-calendars.md)
- [Background jobs](../background-jobs.md)
- [ADR 0002 — single backend](0002-single-backend.md)
