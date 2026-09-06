# Environments

Three, plus whatever a customer runs.

| | Local | UAT | Production |
| --- | --- | --- | --- |
| Purpose | Development | Verification | Real work |
| Deploy | `scripts/deploy.sh local` | Automatic on merge to `main` | Manual promotion by digest |
| Data | Seeded | Anonymised copy of production | Real |
| TLS | Self-signed | Real certificate | Real certificate |
| Mail | Mailpit | Real SMTP, restricted recipients | Real SMTP |
| Backups | None | Daily | Hourly, offsite |
| Monitoring | None | Full | Full, alerting |
| Quality bar | — | **Production standard** | — |

## UAT is held to the production standard

Carried directly from v1's decision log, and worth restating.

A UAT that is allowed to be broken, slow or out of date stops being used. Then the first
real test of a change is production. So:

- UAT uses the same image, the same Compose overlay and the same resource limits.
- UAT is backed up and monitored.
- A broken UAT is a blocker, not a shrug.
- Alerts from UAT go somewhere a person reads. *(v1's UAT alert receiver was a log sink
  that nobody looked at — recorded as an open concern at go-live. Do not repeat it.)*

## Local

```bash
cp deploy/.env.example .env
scripts/deploy.sh local
```

Runs at `https://ticket.localhost` and `https://portal.localhost` via local Traefik with a
self-signed certificate.

Two hostnames means either `/etc/hosts` entries or `dnsmasq` for `*.localhost`. The script
prints exactly what to add.

**Do not use bare `docker compose up`.** v1 documented this as a trap and it applies here:
the script generates secrets, waits for health, applies migrations and probes the result.
Skipping it produces a stack that appears to be running and is not.

### Seed data

```bash
pnpm seed minimal      # 1 org, 1 project, 10 items — fast tests
pnpm seed realistic    # 5 orgs, 50 projects, 10k items, 200 people
pnpm seed hostile      # empty strings, 500-char titles, CJK, RTL, emoji, deep nesting
```

The hostile dataset finds more layout bugs than any other single technique. Use it before
declaring a screen done.

## UAT

- Hostnames: `ticket-uat.<domain>`, `portal-uat.<domain>`.
- Deployed automatically on merge to `main`.
- Database refreshed weekly from an anonymised production copy.

**Anonymisation** replaces names, emails, phone numbers and free text in comments and
descriptions, and drops attachments. Structure, volumes and timings are preserved, because
those are what make a realistic environment useful. The script lives at
`scripts/anonymise.ts` and is itself tested — an anonymiser with a bug is a data breach.

Outbound mail is restricted to an allowlisted domain, so a UAT notification cannot reach a
real customer.

## Production

- Hostnames: `ticket.<domain>`, `portal.<domain>` — and `files.<domain>` only when an
  operator-owned S3 endpoint is served behind this Traefik (`--profile s3`); on the default
  `storage.filesystem` there are two.
- Deployed by manual promotion of a digest already verified in UAT.
- Hourly database backups, offsite, with restore verified monthly.
- Full monitoring and alerting.

**Access:** production shell access is limited and audited. Routine operations —
configuration, user management, diagnostics — are done through God Mode, not through a
shell. If an operation requires a shell, that is a gap in God Mode and should be recorded
as one.

## Customer instances

Every customer runs their own instance of the same image, configured entirely through
God Mode.

- No customer-specific build, tag or branch.
- Upgrades are `scripts/deploy.sh upgrade`, which verifies the image's cosign signature before
  pulling ([deployment.md](deployment.md)); raw `docker compose pull && up -d` is the labelled
  no-verification fallback.
- Their configuration is theirs; we do not hold it.
- Support is by guiding them through God Mode, or by an audited impersonation session with
  their consent.

This is the whole reason for the plugin architecture. If a customer ever needs a code
change to be configured, that is a design failure, and it should be recorded as one in the
[decision log](../07-planning/decision-log.md).

## Promotion path

```
feature branch → PR (full CI) → main → UAT (automatic)
                                         │
                                    verify, smoke test
                                         │
                                         ▼
                              production (manual, by digest)
```

Never tag-based. The digest verified in UAT is the digest deployed to production, by
construction rather than by convention.

## Naming

| | Agent | Portal | Files |
| --- | --- | --- | --- |
| Local | `ticket.localhost` | `portal.localhost` | `files.localhost` |
| UAT | `ticket-uat.<domain>` | `portal-uat.<domain>` | `files-uat.<domain>` |
| Production | `ticket.<domain>` | `portal.<domain>` | `files.<domain>` |

Two hostnames per environment, three when the S3 profile is on. The third exists so attachments are served from an origin
that has no application on it — see
[storage and attachments](../01-architecture/storage-and-attachments.md).

## Related

- [Deployment](deployment.md) · [CI/CD](../04-engineering/ci-cd.md)
- [Backup and restore](backup-and-restore.md) · [Traefik and domains](traefik-and-domains.md)
