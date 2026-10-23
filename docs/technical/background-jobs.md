# Background jobs contract

Jobs run in process with distributed coordination. This is the complete required job inventory; it is not a list of accepted or fully implemented jobs.

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
| `secrets-rekey` | on demand | 30 min | Re-encrypts every `instance_plugin_config.secrets` **and `identity_connection.client_secret`** from `TASKDESK_ENCRYPTION_KEY_PREVIOUS` to the current key, writing `key_id` per row — see the runbook |
| `automation-schedule` | 1 min | 1 min, **per rule** | Evaluates every enabled `automation` whose `trigger = 'schedule'` and whose `schedule_cron` is due against the rule's `project_filter`, then invokes it. Rule crons are stored rows, not `croner` registrations: the job wakes each minute, selects the due rules and runs them, so a rule edited in the UI takes effect on the next tick with no scheduler reload. The lease name is **one per rule** — `automation:<automation_id>` — so 40 replicas run each rule once and a slow rule does not block the others. This is the runner behind the `schedule` trigger that [events.md](events.md) calls "not an event" |
| `pending-action-expire` | 1 min | 1 min | Marks `pending_action` rows past `expires_at` as `expired` and emits `pending_action.decided` (`PA-8`); invalidates pending rows whose requester was deactivated or whose credential was revoked since (`PA-9`) |

## Coordination and retention

Lease ownership is hostname + PID + boot ID. Acquire, renew and release by exact owner, use database time and stop work on lost lease. Per-rule automation leases prevent one slow rule blocking others. Outbox workers use independent `SKIP LOCKED` claims rather than a global lease; every retry revalidates eligibility and reach.

God Mode job cadence/enable/manual-run changes require `instance:manage_jobs` and audit. Retention obeys person, source, recipient and resource-owner legal holds; unresolved ownership retains history conservatively. Purge eligible children before empty digest groups and parent envelopes. Pending deliveries and unread inbox entries are not terminal retention candidates. Coordination-reservation expiry is separate from history retention. Attachment GC respects recovery time and legal holds.

`audit-verify` is an on-demand read-only CLI/administration action and restore-drill check, not a scheduled job. It verifies the chain from its retained anchor and reports the first break.

## Current scheduler mapping

The scheduler currently registers `outbox-drain`, `attachment-pending-cleanup`, `attachment-gc`, `sla-scan`, `session-cleanup`, `pending-action-expire`, `reminder-scan`, and the inherited `due-date-reminders` compatibility job. `due-date-reminders` runs every five minutes; it is not an additional target job and does not prove the complete reminder-scan contract. Position rebalance has a separate on-demand implementation. Registration alone does not prove the required job behavior or configurable administration.
