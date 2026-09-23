# Audit trail

- **Stage:** P2
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** RBAC (`instance:read_audit`, `workspace:manage_settings`, and the
  per-entity read capabilities the entity-history route resolves through). The mechanism
  itself has no other prerequisite — every mutation across every phase is audited
  generically from day one (the Behaviour section below). Two rows in the audit action catalogue name
  later-phase actions (`impersonation.*`, P4 God Mode; `work_item.exported`/
  `report.exported`/`config.exported`/`instance.exported`, P5 reporting) — those entries
  are inert, producing zero rows, until the features that trigger them exist; they are not
  a build-order dependency of this one

## Purpose

Answer, under scrutiny: **who changed what, when, and from where.**

Distinct from application logging, which exists to debug the system. See
[observability](../01-architecture/observability.md) for the distinction — conflating them
produces an audit trail you cannot rely on and logs full of personal data.

## Two related mechanisms

| | `activity` | `audit_log` |
| --- | --- | --- |
| Scope | Work items | Everything |
| Audience | Users, in the interface | Administrators and auditors |
| Retention | Forever — it is the journal | 12 months, configurable |
| Contains | Field changes, comments, state moves | Every mutation, plus authentication and denials |
| Purpose | Understand the work | Prove what happened |

`activity` is a feature. `audit_log` is a control. Both are append-only.

## What is audited

Every mutation, plus these regardless of outcome:

- Sign-in success and failure, with the provider used
- Sign-out and session revocation
- Impersonation start and end
- Role creation, modification, deletion
- Capability grants and revocations
- Membership changes
- Identity provider configuration changes
- Any plugin configuration change
- Feature flag changes
- Permission denials
- Data exports
- Bulk operations — one row per item plus one summary row
- Organisation creation, suspension, deletion
- Attachment downloads
- Encryption key rotation
- Retention purges — the purge audits itself

## Data

`audit_log`, `audit_chain_anchor` — see [data model](../01-architecture/data-model.md) §11
for both tables' exact columns and § "The audit hash chain" for `row_hash`/`prev_hash`'s
recipe. `activity` (`data-model.md` §4) is the input to point-in-time reconstruction
(`AU-8`) but is a separate table, owned by
[comments-and-activity.md](comments-and-activity.md) — this spec reads it, never writes
it.

## Behaviour

- `AU-1` Rows record: actor id, actor IP, user agent, action, entity type, entity id,
  before, after, trace id, timestamp.
- `AU-2` **Secret values are never recorded.** A plugin configuration change records which
  keys changed, never what they changed to. The writer's own best-effort backstop
  (`apps/api/src/audit/audit-writer.ts`'s `assertNoObviousSecret`, not a substitute for
  this rule) refuses to write any key whose normalised segments match `password`,
  `secret`, `token`, `credential`/`credentials`, `pwd`, `passphrase`,
  `authorization`/`authorisation`, or the adjacent pairs `api`+`key`, `private`+`key`,
  `encryption`+`key`, `signing`+`key`, `access`+`token`, `client`+`secret` — this list
  did not previously exist anywhere and is written here, in AU-2 itself, rather than
  left as an undocumented implementation detail (Opus security review of PR #291, S6).
  A key whose last segment is `id`, `at` or `count` is exempt regardless of an earlier
  match (`apiKeyId`, `secretRotatedAt`, `tokenExpiresAt` name metadata about a secret,
  never the secret itself).
- `AU-3` Append-only. No API can update, delete or truncate a row. Enforced two ways: no
  endpoint exists to do any of the three, and — the deeper control — two triggers:
  `audit_log_append_only` (`BEFORE UPDATE OR DELETE ... FOR EACH ROW` /
  `audit_log_reject_mutation()`, migration `0067`) raises on every UPDATE/DELETE
  attempt, with one carve-out: `AU-7`'s `organisation_id`-to-NULL tombstone, which
  Postgres implements as an `UPDATE` against this same table, allowed only when the
  referenced organisation row no longer exists — never against a live organisation's
  rows; and `audit_log_append_only_truncate` (`BEFORE TRUNCATE ... FOR EACH STATEMENT` /
  `audit_log_reject_truncate()`, migration `0067`) raises unconditionally, because a
  row-level trigger never fires for `TRUNCATE` at all. Both fire against every role,
  including the table's owner, for an ORDINARY UPDATE/DELETE/TRUNCATE statement — this
  deployment provisions exactly one Postgres role, which owns `audit_log` and so keeps
  full DML whatever is revoked from it (decision log, 2026-09-23, "`audit_log` is
  append-only by trigger, not by grant") — but that role is also a **superuser** under
  the official `postgres` image's own default (`compose.yml`, `charts/taskdesk/
  templates/postgresql-deployment.yaml`). Stated plainly, not overstated: these triggers
  stop an accidental or buggy application query and every non-owner role, not a
  **compromised owner/superuser connection**, which can disable or drop either trigger
  outright (`ALTER TABLE ... DISABLE TRIGGER`, `DROP TRIGGER`, `SET
  session_replication_role = replica`, or even `CREATE RULE ... DO INSTEAD NOTHING`) —
  closing that residual needs the real two-role split this deployment does not
  provision today (Opus security review of PR #291, S5).
  `audit-purge`, run as a separate maintenance role, is the only thing that deletes rows,
  and only the oldest-past-retention range.
- `AU-4` An impersonated action records **both** identities.
- `AU-5` System actions are attributed to the job or automation, never to a person.
- `AU-6` Retention purge deletes rows past the configured age and writes its own audit row
  saying how many.
- `AU-7` Deleting an organisation tombstones its audit rows rather than removing them.
  Deleting an audit trail on request defeats its purpose. The mechanism is
  `audit_log.organisation_id`'s `ON DELETE SET NULL`
  ([data-model.md](../01-architecture/data-model.md) §11): the row, its actor, action,
  before/after and hash-chain position all survive untouched — only the organisation link
  is nulled, so a tombstoned row still renders everywhere it did before, minus the
  organisation it can no longer be filtered by. No separate `tombstoned_at` column exists;
  the tombstone *is* the null, and it is permanent — a hard-deleted organisation's id is
  gone, so there is nothing to restore it to.

## Point-in-time reconstruction

Because `activity` records old and new values for every field, a work item's state at any
past instant can be reconstructed by replaying from creation.

This gives, for free, the things other tools build separately:

- **Baselines** — "what did this project look like on 1 March?"
- **Change reports** — "what changed between the last two reviews?"
- **Dispute resolution** — "the due date was 14 March when we agreed it, and it was moved
  on the 19th by this person."

Borrowed from OpenProject's journal design.

- `AU-8` Reconstruction is a domain function over activity rows, not a stored snapshot.
- `AU-9` Reconstruction is available for work items in P2, and for projects in P5.

## Access

- `AU-10` Workspace administrators see audit rows for their workspace.
- `AU-11` Instance administrators see everything.
- `AU-12` Customers never see the audit log. They see the public portion of `activity` on
  their own requests.
- `AU-13` Reading the audit log is itself audited, as is exporting it. `audit.read` rows
  are **not** exempt from the retention purge — they are ordinary audited events, subject
  to the same configurable window (12 months by default) as every other row, one row per
  read (no batching, no sampling). This is a volume decision made deliberately, not in
  passing: an administrator working the audit screen for an hour writes a proportionate
  number of `audit.read` rows, which is an acceptable cost for "reading the log is itself
  a reviewable action."
- `AU-14` **If the audit write fails, the mutation still succeeds** — losing a mutation
  because auditing failed is worse than a gap — but the failure is never silent: an
  error-level log line, an `audit_write_failures_total` metric that alerts, and a
  notification to every instance administrator, because the trade is acceptable only if
  someone finds out ([security-model.md](../01-architecture/security-model.md#audit)).
- `AU-15` Rows are **hash-chained**: `row_hash` is SHA-256 over the **canonical form defined
  once in data-model.md §11** — the ordered column list (`prev_hash` **included**, as its
  first field, per §11's own "Hash input" list — corrected 2026-09-16: an earlier version
  of this sentence read ambiguously and could be misread as excluding it, which would defeat
  the chain, since an intermediate row's chain pointer could then be altered without
  changing that row's own `row_hash`), RFC 8785 canonical JSON for the `jsonb` columns,
  microsecond UTC ISO-8601 timestamps, lowercase hex; `organisation_id` and every other
  post-hoc-mutable column excluded from that list. Every insert takes
  `pg_advisory_xact_lock` on the audit constant, so the chain is strictly serial per instance
  even with many replicas; the first row chains from the zero hash, and `audit-purge` writes
  an `audit_chain_anchor` row that `audit-verify` starts from. `audit-verify` (on demand,
  and at every restore drill) walks the chain and detects a NAIVE edit — a row altered,
  or deleted, in place while the rest of the chain is left alone — which is the residual
  risk left after `audit_log_append_only`'s trigger (`AU-3`) already refuses an ordinary
  `UPDATE`/`DELETE`/`TRUNCATE` (decision log, 2026-09-23, "`audit_log` is append-only by
  trigger, not by grant"). Stated plainly, not overstated (Opus security review of PR
  #291, S5): the chain is an **unkeyed** SHA-256 with no head anchored outside the
  database itself. An actor able to disable the trigger (the same owner/superuser tier
  `AU-3` names above) can recompute every row from the point of alteration forward — the
  chain verifies as intact either way, because it only proves internal self-consistency,
  never that the current head matches some independently-held record of an earlier one —
  or delete the newest rows outright, which `audit-verify` also cannot see, since there
  is nothing after the new (shorter) chain's own head to contradict it. Closing this
  needs either an externally-anchored head (checked against a copy the database role
  cannot itself alter — `audit_chain_anchor` narrows the *window* between anchors but
  does not by itself anchor OUTSIDE the database) or a hash keyed with a secret the
  database role does not hold.

## Audit action catalogue

`audit_log.action` is a dotted key. **Where a domain event exists for the mutation, the
audit action is that event's key** from [events.md](../01-architecture/events.md) — one
vocabulary, not two (`work_item.transitioned`, `pending_action.requested`,
`identity.deprovisioned`, …). The keys below are **audit-only**: security-relevant things
that are not domain events and so appear nowhere else. This list is the single home for
them; a new audit-only action is added here first ([AGENTS.md](../../AGENTS.md) do-not 11).

| Audit-only action | Written when |
| --- | --- |
| `auth.sign_in_succeeded` · `auth.sign_in_failed` · `auth.sign_out` · `auth.session_revoked` | Authentication lifecycle, with the provider used |
| `auth.mfa_enrolled` · `auth.mfa_reset` | Second factor enrolled; reset by an administrator (with the verification note) |
| `impersonation.started` · `impersonation.ended` | `GM-7`, `GM-11` |
| `role.created` · `role.updated` · `role.deleted` · `membership.changed` · `membership.sees_all_granted` | Authority and reach changes |
| `project.reach_changed` | `owner_team_id` or `parent_id` changed ([rbac.md](../01-architecture/rbac.md#reach)) |
| `invitation.sent` · `invitation.redeemed` · `invitation.revoked` | Invitations |
| `plugin.changed` · `plugin.tested` · `secrets.rekeyed` | Plugin configuration (keys only, never values), a `test()` call even when unsaved, key rotation |
| `feature_flag.changed` | Any level |
| `permission.denied` | A 403 or an out-of-reach 404 on a scoped route |
| `work_item.exported` · `report.exported` · `attachment.downloaded` · `config.exported` · `instance.exported` | Data leaving through a person's hands |
| `bulk.performed` | One summary row per bulk operation (plus one per item) |
| `import.run` · `job.triggered` | Run-level import audit; a manual job trigger |
| `api_key.created` · `api_key.revoked` · `webhook.created` · `webhook.deleted` · `webhook.secret_rotated` | Durable-authority lifecycle |
| `automation.enabled` · `automation.disabled` | Rule state |
| `ai.sent_externally` | A work item's content was sent to an `ai.*` provider |
| `organisation.created` · `organisation.suspended` · `organisation.deleted` · `legal_hold.placed` · `legal_hold.lifted` | Tenancy lifecycle |
| `audit.read` · `audit.exported` · `audit.purged` | `AU-13`; the purge audits itself |
| `instance.restored` | A restore completed ([backup-and-restore.md](../05-operations/backup-and-restore.md)) |
| `pending_action.viewed` | The one pending-action transition that is not an event (`PA-11`) |

## Permissions

| Action | Capability |
| --- | --- |
| Read the instance-wide log | `instance:read_audit` (`AU-11`) |
| Read a workspace's log | `workspace:manage_settings` (`AU-10`) |
| Read one entity's history | that entity's own read capability, resolved by `{type}` from the policy registry (kind 1) |
| Export the audit log | `instance:read_audit` **and** step-up re-authentication (`AU-13`, elevated) |
| Reconstruct a work item at an instant | `work_item:read` |
| Customers | never — they see the public portion of `activity` on their own requests only (`AU-12`) |

## Screens

**God Mode → Audit** — filterable by actor, action, entity type, entity, date range, and
outcome. Each row expands to show the before/after diff.

**Work item → Activity** — the user-facing journal, already part of the detail view.

**Entity history** — a "History" affordance on roles, workflows, SLA policies and plugin
configurations, showing that entity's audit rows inline. This is where an administrator
actually looks when something has changed unexpectedly, so putting it next to the thing
matters more than the central log.

## API

```
GET  /api/instance/audit                       instance:read_audit
GET  /api/workspaces/{id}/audit                workspace:manage_settings
GET  /api/audit/entity/{type}/{id}             the entity's read capability (kind 1, chosen by `{type}` from the registry)
POST /api/instance/audit/export                instance:read_audit  E  (elevated — step-up)
GET  /api/work-items/{key}/reconstruct?at=…    work_item:read
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Very large before/after payload | Truncated at 64 KB with a marker; the full diff remains in `activity` for work items |
| Audit write fails | The mutation still succeeds (`AU-14`); error-level log line, alerting metric, and a notification to every instance administrator. Losing a mutation because auditing failed is worse than a gap — a deliberate, monitored trade |
| Clock skew across replicas | Timestamps come from the database, never from the application |
| Actor deleted | Rows retain the id and a tombstoned display name |
| Retention shortened | Applies from the next purge. The change is audited |

## Out of scope

- **A real-time audit stream or SIEM export.** `audit.exported` covers on-demand export;
  a push/webhook feed to an external SIEM is a plugin, if and when one is built
  ([plugin-architecture.md](../01-architecture/plugin-architecture.md)) — this spec
  defines the record, not a delivery mechanism beyond it.
- **A UI for editing or annotating an audit row.** Append-only means no such surface
  exists anywhere, by design (`AU-3`).
- **Cross-organisation audit search.** `AU-10`/`AU-11` already draw the reach boundary;
  searching across organisations is out of scope at every reach level, including
  `instance:read_audit`, which is instance-wide but still within one deployment.
- **Retention policy configuration UI** and **the `audit-purge`/`audit-verify` jobs'
  scheduling** → [background-jobs.md](../01-architecture/background-jobs.md).
- **Impersonation's own start/end mechanics** → the impersonation feature (P4 God Mode);
  this spec only defines that `impersonation.started`/`impersonation.ended` are audited
  and record both identities (`AU-4`).

## Testing

Integration: every mutating route writes an audit row — asserted generically by exercising
the route table and checking the count increases; secrets never appear in any row;
no endpoint can modify or delete a row.

Unit: reconstruction from activity produces the correct state at arbitrary instants,
including across a type change and a project move.

## Open questions

None.

## Related

- [Observability](../01-architecture/observability.md) · [Security model](../01-architecture/security-model.md)
- [Comments and activity](comments-and-activity.md)
