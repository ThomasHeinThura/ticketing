# 0007 — In-process scheduled jobs, no worker service

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

## Context

v1 ran a Go worker whose responsibilities were: scanning for SLA breaches every five
minutes, computing overview snapshots, caching results in Valkey and publishing events to
a pub/sub channel that the BFF fanned out to browsers.

It cost a third language, a third deployment artefact, a third set of credentials, and —
because it was in a different language from the system of record — it **polled its own
API over HTTP** rather than reading the database.

kaneo's API already ships `croner` for cron-expression scheduling and a `job_lease` table
providing a distributed lock, which is precisely the mechanism a worker needs to avoid
duplicate execution across replicas.

## Decision

**Background work runs in the API process, scheduled by `croner`, made replica-safe by the
`job_lease` table.**

- Jobs live in `apps/api/src/jobs/`, each exporting
  `{ name, schedule, leaseTtl, handler }`.
- Before running, a job acquires a lease with a single atomic
  `INSERT … ON CONFLICT … WHERE expires_at < now()`. Long jobs renew mid-flight so a crash
  frees the lease within one TTL.
- **Every handler must be idempotent.** A lease gives at-least-once, never exactly-once.
- Unbounded work is chunked, with an `await` between chunks so the event loop is not
  starved.
- Aggregation is pushed into SQL rather than JavaScript wherever possible.
- Outbox draining is the exception that needs no lease: it claims rows with
  `SELECT … FOR UPDATE SKIP LOCKED`, so every replica can drain concurrently.

## Consequences

### Positive

- **One less language, one less deployment, one less credential.**
- Jobs **read the database directly** instead of polling an HTTP API — simpler, faster,
  and no service-to-service authentication.
- Jobs share the domain layer, so SLA computation in a job and SLA computation in a
  request are literally the same pure function. In v1 they were two implementations in two
  languages, which is a class of bug we have now eliminated.
- Leasing gives horizontal scaling for free: run three replicas, each job still runs once.
- Job failures appear in the same logs, metrics and traces as requests.

### Negative

- **Jobs and requests share an event loop.** A poorly written job adds latency to user
  requests. This is the real cost and it is accepted. Mitigations: chunking, yielding,
  SQL-side aggregation, and a `taskdesk_nodejs_eventloop_lag_seconds` metric with an alert.
- **No process isolation.** A crash in job code takes the API with it. Mitigated by
  supervision and by leases expiring.
- **No independent scaling.** If job volume grows out of proportion to request volume, we
  scale both together, which is wasteful.
- **At-least-once means idempotency is a permanent obligation** on every job author. This
  is easy to get wrong and needs to be a review checklist item.

### Neutral

- Extraction remains cheap. A well-factored `jobs/` directory whose handlers depend only
  on the domain and repository layers can be lifted into a separate process later. We are
  declining to pay for isolation we do not currently need, not making it impossible.

## Alternatives considered

**Keep a separate worker service (v1's approach).** Rejected. Its entire function is
covered by `croner` plus `job_lease` in perhaps 800 lines, and keeping it means keeping a
second language and deployment for that.

**A job queue library — BullMQ, pg-boss.** Rejected for now, but deliberately kept in
reach. They add real capability — priorities, delayed jobs, per-job retry, a dashboard —
at the cost of another dependency and, for BullMQ, a hard Redis requirement. Our current
needs are a handful of cron jobs plus one outbox drain, and `SKIP LOCKED` handles the
outbox well. **Revisit if** we need per-job retry semantics beyond the outbox, user-
triggered long-running jobs beyond imports, or job priorities.

**A managed scheduler — Kubernetes CronJobs, systemd timers.** Rejected. It puts scheduling
outside the application, so a job cannot be enabled, disabled or triggered from God Mode,
and it ties the application to a specific orchestrator.

**Event-driven with a real broker (Kafka, RabbitMQ).** Rejected as vastly disproportionate.
The Postgres outbox plus Valkey pub/sub covers our fan-out needs at our scale.

## Related

- [Background jobs](../background-jobs.md)
- [ADR 0002 — single backend](0002-single-backend.md)
- [ADR 0009 — lazy SLA evaluation](0009-lazy-sla-evaluation.md)
