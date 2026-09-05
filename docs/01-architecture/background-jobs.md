# Background jobs

No separate worker service. Jobs run **in-process** in the API, scheduled with `croner`,
made replica-safe by a lease table. **This document is the only list of jobs** — names are
identifiers (`job_lease.name`, Prometheus labels) and are not restated anywhere else.

## Why in-process

v1 ran a Go worker whose entire job was polling the API and computing snapshots. It cost
a language, a deployment, a set of service-to-service credentials, and a second place for
bugs to hide. kaneo already ships `croner`; the `job_lease` table is ours to write and is
small. That is all that is actually needed at this scale.

The trade is real and accepted: a long job competes with request handling for the event
loop. Mitigations — jobs are chunked, they yield between batches, and heavy aggregation
is pushed into SQL rather than JavaScript. `TASKDESK_ROLE=jobs` dedicates a replica to
the scheduler and `TASKDESK_ROLE=web` disables it ([configuration-reference.md](../05-operations/configuration-reference.md)),
so the escape hatch in [scaling.md](../05-operations/scaling.md) is real.

## Leasing

```sql
job_lease ( name text primary key, owner text not null, expires_at timestamptz not null )
```

`owner` is `${hostname}:${pid}:${bootId}` — unique per process lifetime.

```sql
-- acquire: succeeds only if no lease exists or the existing one has expired
insert into job_lease (name, owner, expires_at)
values ($1, $2, now() + $3::interval)
on conflict (name) do update
  set owner = excluded.owner, expires_at = excluded.expires_at
  where job_lease.expires_at < now()
returning owner;                       -- a row is returned ⇔ we hold the lease

-- heartbeat, every TTL/3 while the handler runs; the owner predicate is what makes it safe
update job_lease set expires_at = now() + $3::interval
  where name = $1 and owner = $2;      -- 0 rows ⇒ we lost the lease: stop, do not release

-- release, only our own
delete from job_lease where name = $1 and owner = $2;
```

```ts
const lease = await acquireLease('sla-scan', { ttl: '5 minutes' });
if (!lease) return;                                  // another replica holds it
const heartbeat = setInterval(() => lease.renew(), lease.ttlMs / 3);
try { await run(lease.signal); }                     // renew() aborts the signal if the lease is lost
finally { clearInterval(heartbeat); await lease.release(); }
```

- Acquire is a single atomic statement; holding the lease is decided by whether a row was
  **returned**, never by a separate read.
- Renewal runs **during** the work, on a timer, not after it. A handler that outlives its
  lease (a 4-hour import under a 1-hour TTL) is renewed continuously; a crashed one is
  released within one TTL.
- **A lease is an optimisation, not mutual exclusion.** An expired holder may still be
  running its last statement. Every handler is therefore **idempotent**, because
  at-least-once is the only guarantee a lease gives.

## The jobs

| Name | Cadence | Lease TTL | What it does |
| --- | --- | --- | --- |
| `sla-scan` | 5 min | 5 min | Recomputes SLA state for open work items from `sla_started_at`; emits `sla.at_risk` / `sla.breached` / `sla.met` on edges via `work_item_sla_cache` |
| `reminder-scan` | 15 min | 5 min | `work_item.due_soon` / `overdue`, `prerequisite.overdue`, `approval.expiring` / `expired` (writes `reminder_50_sent_at` / `reminder_90_sent_at` so nothing repeats), walks escalation paths (`NO-22`), auto-declines submissions in `clarifying` past the window (`IQ-15`), flags `sla_pause` rows open > 30 days, flags KB articles past `review_due_at`, fires due `schedule_transition` effects |
| `outbox-drain` | 30 s | **none — `SKIP LOCKED`** | Delivers webhooks and external notifications with retry/backoff; auto-disables a webhook failing for 24 h and emits `webhook.auto_disabled`. Runs on every replica concurrently by design |
| `notification-digest` | hourly | 5 min | Batches digest-preference notifications into one email per person |
| `metrics-snapshot` | hourly | 15 min | Writes `metric_snapshot` (hourly grain; daily rollup at 00:15) and, daily, `cycle_snapshot` |
| `search-reindex` | 10 min | 10 min | Catches up rows whose search vector is stale |
| `audit-purge` | daily 03:00 | 30 min | Deletes `audit_log` rows past retention as `taskdesk_maint`; writes its own audit row |
| `session-cleanup` | daily 03:15 | 5 min | Expired sessions, invitations, idempotency keys, soft-deleted rows past their window |
| `attachment-gc` | daily 03:30 | 30 min | Removes objects for `attachment.state = 'deleted'` rows and orphans |
| `attachment-pending-cleanup` | hourly | 5 min | Deletes `attachment` rows still `pending` after an hour (presign never completed) |
| `timer-sweeper` | 15 min | 5 min | Stops `running_timer` rows older than 12 h, writing a capped `time_entry` |
| `plugin-health` | 10 min | 2 min | Pings configured plugins **and each enabled `identity_connection`'s OIDC discovery document** (`IP-25`); surfaces failures in God Mode → Health |
| `backup-check` | hourly | 2 min | Raises the Health warning when no `backup_run` succeeded in 48 h |
| `import-run` | on demand | 1 h, renewed | Executes a queued import, chunked and resumable, on the **bulk write path** |
| `report-export` | on demand | 30 min | Renders a large export to storage and emails an **authenticated** link (`RP-10`) |
| `secrets-rekey` | on demand | 30 min | Re-encrypts every `instance_plugin_config.secrets` **and `identity_connection.client_secret`** from `TASKDESK_ENCRYPTION_KEY_PREVIOUS` to the current key, writing `key_id` per row — see the [runbook](../05-operations/runbook.md) |
| `pending-action-expire` | 1 min | 1 min | Marks `pending_action` rows past `expires_at` as `expired` and emits `pending_action.decided` (`PA-8`); invalidates pending rows whose requester was deactivated or whose credential was revoked since (`PA-9`) |

All cadences are configurable in God Mode → Jobs (`instance:manage_jobs`). A job can be
disabled, and a job can be triggered manually for debugging; both are audited.

## SLA scanning, and why it is cheap

Authoritative SLA **state is not stored**. It is computed from
`sla_started_at + goal.target_minutes` evaluated against the service calendar, minus
`sla_pause` intervals. So `sla-scan` is not maintaining timers — it only needs to detect
*transitions* in order to fire events.

```sql
-- narrow the candidate set in SQL before touching JavaScript
select id, key, sla_started_at, priority, type_id, project_id
from work_item
where resolved_at is null and archived_at is null and deleted_at is null
  and coalesce(sla_policy_resolves(type_id, project_id), false);
```

For each candidate, the pure `computeSlaState()` function from `packages/domain` runs. Only
work items whose state *changed since the last scan* emit an event; the last known state is
kept in `work_item_sla_cache` — keyed by `(work_item_id, metric)` — to detect edges and to
let lists filter on `sla.state` ([api-design.md](api-design.md)). The detail endpoint
always recomputes; where the two disagree the computed value wins
([ADR 0009](adr/0009-lazy-sla-evaluation.md)).

## Outbox delivery

Webhooks and external notifications are **not** fire-and-forget. v1's were, and failures
were invisible.

```
mutation transaction
  ├── write the domain change
  ├── write activity (+ audit_log when security-relevant)
  └── write outbox row (pending)        ← same transaction, so never lost
                    ↓  commit hook: WebSocket broadcast, in-app notification
outbox-drain (every 30 s, every replica)
  ├── claim a batch: SELECT … FOR UPDATE SKIP LOCKED
  ├── deliver (dedupe on outbox.dedupe_key within 5 min for notifications — NO-11)
  ├── success → mark delivered, record duration + attempt + bodies in webhook_delivery
  └── failure → attempts++, next_attempt_at = now + backoff
                after 6 attempts → dead, surfaced in God Mode → Deliveries
```

Backoff: 30 s, 2 m, 10 m, 1 h, 6 h, 24 h. `SKIP LOCKED` is why `outbox-drain` needs no
lease and is safe to run everywhere — it is the one job that deliberately runs on every
replica.

## Metrics snapshots

Reports over months of history are too slow to compute per request. `metrics-snapshot`
writes hourly aggregates into `metric_snapshot` whose `dimensions` always include
`project_id` and `organisation_id`, so a viewer's report sums only the rows within their
reach (`RP-17`). Reports read snapshots for closed periods and compute live only for the
current partial hour, and say so.

## Import runs

Long, chunked, resumable, and driven from the UI rather than the shell.

```
queued → running → (paused) → completed | failed
```

Each chunk commits its own transaction and writes `import_record_link` rows, so a failure
resumes from the last committed chunk and a re-run never duplicates. Imports use the
**bulk write path**: no per-row outbox rows, no per-row broadcasts, one
`import.chunk_completed` progress message on the `instance` WebSocket topic per chunk, and
audit at run level. A 400,000-row import through the normal mutation path would generate
400,000 activity rows *and* 400,000 outbox rows *and* 400,000 broadcasts — which is why
this path exists. Large imports are recommended out of hours; the lease renews for as long
as the run takes.

## Observability

Every run emits:

- A structured log line: job name, duration, items processed, outcome, `traceId`.
- Prometheus metrics: `taskdesk_job_duration_seconds`, `taskdesk_job_runs_total{outcome}`,
  `taskdesk_job_last_success_timestamp`, `taskdesk_outbox_pending`,
  `taskdesk_nodejs_eventloop_lag_seconds`.
- An OpenTelemetry span, when tracing is configured.

Alert conditions worth having from day one:

| Condition | Meaning |
| --- | --- |
| `job_last_success_timestamp` older than 3× cadence | The job is stuck or the lease is wedged |
| `outbox_pending` rising for 15 minutes | Deliveries are failing |
| Any job failing three consecutive runs | Page someone |
| Event-loop lag sustained above 100 ms | Move to `TASKDESK_ROLE=jobs` on a dedicated replica |

## Writing a new job

1. Add a file under `apps/api/src/jobs/`.
2. Export `{ name, schedule, leaseTtl | 'none', handler(signal) }`.
3. Make the handler **idempotent**. Assume it will run twice, and honour `signal` (the
   lease may be lost).
4. Chunk anything unbounded, and `await` between chunks so the event loop breathes.
5. Register in `jobs/index.ts`.
6. Add a unit test for the handler and an integration test for the leasing behaviour
   (acquire, lose-and-abort, release-only-own).
7. Add it to the table above — the only place it is listed.

## Related

- [Architecture overview](overview.md) · [Realtime](realtime.md) · [Events](events.md)
- [SLA](../03-features/sla.md) · [Observability](observability.md) · [Data model](data-model.md)
