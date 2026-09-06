# Runbook

What to do when something is wrong. Symptom-first, because that is how you arrive here.

**Before the metrics commands below will work:** `export METRICS_TOKEN=…`, copied from God
Mode → Observability. It is **not** an environment variable of the container and there is no
`TASKDESK_METRICS_TOKEN` — the token is runtime configuration like everything else
([configuration-reference.md](configuration-reference.md)). `/metrics` is served on its own
listener, port **9464**, which is not routed through Traefik
([observability.md](../01-architecture/observability.md)); the health endpoints are on the
application port as usual.

## Triage

1. **Is it up?** `curl https://ticket.<domain>/api/public/health/ready`
2. **Is it everything or one thing?** `/api/instance/health/deep` lists each dependency (an `instance:admin` session — the metrics token does not grant it)
3. **What changed?** Last deploy, last configuration change (God Mode → Audit)
4. **Who is affected?** One organisation or all — Sentry tags by organisation
5. **Communicate before investigating.** A five-word status message buys an hour of quiet

---

## Symptoms

### First run

The install finished, and nobody has signed in yet. This is where the most likely incident
of an instance's whole life happens.

| Cause | Fix |
| --- | --- |
| **Setup token expired or lost** | The token is short-lived and single-use. While `setup_completed_at` is null, **every container restart prints a fresh token and invalidates the previous one** ([auth-and-identity.md](../01-architecture/auth-and-identity.md)) — so `docker compose restart taskdesk` and read the new one out of `docker compose logs taskdesk`. Nothing else is lost; no administrator exists yet |
| Setup page says setup is already complete | Someone else claimed the first administrator. Sign in as them, or use break-glass below |
| Headless install created no administrator | `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` was unset. Set it and restart, or use the setup page |
| Certificate not issued on the first `up` | DNS did not point here when ACME ran. Fix the record and restart Traefik; the installer's pre-flight exists to catch exactly this ([one-line-install.md](one-line-install.md)) |

### Site is down

```bash
docker compose ps
docker compose logs --tail=200 taskdesk
curl -sf localhost:5173/api/public/health/live
```

| Cause | Fix |
| --- | --- |
| Container crash-looping | Read the logs. Usually a bad migration or a missing env var |
| Postgres unreachable | Check the container; check `TASKDESK_DATABASE_URL` |
| Traefik not routing | `docker compose logs traefik`; check `DOMAIN` and labels |
| Certificate expired | Check the ACME resolver; renew manually if needed |
| Disk full | `df -h`. Usually Postgres WAL or Docker logs |

### Slow

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" localhost:9464/metrics | grep -E 'duration|pool|eventloop'
```

| Cause | Fix |
| --- | --- |
| DB pool exhausted | `db_pool_waiting > 0`. Find the long-running query; consider raising the pool |
| Slow query | `pg_stat_statements`; `EXPLAIN ANALYZE`; add an index |
| Event loop lag | A job is hogging the loop — check which is running and whether it is chunked |
| Valkey down | Degraded, not broken. Restart it |
| Large unbounded response | Something is not paginating. Find it |

### Cannot sign in

**Do not start by changing configuration.** Establish which of these it is:

| Cause | Check |
| --- | --- |
| Identity provider misconfigured | God Mode → Authentication → **Test connection** |
| Provider certificate expired | The test reports it |
| Session secret rotated | Everyone signed out at once — expected, communicate it |
| Account suspended | God Mode → Users |
| MFA required, not enrolled | The user is routed to enrolment; confirm they see it |
| Portal boundary | A customer on the agent origin — this is correct behaviour |
| **All administrators locked out** | See break-glass below |

### Notifications not arriving

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" localhost:9464/metrics | grep outbox
```

| Cause | Fix |
| --- | --- |
| `outbox_pending` rising | Delivery failing. God Mode → Notifications → test |
| `outbox_dead > 0` | Six attempts failed. Inspect the error, fix, redeliver |
| SMTP rejecting | Test in God Mode; the real error is shown |
| Webhook endpoint down | Delivery history shows status codes. Auto-disabled after 24 h |
| User preference off | Not a fault |

### SLA numbers look wrong

Remember: **SLA is computed on read**, never stored. So there is no stored value to be
wrong — the inputs are wrong.

| Cause | Check |
| --- | --- |
| Wrong service calendar | Project settings → SLA; the calendar name is shown on the badge |
| Missing holidays | Calendar editor; the preview shows annual cover hours |
| Timezone | The calendar's timezone, not the viewer's |
| Unclosed pause | A work item stuck in a pausing state; the stale-paused report lists them |
| Policy version | An item created before a policy change uses the earlier version. This is correct |

### Jobs not running

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" localhost:9464/metrics | grep job_last_success
psql -c "select * from job_lease;"
```

| Cause | Fix |
| --- | --- |
| Lease held by a dead replica | Wait one TTL, or delete the row |
| Job disabled | God Mode → Jobs |
| Job erroring | Logs; run manually from God Mode to reproduce |

### Attachments failing

| Cause | Fix |
| --- | --- |
| Storage unreachable | God Mode → Storage → test |
| Credentials rotated | Re-enter in God Mode |
| Bucket full or quota hit | Check usage |
| Presign rejected by the storage endpoint | **The configured public endpoint is not the browser-facing origin.** A SigV4 signature covers the `Host` header, so a URL signed for the internal endpoint fails when the browser fetches it at the files origin. God Mode → Storage → public endpoint must equal what the browser sees ([deployment.md](deployment.md)) |
| Presign accepted, browser upload blocked | The **bucket's** CORS does not allow the agent and portal origins. This is bucket configuration, not a Traefik middleware |
| Presign failing | Clock skew between the app and the object store breaks signatures |
| Bucket does not exist | The `--profile s3` bucket-create step did not run. Re-run `scripts/deploy.sh` |

---

## Break-glass: all administrators locked out

Requires database access. Every step is audited.

```bash
docker compose exec taskdesk node dist/cli.js grant-instance-admin you@example.com
```

The CLI is a build target of the image (`apps/api/src/cli.ts` → `dist/cli.js`,
[container-image.md](container-image.md)). Every command writes an audit row with
`actor_type = 'system'` and the invoking OS user. Commands:

| Command | Does |
| --- | --- |
| `grant-instance-admin <email>` | Break-glass: grants `instance:admin` to an existing person |
| `disable-auth-plugin <id>` | Disables an identity provider and bumps `config_version` so every replica reloads ([auth runtime reconfiguration](../01-architecture/auth-runtime-reconfiguration.md)) |
| `verify-backup <file>` | `pg_restore --list` plus a decrypt check of one plugin secret against the current key |
| `rekey-status` | Progress of `secrets-rekey`: rows on the new `key_id` vs total |

The command writes an `audit_log` row recording that break-glass was used. If it appears in
the audit log and nobody knows why, treat it as an incident.

---

## Rolling back

```bash
scripts/deploy.sh rollback <previous-digest>
curl -sf localhost:5173/api/public/health/ready
```

`deploy.sh rollback` verifies the cosign signature on the digest it is about to run, sets
`TASKDESK_IMAGE_DIGEST` in `.env`, and brings the service back with `--wait`. **Rolling back
onto an unverified digest is still a supply-chain decision** — which is why the manual
sequence below is the labelled fallback rather than the procedure:

```bash
docker compose down taskdesk         # no signature verification
# edit TASKDESK_IMAGE_DIGEST in .env
docker compose up -d --wait taskdesk
```

**Migrations do not roll back.** If the release included a destructive migration, a code
rollback alone will not work — restore the pre-upgrade backup. This is why destructive
migrations are two-phase, and why the pre-upgrade backup is mandatory.

---

## Incident procedure

1. **Contain** — revoke sessions, disable the affected plugin or account, take it offline
   if that is safer than leaving it up.
2. **Communicate** — tell affected users something true, early. Silence is worse than
   "we're investigating".
3. **Assess** — the audit log is the source of truth for what was touched and by whom.
4. **Notify** — affected organisations, per contractual obligation, within the required
   window.
5. **Remediate** — fix, add a regression test, deploy.
6. **Review** — write it up. Root cause, timeline, what was slow, what to change.
   Blameless: the question is what in the system allowed it, not who did it.
7. **Record** — add the lesson to [error-fix-loop.md](../04-engineering/error-fix-loop.md)
   and, if it changed a decision, to the [decision log](../07-planning/decision-log.md).

---

## Routine operations

| Task | How |
| --- | --- |
| Add a customer organisation | God Mode → Organisations → New |
| Add an identity provider | God Mode → Authentication → Add, then **Test** |
| Suspend a user | God Mode → Users |
| Change SMTP | God Mode → Notifications, then **Test** |
| Enable or disable a feature | God Mode → Features |
| Trigger a job | God Mode → Jobs → Run now |
| Rotate the encryption key | Operator-staged: set `TASKDESK_ENCRYPTION_KEY` (new) + `TASKDESK_ENCRYPTION_KEY_PREVIOUS` (old), restart, then God Mode → Plugins → Rotate secrets (elevated) runs `secrets-rekey`; remove the previous key when Health confirms every row carries the new `key_id`. `GM-12`–`GM-14` |
| Export the audit log | God Mode → Audit → Export |

**Almost nothing here needs a shell.** If a routine operation does, that is a gap in
God Mode and should be recorded as one.

---

## Useful commands

```bash
docker compose logs -f taskdesk
docker compose exec postgres psql -U taskdesk
curl -s -b "$ADMIN_SESSION_COOKIE" localhost:5173/api/instance/health/deep | jq   # instance:admin session; the metrics token does not grant this
curl -s -H "Authorization: Bearer $METRICS_TOKEN" localhost:9464/metrics | grep taskdesk_
docker stats
df -h && du -sh /var/lib/docker/volumes/*
```

## Related

- [Deployment](deployment.md) · [Backup and restore](backup-and-restore.md)
- [Observability](../01-architecture/observability.md) · [Scaling](scaling.md)
