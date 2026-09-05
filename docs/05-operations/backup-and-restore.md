# Backup and restore

> v1's go-live checklist recorded: *"Scheduled backup never completed; `BACKUP_OFFSITE`
> unset."* An untested backup is not a backup.

## What must be backed up

| | Contains | Criticality |
| --- | --- | --- |
| **PostgreSQL** | Everything: work items, users, **and all runtime configuration** | Total loss |
| **Object storage** | Attachment bytes | Serious loss |
| **`.env`** | `TASKDESK_ENCRYPTION_KEY`, `TASKDESK_AUTH_SECRET` | Without the key, every configured integration must be re-entered |

The third is easy to forget and is the one that ruins a restore. **Configuration is data**
— identity providers, SMTP, storage, branding, feature flags, roles all live in Postgres,
and their secrets are encrypted with a key that lives only in `.env`.

Store the encryption key in a password manager, separately from the backups.

## Schedule

| | Frequency | Retention | Location |
| --- | --- | --- | --- |
| Postgres, production | Hourly | 48 hourly, 30 daily, 12 monthly | Local + offsite |
| Postgres, UAT | Daily | 7 daily | Local |
| Object storage | Daily incremental | 30 days | Offsite |
| Secrets | On change | Versioned | Password manager |

Offsite is not optional. A backup on the same host survives a bad migration and nothing
else.

## Method

**Postgres** — `pg_dump -Fc`, compressed, checksummed, encrypted at rest.

```bash
scripts/backup.sh              # dump, verify, upload, prune
```

The script verifies the dump is restorable — `pg_restore --list` at minimum — before
uploading. A dump that cannot be listed will not restore, and finding that out during an
incident is the worst possible time.

**Object storage** — `mc mirror` incremental to a second bucket in a different location.

**Both together** — the two must be restorable to a *consistent* point.

## Restore

Order matters.

```
1. Stop the application (leave Postgres running)
2. Restore Postgres
3. Restore object storage forward-only to the same point
4. Restore .env if the encryption key was lost
5. Start the application; migrations apply
6. Verify
```

**Why this order:** a database restored to yesterday alongside today's bucket shows
attachments the database does not know about, which is harmless. The reverse shows rows
whose objects are missing, which is not.

```bash
scripts/restore.sh --backup 2026-09-05T10-00 --confirm
```

## Verify a restore

Not a glance. A checklist:

- [ ] Sign in
- [ ] Open a project and a work item
- [ ] Download an attachment
- [ ] **God Mode → Health: every dependency green**
- [ ] **God Mode → Authentication: providers present and their secrets decrypt**
- [ ] **God Mode → Notifications: send a test email**
- [ ] **God Mode → Storage: test write succeeds**
- [ ] Feature flags as expected
- [ ] Roles and their capabilities intact
- [ ] Audit log present
- [ ] Row counts within expectation

Items 5 to 7 are the ones a naive restore test misses, and they are precisely what breaks
when the encryption key was not restored.

## Monthly restore drill

**Restore to a scratch environment, monthly, and record the result.**

A backup you have never restored is a hypothesis. The drill produces a written record:
date, backup used, time taken, checklist outcome, problems found.

v1 did one restore drill and documented it. That was better than most projects manage, and
it is the floor here, not the ceiling.

## Recovery objectives

| | Target |
| --- | --- |
| RPO — data we can afford to lose | 1 hour |
| RTO — time to restore service | 4 hours |
| RTO, single-node with local backup | 1 hour |

These drive the hourly schedule. If the business needs a lower RPO, that means continuous
archiving (WAL shipping), which is a decision to take deliberately rather than to drift
into.

## Point-in-time recovery

For production, WAL archiving gives recovery to any instant rather than to the last hourly
dump. Recommended once the instance carries real customer data.

```
archive_mode = on
archive_command = 'scripts/archive-wal.sh %p %f'
```

This changes RPO from one hour to seconds, at the cost of more storage and more operational
surface.

## Disaster scenarios

| Scenario | Response |
| --- | --- |
| Bad migration | Restore the pre-upgrade backup. **Migrations are forward-only**, so rolling back the image alone does not undo the schema — this is why destructive migrations are two-phase |
| Accidental deletion by a user | Soft delete gives a 30-day window; no restore needed |
| Accidental deletion of a workspace | Restore to a scratch instance, export the affected rows, re-import |
| Host lost | Provision a new host, restore both stores, repoint DNS |
| Object storage lost | Restore the bucket; the database is unaffected |
| **Encryption key lost** | Data survives. **Every plugin secret must be re-entered by hand.** This is the scenario the password manager exists to prevent |
| Ransomware | Offsite, immutable backups. Retention beyond the likely dwell time |

## Customer instances

Customers running their own instance are responsible for their own backups. We ship
`scripts/backup.sh` and `scripts/restore.sh`, document them in the user documentation, and
**God Mode → Health warns when no backup has been recorded in 48 hours**.

That warning matters. Most self-hosters do not set up backups, and a warning in the
product is more effective than a paragraph in a manual.

## Related

- [Deployment](deployment.md) · [Runbook](runbook.md)
- [Configuration reference](configuration-reference.md)
