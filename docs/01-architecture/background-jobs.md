# Background jobs

No separate worker service. Jobs run **in-process** in the API, scheduled with `croner`,
made replica-safe by a lease table.

## Why in-process

v1 ran a Go worker whose entire job was polling the API and computing snapshots. It cost
a language, a deployment, a set of service-to-service credentials, and a second place for
bugs to hide. kaneo already ships `croner` plus a `job_lease` table, which is all that is
actually needed at this scale.

The trade is real and accepted: a long job competes with request handling for the event
loop. Mitigations — jobs are chunked, they yield between batches, and heavy aggregation
is pushed into SQL rather than JavaScript. If a job ever needs more than that, it is
evidence for a worker, and we will revisit with data rather than in advance.

## Leasing

```sql
job_lease ( name text pk, owner text, expires_at timestamptz )
```

```ts
const lease = await acquireLease('sla-scan', { ttlSeconds: 300 });
if (!lease) return;                 // another replica holds it
try { await run(); await lease.renew(); } finally { await lease.release(); }
```

- Acquire is a single `INSERT … ON CONFLICT … WHERE expires_at < now()` — atomic.
- Long jobs renew mid-flight so a crash releases within one TTL rather than blocking
  forever.
- Every job is written to be **idempotent**, because at-least-once is the only guarantee
  a lease gives you.

## The jobs

| Name | Cadence | Lease TTL | What it does |
| --- | --- | --- | --- |
| `sla-scan` | 5 min | 5 min | Recomputes SLA state for open work items; emits `sla.at_risk` / `sla.breached` on transition |
| `reminder-scan` | 15 min | 5 min | Due-date reminders, overdue prerequisites, expiring approvals |
| `outbox-drain` | 30 s | 2 min | Delivers webhooks and external notifications with retry/backoff |
| `notification-digest` | hourly | 5 min | Batches low-priority notifications into digest emails |
| `metrics-snapshot` | hourly | 15 min | Precomputes report aggregates into `metric_snapshot` |
| `search-reindex` | 10 min | 10 min | Catches up any rows whose search vector is stale |
| `audit-purge` | daily 03:00 | 30 min | Deletes audit rows past retention; writes its own audit row |
| `session-cleanup` | daily 03:15 | 5 min | Removes expired sessions, invitations, idempotency keys |
| `attachment-gc` | daily 03:30 | 30 min | Deletes orphaned objects from storage |
| `import-run` | on demand | 1 h | Executes a queued import, chunked and resumable |
| `plugin-health` | 10 min | 2 min | Pings configured plugins; surfaces failures in God Mode |

All cadences are configurable in God Mode. A job can be disabled, and a job can be
triggered manually from God Mode for debugging.

## SLA scanning, and why it is cheap

SLA **state is not stored**. It is computed from `created_at + goal.target_minutes`
evaluated against the service calendar, minus paused intervals. So `sla-scan` is not
maintaining timers — it only needs to detect *transitions* in order to fire events.

```sql
-- narrow the candidate set in SQL before touching JavaScript
select id, key, created_at, priority, type_id, project_id
from work_item
where resolved_at is null
  and archived_at is null
  and project_id in (select id from project where sla_policy_id is not null)
```

For each candidate, the pure `computeSlaState()` function from `packages/domain` runs.
Only work items whose state *changed since the last scan* emit an event; the last known
state is kept in `work_item_sla_cache` purely to detect edges.

Consequences: changing an SLA policy needs no backfill, a missed scan causes a delayed
notification rather than wrong data, and the whole thing is a pure function that can be
unit-tested exhaustively.

## Outbox delivery

Webhooks and external notifications are **not** fire-and-forget. v1's were, and failures
were invisible.

```
mutation transaction
  ├── write the domain change
  └── write outbox row (pending)        ← same transaction, so never lost
                    ↓
outbox-drain (every 30 s)
  ├── claim a batch: SELECT … FOR UPDATE SKIP LOCKED
  ├── deliver
  ├── success → mark delivered, record duration
  └── failure → attempts++, next_attempt_at = now + backoff
                after 6 attempts → dead, surfaced in God Mode
```

Backoff: 30 s, 2 m, 10 m, 1 h, 6 h, 24 h. Delivery outcomes are recorded in
`webhook_delivery` and visible per webhook in settings, so an administrator can see that
their endpoint has been returning 500 for two days.

`SKIP LOCKED` means multiple replicas can drain concurrently without the lease, which is
why `outbox-drain` is safe to run everywhere.

## Metrics snapshots

Reports over months of history are too slow to compute per request. `metrics-snapshot`
writes hourly aggregates into `metric_snapshot` (dimension keys + measures), and reports
read snapshots for closed periods and compute live only for the current partial hour.

## Import runs

Long, chunked, resumable, and driven from the UI rather than the shell.

```
queued → running → (paused) → completed | failed
```

Each chunk commits its own transaction and writes `import_mapping` rows, so a failure
resumes from the last committed chunk and a re-run never duplicates. Progress is
broadcast on the `instance` WebSocket topic so the God Mode screen shows a live count.

## Observability

Every run emits:

- A structured log line: job name, duration, items processed, outcome.
- Prometheus metrics: `taskdesk_job_duration_seconds`, `taskdesk_job_runs_total{outcome}`,
  `taskdesk_job_last_success_timestamp`, `taskdesk_outbox_pending`.
- An OpenTelemetry span, when tracing is configured.

Alert conditions worth having from day one:

| Condition | Meaning |
| --- | --- |
| `job_last_success_timestamp` older than 3× cadence | The job is stuck or the lease is wedged |
| `outbox_pending` rising for 15 minutes | Deliveries are failing |
| Any job failing three consecutive runs | Page someone |

## Writing a new job

1. Add a file under `apps/api/src/jobs/`.
2. Export `{ name, schedule, leaseTtl, handler }`.
3. Make the handler **idempotent**. Assume it will run twice.
4. Chunk anything unbounded, and `await` between chunks so the event loop breathes.
5. Register in `jobs/index.ts`.
6. Add a unit test for the handler and an integration test for the leasing behaviour.
7. Document it in the table above.

## Related

- [Architecture overview](overview.md) · [Realtime](realtime.md)
- [SLA](../03-features/sla.md) · [Observability](observability.md)
