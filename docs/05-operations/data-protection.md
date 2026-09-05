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
| Notifications, outbox, idempotency responses | Postgres | 90 d / 30 d / 24 h | Purged with the organisation |
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

## Legal hold

A per-organisation or per-person **legal hold** (God Mode → Organisations / Users → *Place
on hold*, elevated, audited) suspends `audit-purge`, retention deletion and hard delete for
that scope until the hold is lifted; anonymisation requests against a held person are
refused with the hold named. The per-tenant export above is the e-discovery export — one
organisation's data, nothing else's, in a documented JSON shape. Holds are listed on the
Health screen so nobody forgets one is in place.

## Processing locations and sub-processors

None inherent — the product phones home to nothing. Sub-processors are exactly the plugins
an administrator configures (SMTP relay, S3 provider, identity provider, AI provider,
Sentry, OTLP), listed live in God Mode → Plugins, which is the sub-processor register.

## Related

- [Security model](../01-architecture/security-model.md) · [Multi-tenancy](../01-architecture/multi-tenancy.md) · [Backup and restore](backup-and-restore.md)
