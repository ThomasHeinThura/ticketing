# Data protection

The position a customer's data-protection agreement will ask about, written down once.
Written 2026-09-05.

## Roles

A self-hosting customer is the **controller** and the operator; we are neither. When we
run an instance for a customer, we are the **processor** and this document is the technical
half of the DPA.

## Data inventory

| Data | Where | Retention | Erasure path |
| --- | --- | --- | --- |
| Work items, comments, attachments | Postgres + object storage | Life of the organisation; soft-delete 30 days | Organisation deletion ([multi-tenancy.md](../01-architecture/multi-tenancy.md)); per-person anonymisation |
| `activity` (the journal) | Postgres | Forever | Per-person anonymisation tombstones the actor; content stays |
| `audit_log` | Postgres | 12 months (configurable) | Never edited; organisation tombstoned; person anonymised |
| Sessions, API keys, invitations | Postgres | On expiry | Purged with the organisation |
| Notifications | Postgres | Read rows: configured `notification_retention_days` (90 d default); unread rows retained | `session-cleanup` purges only expired read rows; organisation hard delete purges all. Person anonymisation tombstones identity fields; recipient-linked rows remain subject to this retention rule |
| Notification event envelopes, delivery children, digest groups and `outbox_dedupe_reservation` | Postgres | Terminal notification children and groups: 30 d after terminal `updated_at`; terminal event envelopes: 30 d after terminal `updated_at`, only after retained children are gone. Pending children and their parents are retained. Reservation authority expires 60 s after last renewal; expired rows are physically removed by daily `session-cleanup` | Export includes children keyed to the recipient and applicable digest metadata. Person/organisation holds retain matching children, groups and parent events. Purge children before empty groups; purge a parent only after no child references it. Reservation stores recipient, channel and dedupe key; deleted on release, daily expiry cleanup (including during holds), or cascade from deleted delivery owner/person. Lease expiry ends authority immediately even if the row remains until cleanup. Organisation hard deletion removes scoped children, empty groups, unreferenced applicable events and reservations without dangling references |
| Idempotency responses | Postgres | 24 h | Purged with the organisation |
| Logs | Pino → the operator's sink | Operator-defined | Allowlist serialisation; no request bodies |
| Backups | Operator's storage | Stated in [backup-and-restore.md](backup-and-restore.md) | Deleted data persists in backups until they age out — stated, not hidden |

## Subject rights — per person

- **Export**: God Mode → Users → *Export data* (`GET /api/instance/users/{id}/export`,
  elevated) — everything keyed to the person as JSON.
- **Erasure / anonymisation**: God Mode → Users → *Anonymise* — name and email replaced
  with tombstones, `person.active = false`, credentials and sessions removed; authored
  content is retained (it belongs to the organisation), attributed to "Former member".
  Audit rows keep the tombstoned reference. This is the honest resolution of "the journal
  is forever" against "the right to be forgotten": identity is erased, history is not.
- Both are audited and elevated ([rbac.md](../01-architecture/rbac.md)).

**SCIM de-provisioning is not erasure.** When Microsoft Entra sends `active=false`, the
person is deactivated, sessions and personal keys are revoked and memberships end — but
name, email and authored content remain ([identity-provisioning.md](../03-features/identity-provisioning.md)
`IP-15`). Erasure is the separate elevated *Anonymise* action above, and it checks legal
hold first.

Notification retention is configurable in God Mode. Only read notifications older than
`instance_setting.notification_retention_days` are time-purged; unread notifications remain
until read or organisation hard deletion. Person anonymisation tombstones identity fields
but does not change this notification retention rule. The 90-day value is a default, not a
fixed limit. `outbox_dedupe_reservation` is short-lived coordination data, not
notification history: it carries the recipient person id, channel and dedupe key while a
delivery lease is active. Lease authority ends exactly at its expiry, but the expired row may
remain physically present until daily `session-cleanup` removes it; workers can reclaim it
as soon as it expires. Rows are also removed on release or when their delivery owner/person
is deleted. Event-envelope, child-delivery and digest retention is separate from read/unread
inbox retention; a pending or held child retains its parent event. The configured read-purge behavior and unread retention are
acceptance requirements in
[notifications.md](../03-features/notifications.md#in-app-inbox).

## Legal hold

A per-organisation or per-person **legal hold** (God Mode → Organisations / Users → *Place
on hold*, elevated, audited) suspends retention purge of matching audit rows, read
notifications, terminal notification children and digest groups, parent event envelopes,
attachments and soft-deleted business rows, and blocks
hard delete for that scope until the hold is lifted; anonymisation requests against a held
person are refused with the hold named. `session-cleanup` still expires credentials,
sessions, invitations, idempotency keys and preference handoffs during a hold. It also
physically removes expired `outbox_dedupe_reservation` rows during a hold: these short-lived
coordination rows are not evidence, and the lease is already invalid at expiry. The per-tenant
export above is the e-discovery export — one organisation's data, nothing else's, in a
documented JSON shape. Holds are listed on the Health screen so nobody forgets one is in
place.

Hold matching is row-specific. A person hold matches notification `person_id` and delivery
`recipient_person_id`. An organisation hold matches the recipient's organisation, the
source `organisation_id`, or the owning organisation of the referenced notification
resource; parent events also match their source scope. If resource ownership cannot be
resolved, retain the row while any organisation hold is open. Read notifications matching a
hold are kept beyond configured retention; unread rows are retained independently of holds.
Held terminal children, groups and parent event rows are kept beyond 30 days; pending
children are never retention-purged. A held child keeps its parent and may conservatively
retain shared group history. The exact child-before-parent job predicates are in
[background-jobs.md](../01-architecture/background-jobs.md#the-jobs).

It is a `legal_hold` row — `scope` (`organisation` \| `person`), `scope_id`, `placed_by`,
`placed_at`, `reason`, `lifted_by`, `lifted_at` — in [data-model.md](../01-architecture/data-model.md);
`audit-purge`, selected history-purge paths in `session-cleanup`, and `attachment-gc` skip
matching held rows; reservation expiry cleanup deliberately does not
([background-jobs.md](../01-architecture/background-jobs.md)), and placing or lifting a hold
is audited as `legal_hold.placed` / `legal_hold.lifted`.

## Processing locations and sub-processors

None inherent — the product phones home to nothing. Sub-processors are exactly the plugins
an administrator configures (SMTP relay, S3 provider, identity provider, AI provider,
Sentry, OTLP), listed live in God Mode → Plugins, which is the sub-processor register.

## Related

- [Security model](../01-architecture/security-model.md) · [Multi-tenancy](../01-architecture/multi-tenancy.md) · [Backup and restore](backup-and-restore.md)
