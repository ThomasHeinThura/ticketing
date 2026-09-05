# Audit trail

- **Phase:** P2
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** nothing

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

## Behaviour

- `AU-1` Rows record: actor id, actor IP, user agent, action, entity type, entity id,
  before, after, trace id, timestamp.
- `AU-2` **Secret values are never recorded.** A plugin configuration change records which
  keys changed, never what they changed to.
- `AU-3` Append-only. No API can update or delete a row. Enforced by database grants as
  well as by the absence of an endpoint.
- `AU-4` An impersonated action records **both** identities.
- `AU-5` System actions are attributed to the job or automation, never to a person.
- `AU-6` Retention purge deletes rows past the configured age and writes its own audit row
  saying how many.
- `AU-7` Deleting an organisation tombstones its audit rows rather than removing them.
  Deleting an audit trail on request defeats its purpose.

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
- `AU-13` Reading the audit log is itself audited, as is exporting it.
- `AU-14` **If the audit write fails, the mutation still succeeds** — losing a mutation
  because auditing failed is worse than a gap — but the failure is never silent: an
  error-level log line, an `audit_write_failures_total` metric that alerts, and a
  notification to every instance administrator, because the trade is acceptable only if
  someone finds out ([security-model.md](../01-architecture/security-model.md#audit)).
- `AU-15` Rows are **hash-chained**: `row_hash` is SHA-256 over the canonicalised row
  including `prev_hash`; the first row chains from the zero hash. `audit-verify` (on demand,
  and at every restore drill) walks the chain, so alteration by a database-level actor is
  detectable even though the application role holds no `UPDATE`/`DELETE` on the table
  ([data-model.md](../01-architecture/data-model.md) §11).

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
GET  /api/audit/entity/{type}/{id}             (capability for that entity)
POST /api/instance/audit/export                instance:read_audit + re-auth
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

## Testing

Integration: every mutating route writes an audit row — asserted generically by exercising
the route table and checking the count increases; secrets never appear in any row;
no endpoint can modify or delete a row.

Unit: reconstruction from activity produces the correct state at arbitrary instants,
including across a type change and a project move.

## Related

- [Observability](../01-architecture/observability.md) · [Security model](../01-architecture/security-model.md)
- [Comments and activity](comments-and-activity.md)
