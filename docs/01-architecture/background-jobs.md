# Background jobs

No separate worker service. Jobs run **in-process** in the API, scheduled with `croner`,
made replica-safe by a lease table. **This document is the only list of jobs** — names are
identifiers (`job_lease.name`, Prometheus labels) and are not restated anywhere else.

## Why in-process

v1 ran a Go worker whose entire job was polling the API and computing snapshots. It cost
a language, a deployment, a set of service-to-service credentials, and a second place for
bugs to hide. kaneo already ships **both** halves of this: `croner`, and the `job_lease`
table with its `withJobLease()` acquire/release SQL
(`apps/api/src/database/schema.ts`, `apps/api/src/scheduler/leader-lock.ts`) — the same
statements written out below. What is genuinely ours is the **heartbeat/renew** and the
abort `signal`, which upstream has no equivalent of; that is what makes the 4-hour import
case below work. Agrees with [ADR 0007](adr/0007-in-process-jobs.md).

The trade is real and accepted: a long job competes with request handling for the event
loop. Mitigations — jobs are chunked, they yield between batches, and heavy aggregation
is pushed into SQL rather than JavaScript. `TASKDESK_ROLE=jobs` dedicates a replica to
the scheduler and `TASKDESK_ROLE=web` disables it ([configuration-reference.md](../05-operations/configuration-reference.md)),
so the escape hatch in [scaling.md](../05-operations/scaling.md) is real.

## Leasing

```sql
job_lease ( name text primary key, owner text not null, expires_at timestamp not null )
```

Inherited from kaneo, unchanged — and deliberately without `created_at`/`updated_at`: it is
a lock, not data ([data-model.md](data-model.md)). `owner` is
`${hostname}:${pid}:${bootId}` — unique per process lifetime.

`expires_at` is `timestamp without time zone` holding a **UTC wall clock**, not `timestamptz`
and not the database server's local clock. Every comparison against it therefore goes through
`dbNowUtc()` (`apps/api/src/utils/db-time.ts`) and never a bare `now()`, on both the write and
the read — a lease acquired on one clock and expired against another expires hours early or
hours late depending on the session `TimeZone`. Issue #212 is that class; the column type is
the reason the helper exists, and converting these columns to `timestamptz` is tracked
separately rather than assumed done.

The notification reservation protocol needs a wall-clock sample **after** any reservation-row
lock wait; transaction-start `now()` and a statement timestamp captured before such a wait
can be stale. Its design uses one `clock_timestamp() AT TIME ZONE 'UTC'` sample per atomic
operation, after the lock is held, and reuses that value in all predicates and writes. This
uses the same database-owned UTC convention as `dbNowUtc()`, but the current helper's
transaction-start source is insufficient for this lock-delayed path. Updating that helper
or using an equivalent statement-local expression is future implementation work.

```sql
-- acquire (INHERITED from kaneo's leader-lock.ts; the clock is ours, #212): succeeds only
-- if no lease exists or the existing one has expired
insert into job_lease (name, owner, expires_at)
values ($1, $2, dbNowUtc() + $3::interval)
on conflict (name) do update
  set owner = excluded.owner, expires_at = excluded.expires_at
  where job_lease.expires_at < dbNowUtc()
returning owner;                       -- a row is returned ⇔ we hold the lease

-- release (INHERITED), only our own
delete from job_lease where name = $1 and owner = $2;
```

**No renewal is implemented.** What ships is a single-lease helper,
`withJobLease(name, run, whenHeldElsewhere, leaseMs)` in
`apps/api/src/scheduler/leader-lock.ts`: it acquires, runs the handler if it won, and the
lease simply expires after `leaseMs` (default 15 minutes) whether or not the handler finished.
There is no heartbeat, no `renew()`, no lease-backed abort signal, and no `acquireLease` —
`grep -rn "acquireLease\|lease.renew" apps packages` is empty. The renewal design below is
recorded **as design intent, not as behaviour**; a handler that can outlive its lease needs it
implemented first, and any implementation must renew through `dbNowUtc()` like the acquire
does, or it re-introduces #212 in the one statement whose whole job is to hold a lock:

```ts
// DESIGN INTENT — NOT IMPLEMENTED. Do not describe this as current behaviour.
const lease = await acquireLease('sla-scan', { ttl: '5 minutes' });
if (!lease) return;                                  // another replica holds it
const heartbeat = setInterval(() => lease.renew(), lease.ttlMs / 3);
try { await run(lease.signal); }                     // renew() aborts the signal if the lease is lost
finally { clearInterval(heartbeat); await lease.release(); }
```

- Acquire is a single atomic statement; holding the lease is decided by whether a row was
  **returned**, never by a separate read.
- Renewal is **design intent, not behaviour** (see above). Today a handler that outlives its
  lease is simply no longer protected after `leaseMs`: the next replica may acquire while the
  first is still running, which is precisely why every handler must be idempotent.
- **A lease is an optimisation, not mutual exclusion.** An expired holder may still be
  running its last statement. Every handler is therefore **idempotent**, because
  at-least-once is the only guarantee a lease gives.

## The jobs

| Name | Cadence | Lease TTL | What it does |
| --- | --- | --- | --- |
| `sla-scan` | 5 min | 5 min | Recomputes SLA state for **open** work items from `sla_started_at`; emits `sla.at_risk` / `sla.breached` on edges via `work_item_sla_cache`. It does **not** emit `sla.met` / `sla.missed` — a just-completed item has `resolved_at` set and is outside the candidate set below, so those two are emitted by the `WF-17` transition into a `completed`-group state ([events.md](events.md)) |
| `reminder-scan` | 15 min | 5 min | `work_item.due_soon` / `overdue`, `prerequisite.overdue`, `approval.expiring` / `expired` (writes `reminder_50_sent_at` / `reminder_90_sent_at` so nothing repeats), walks escalation paths (`NO-22`), auto-declines submissions in `clarifying` past the window (`IQ-15`), flags `sla_pause` rows open > 30 days, flags KB articles past `review_due_at`, fires due `scheduled_transition` rows (`state = 'pending'` and `due_at <= now()`; a row whose work item has left `from_state_id` is marked `cancelled` instead) |
| `outbox-drain` | 30 s | **none — `SKIP LOCKED`** | Processes parent event envelopes and independently claims immediate notification children or sealed digest groups; applies retry/backoff and current reach checks; handles webhook deliveries and auto-disables a webhook failing for 24 h, emitting `webhook.auto_disabled`. Runs on every replica concurrently by design |
| `notification-digest` | hourly | 5 min | Seals collecting digest groups whose stored UTC windows have ended; it does not call a provider. `outbox-drain` also seals a due group atomically when claiming it, so a delayed sweep cannot block delivery |
| `metrics-snapshot` | hourly | 15 min | Writes `metric_snapshot` (hourly grain; daily rollup at 00:15) and, daily, `cycle_snapshot` |
| `search-reindex` | 10 min | 10 min | Catches up rows whose search vector is stale |
| `audit-purge` | daily 03:00 | 30 min | Deletes `audit_log` rows past retention as `taskdesk_maint`; **skips rows whose `organisation_id` or actor is under an open `legal_hold`** (join `legal_hold` on `lifted_at is null`); writes an `audit_chain_anchor` row **before** deleting, and does not delete if the anchor cannot be written; writes its own audit row |
| `session-cleanup` | daily 03:15 | 5 min | Physically deletes expired sessions, invitations, idempotency keys, expired `notification_preference_handoff` rows, and expired `outbox_dedupe_reservation` rows; purges eligible read notifications, terminal notification children, empty terminal digest groups, and parent event envelopes in child-before-parent order under the retention and legal-hold rules below; and purges soft-deleted rows past their window — **the soft-delete purge skips any row whose organisation or person is under an open `legal_hold`**, and leaves it soft-deleted until the hold lifts. Reservation lease validity and takeover are enforced at `lease_expires_at`; they do not wait for this daily physical cleanup. |
| `attachment-gc` | daily 03:30 | 30 min | Removes objects for `attachment.state = 'deleted'` rows and orphans; **skips attachments whose `organisation_id` is under an open `legal_hold`** — which is why `attachment.workspace_id` / `organisation_id` are stored on the row ([data-model.md](data-model.md)) |
| `attachment-pending-cleanup` | hourly | 5 min | Deletes `attachment` rows still `pending` after an hour (presign never completed) |
| `timer-sweeper` | 15 min | 5 min | Stops `running_timer` rows older than 12 h, writing a capped `time_entry` |
| `plugin-health` | 10 min | 2 min | Pings configured plugins **and each enabled `identity_connection`'s OIDC discovery document** (`IP-25`); surfaces failures in God Mode → Health |
| `backup-check` | hourly | 2 min | Raises the Health warning when no `backup_run` succeeded in 48 h |
| `position-rebalance` | on demand | 5 min | Triggered when a rank write leaves the gap between two neighbouring `work_item.position` (`numeric(20,10)`) values below `1e-6`; renumbers the whole affected state (or backlog) partition to evenly-spaced values in one transaction (`WI-12`) |
| `import-run` | on demand | 1 h, renewed | Executes a queued import, chunked and resumable, on the **bulk write path** |
| `report-export` | on demand | 30 min | Renders a large export to storage and emails an **authenticated** link (`RP-10`) |
| `secrets-rekey` | on demand | 30 min | Re-encrypts every `instance_plugin_config.secrets` **and `identity_connection.client_secret`** from `TASKDESK_ENCRYPTION_KEY_PREVIOUS` to the current key, writing `key_id` per row — see the [runbook](../05-operations/runbook.md) |
| `automation-schedule` | 1 min | 1 min, **per rule** | Evaluates every enabled `automation` whose `trigger = 'schedule'` and whose `schedule_cron` is due against the rule's `project_filter`, then invokes it. Rule crons are stored rows, not `croner` registrations: the job wakes each minute, selects the due rules and runs them, so a rule edited in the UI takes effect on the next tick with no scheduler reload. The lease name is **one per rule** — `automation:<automation_id>` — so 40 replicas run each rule once and a slow rule does not block the others. This is the runner behind the `schedule` trigger that [events.md](events.md) calls "not an event" |
| `pending-action-expire` | 1 min | 1 min | Marks `pending_action` rows past `expires_at` as `expired` and emits `pending_action.decided` (`PA-8`); invalidates pending rows whose requester was deactivated or whose credential was revoked since (`PA-9`) |

`session-cleanup`'s read-notification retention purge skips a row when an open person hold
matches `notification.person_id`, or an open organisation hold matches either that
recipient's organisation or the organisation that owns the referenced resource (resolved
using [notifications.md](../03-features/notifications.md#permissions)). If resource ownership cannot be resolved, retain the
row while any organisation hold is open. Unread notifications remain ineligible regardless
of holds.

Notification retention is separate from event and delivery retention. A terminal
`notification_delivery` child (`delivered`, `dead`, `suppressed`) is eligible 30 days after
terminal `updated_at` only when no matching hold applies. A person hold matches
`recipient_person_id`. An organisation hold matches the source `organisation_id`, the
recipient's organisation, or the owning organisation of the referenced notification resource,
resolved using [notifications.md](../03-features/notifications.md#permissions). Do not assume
the event's source organisation or the recipient's organisation is the resource-owning
organisation. If resource ownership cannot be resolved, retain the child while any organisation
hold is open. Pending children are never purged. Any retained child, including one retained by
a resource-owning-organisation hold, keeps its parent `outbox` envelope; delete eligible
children before considering the parent. A terminal parent (`delivered`, `dead`) is eligible
after 30 days only if no child must remain and no open hold matches its source scope. A child
retained by a person, recipient, source, or resource-owning-organisation hold therefore retains
its parent and may conservatively retain sibling history attached to the parent.

A `notification_digest` group stays pending while any child awaits delivery. Terminal groups
are eligible 30 days after terminal `updated_at` only when no matching hold applies to any
member. Apply each child's person, source-organisation, recipient-organisation and
resource-owning-organisation matches above; if a member's resource ownership cannot be
resolved, retain its group while any organisation hold is open. Do not delete a group while any
child references it. Purge eligible terminal children first, then an eligible terminal group
only when empty. One held child, including one held through its resource-owning organisation,
conservatively keeps the group and shared history. The retained child also keeps its parent
`outbox` envelope. Hard deletion removes scoped children, then empty groups and applicable
parent events; reservation rows cascade from their delivery owner. Read inbox retention never
deletes a delivery child or its event envelope.

Expired `outbox_dedupe_reservation` cleanup is exempt from legal holds. Lease authority ends
at `lease_expires_at` and takeover may proceed immediately; daily cleanup physically removes
expired rows even for held people or organisations. These rows contain only short-lived
delivery-coordination identifiers, not event payload or notification history. Credential,
session, invitation, idempotency-key, and preference-handoff expiry cleanup continues during
holds; hard delete and history-retention purges remain subject to their hold rules.

Acceptance for session-cleanup retention: a terminal child at 29 days remains; after 30
days, cleanup purges it only if no matching hold exists. A pending child remains regardless
of age. A parent with any retained child remains; after all eligible children are purged, a
terminal parent is purgeable only after its own 30-day window and absent a matching hold. A
digest group with child members remains; after eligible children are removed, an empty
terminal group is purgeable after its 30-day window if unheld. Person or organisation holds
preserve matching children, groups and parent event history; unheld rows become eligible
after the hold lifts. Inbox read-purge remains independent; unread rows remain. Expired
reservations under the same hold are still physically removed, and takeover remains possible
before cleanup. The organisation-hold acceptance case includes a terminal child whose event
source scope and recipient organisation differ from the owning organisation of its referenced
resource: an open hold on that resource-owning organisation retains the child, its digest
group when present, and its parent event. An unresolved resource owner retains the child and
group while any organisation hold is open. After the hold lifts and each row's own 30-day
window has elapsed, cleanup removes eligible children first, then an empty group, then an
eligible parent.

All cadences are configurable in God Mode → Jobs (`instance:manage_jobs`). A job can be
disabled, and a job can be triggered manually for debugging; both are audited.

**`audit-verify` is not in this table and is not a scheduled job.** It is an **on-demand
CLI** (`taskdesk audit-verify`, also runnable from God Mode) that walks the `audit_log`
hash chain from the newest `audit_chain_anchor` and reports the first row where the chain
breaks. It is run on demand and at every restore drill — [data-model.md](data-model.md),
[audit-trail.md](../03-features/audit-trail.md). It takes no lease, because it only reads.

## SLA scanning, and why it is cheap

Authoritative SLA **state is not stored**. It is computed from
`sla_started_at + goal.target_minutes` evaluated against the service calendar, minus
`sla_pause` intervals. So `sla-scan` is not maintaining timers — it only needs to detect
*transitions* in order to fire events.

```sql
-- narrow the candidate set in SQL before touching JavaScript
select wi.id, wi.key, wi.sla_started_at, wi.first_response_at, wi.priority, wi.type_id,
       wi.project_id,
       coalesce(wit.sla_policy_id, rt.sla_policy_id, p.sla_policy_id, w.default_sla_policy_id)
         as sla_policy_id            -- SLA-1's four levels, in order, spelled out
from work_item wi
join work_item_type wit on wit.id = wi.type_id
join project p         on p.id  = wi.project_id
join workspace w       on w.id  = p.workspace_id
left join submission sub on sub.work_item_id = wi.id
left join request_type rt on rt.id = sub.request_type_id
where wi.resolved_at is null and wi.archived_at is null and wi.deleted_at is null
  and coalesce(wit.sla_policy_id, rt.sla_policy_id, p.sla_policy_id,
               w.default_sla_policy_id) is not null;
```

There is no `sla_policy_resolves()` function; the resolution order of `SLA-1`
(work item type → request type → project → workspace default) is the `coalesce` above, and
it is the only place it is written as SQL.

For each candidate, the pure `computeSlaState()` function from `packages/domain` runs. Only
work items whose state *changed since the last scan* emit an event; the last known state is
kept in `work_item_sla_cache` — keyed by `(work_item_id, metric)` — to detect edges and to
let lists filter on `sla.state` ([api-design.md](api-design.md)). The detail endpoint
always recomputes; where the two disagree the computed value wins
([ADR 0009](adr/0009-lazy-sla-evaluation.md)).

## Outbox delivery

The parent outbox is one durable envelope per domain event. The originating transaction
writes the business change, activity/audit where applicable, one parent, one inbox row per
distinct eligible person, one notification_delivery child per eligible person and enabled
external channel, and any event-time digest membership. These commit together or roll back
together. Provider calls stay outside the transaction. outbox.event_id remains
DomainEvent.id and the event-consumer idempotency key; notification_delivery.id is the stable
identity for one external recipient/channel attempt. Parent processing state completes
event-consumer materialization and never follows a single child's provider result. Replays
cannot duplicate inbox rows or children because their event-derived uniqueness is enforced.

outbox-drain runs on every replica without a global job lease. It claims parent envelopes,
immediate children and due digest groups with row-level SKIP LOCKED; recipient/channel/key
reservations serialize competing deliveries. One child success cannot complete, suppress or
dead-letter another. A parent is not complete merely because one recipient/channel
succeeded. Webhook attempts remain per-target records in webhook_delivery.

For an immediate child, recheck current resource reach, channel preference and quiet hours.
Suppress it without a provider call if reach is lost or its channel is disabled; quiet hours
defer it to the next allowed time except for urgent events exempted by NO-3. Acquire its
outbox_dedupe_reservation;
a live reservation owned by another child defers this work without incrementing attempts.
After acquisition, suppress only when a different delivery id with the same tuple has a
committed success in the prior five minutes. The reservation owner is the child id, never
the event id.

Only after eligibility, membership, dedupe and all reservations are accepted, one fenced
pre-provider transaction revalidates the current unexpired owner/token reservation and
durably increments the existing direct child's `attempts` once. Commit before provider I/O;
never call an adapter inside a transaction. For a digest, the equivalent transaction
revalidates the group and all member reservation tokens, stores the canonical attempted
payload hash, and increments the existing group `attempts` once; digest member child
attempts stay zero. A failed transaction or stale/expired fence cannot authorize provider
I/O and consumes no attempt. The durable increment is not repeated or refunded by lease
renewal, completion, failure, timeout or recovery. This deliberately means a process crash
after authorization but before the actual call uses one of the six slots. Thus each direct
delivery or digest group can have at most six provider call starts, though a crash before I/O
can leave fewer than six actual calls.

Digest candidates attach to a collecting notification_digest group in the event transaction.
Groups partition by recipient, channel, workspace, optional organisation, cadence and UTC
window. Resolve the time zone from the person's quiet-hours zone, falling back to the
instance zone; persist the zone and UTC boundaries. The writer samples database wall time.
If the target window ended or the group sealed, attach to the next eligible window. A group
row lock serializes attachment and sealing. After window end the drain seals the group and
freezes membership, rechecks each child's current reach and preference, defers the entire
group for quiet hours, and renders a deterministic bounded safe summary. A group with no
eligible member and its children become suppressed.

Within a sealed group, order members by (created_at, id); for each dedupe tuple suppress
later candidates within five minutes of an included candidate. Acquire remaining tuple
reservations in canonical key order, each owned by a deterministic representative child.
If any key is live under another owner, release this call's acquired reservations and group
lease, defer until expiry, and do not increment attempts. The group lease fences one provider
call while member reservations preserve dedupe serialization.

Each lease acquire, renewal, recent-success lookup and completion samples
clock_timestamp() AT TIME ZONE 'UTC' once after relevant lock waits, reusing that sample
for predicates and writes. Never use transaction-start now() for this protocol. Renew the
group lease and all member reservations every 15 seconds to 60 seconds from the renewal
sample. The adapter has a 30-second absolute deadline including connection setup and response
wait; request cancellation and stop awaiting when it expires, even if the adapter ignores
cancellation.

For immediate success, atomically mark the child delivered, set delivered_at from the
completion sample, and release its reservation conditional on the current unexpired child
id/token. For digest success, persist the canonical payload hash before the call, then in one
transaction conditional on current unexpired group token and each held member reservation
token, mark included children delivered with one completion sample, suppress currently
ineligible children, mark the group delivered and release reservations. Provider idempotency
may use the child id or (digest id, payload_hash) where supported; correctness does not rely
on provider support.

A definite immediate failure schedules backoff from the already-incremented attempt number
(30 s, 2 m, 10 m, 1 h, 6 h, 24 h) and releases its reservation; outcome handling does not
increment again. The sixth authorization marks it dead. A definite group failure leaves
included children pending and releases group/member leases; group attempts are not repeated
and child attempts remain zero. After six group authorizations, atomically dead-letter the
group and its remaining pending children. Timeout, crash or unknown response is ambiguous:
the durable authorization already counts, so stop renewal, keep leases until expiry and retry
no earlier than all applicable expiries. Recovery after an expired sixth attempt marks the
child or group dead under the safe fence and cannot authorize a seventh provider call. A
stale or expired token cannot authorize a provider call, commit success or release a new
owner's lease. A provider-accepted but uncommitted request may be sent again after retry;
delivery remains at-least-once, not exactly-once.

This is a target contract. Runtime fan-out, reservations, lock-delayed wall-clock sampling,
digest grouping/sealing, deadlines, durable attempt authorization, send-time reach checks
and child/group retention are not implemented. Acceptance cases are specified in
notifications.md#delivery. The existing
database clock helper uses transaction-start time and is insufficient for this protocol; it
must be changed or bypassed.

## Metrics snapshots

Reports over months of history are too slow to compute per request. `metrics-snapshot`
writes hourly aggregates into `metric_snapshot`. `project_id` and `organisation_id` are
**real columns** on that table with an index over them ([data-model.md](data-model.md)),
not `dimensions` keys, so a viewer's report sums only the rows within their reach (`RP-17`)
without a jsonb extraction per row. Reports read snapshots for closed periods and compute live only for the
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
