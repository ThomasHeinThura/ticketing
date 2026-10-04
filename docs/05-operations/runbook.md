# Runbook

What to do when something is wrong. Symptom-first, because that is how you arrive here.

Run the Compose commands below from the TaskDesk checkout on the host. On a production
host, select the same base and production overlay as `scripts/deploy.sh`:

```bash
dc() { docker compose -f compose.yml -f deploy/compose.prod.yml "$@"; }
```

For local development, use `dc() { docker compose -f compose.yml -f deploy/compose.local.yml -f deploy/compose.traefik.yml "$@"; }`.
The first-run `scripts/deploy.sh local` command sets up the local certificate and secrets.

**Metrics endpoint status:** the architecture describes the intended Prometheus endpoint,
but the current API image does not start a listener on port `9464` and does not serve
`/metrics`. The metrics bearer-token setting is not usable yet. Use the container, database,
and application logs below; do not export a `METRICS_TOKEN` or rely on the metrics commands
until the endpoint is implemented and verified.

## Audit-write failure alert (after instrumentation is deployed)

The target urgent alert is `increase(taskdesk_audit_write_failures_total[5m]) > 0`, grouped
by the closed `operation` label. It is not active in the current image. When an alert fires,
preserve the alert timestamp and instance identity, then inspect that instance's application
logs for the matching safe error-level record and `traceId`:

```bash
dc logs --since=15m taskdesk
```

Use `operation` to distinguish a mutation audit append, a pending-action decision append, or
a pending-action self-read append. Confirm the operation's user-visible result and backing
row before asking a caller to retry: AU-14 mutations and pending-action decisions may have
committed even though their audit append failed; the pending-action self-read instead fails
closed. Treat the result as a known audit gap, not as evidence that the append-only hash chain
was altered. Record the affected time window and trace ids in the incident record without
copying credentials or request bodies.

The counter and log alert do not notify instance administrators. AU-14's durable
administrator notification remains an implementation dependency; do not report the
notification requirement as satisfied by this alert.

## Triage

1. **Is it up?** `curl https://ticket.<domain>/api/public/health/ready`
2. **Is it everything or one thing?** Check `dc ps`, TaskDesk logs and the database query below. The deep dependency endpoint is planned but not currently served.
3. **What changed?** Last deploy, last configuration change (God Mode → Audit)
4. **Who is affected?** Compare which workspaces and users report the issue; Sentry reporting is not currently implemented.
5. **Communicate before investigating.** A five-word status message buys an hour of quiet

---

## Symptoms

### First run

The install finished, and nobody has signed in yet. This is where the most likely incident
of an instance's whole life happens.

| Cause | Fix |
| --- | --- |
| **Setup token expired or lost before the first account is created** | The token is short-lived. While the user table is empty, restarting `taskdesk` prints a fresh token and invalidates the previous one ([auth-and-identity.md](../01-architecture/auth-and-identity.md)); read the new token from the service log. After the bootstrap account exists, restarting does not reissue a token or reopen registration; finish TOTP enrollment using that account. If its password and canonical email access are both lost before enrollment, no supported credential-recovery path is defined; do not repair the database directly. |
| Setup page says setup is already complete | Someone else claimed the first administrator. Sign in as them, or use break-glass below |
| Headless install created no administrator | `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` was unset. Set it and restart, or use the setup page |
| Certificate not issued on the first `up` | DNS did not point here when ACME ran. Fix the record and restart Traefik; the installer's pre-flight exists to catch exactly this ([one-line-install.md](one-line-install.md)) |
| `scripts/deploy.sh local` dies with "port 80/443 is already bound" | The host already runs something else on that port (Dokploy, nginx, another app). Set `TASKDESK_LOCAL_HTTP_PORT` / `TASKDESK_LOCAL_HTTPS_PORT` in `.env` to free ports and re-run — see [traefik-and-domains.md § Local development](traefik-and-domains.md#local-development) |

### Site is down

```bash
dc ps
dc logs --tail=200 taskdesk
curl -sf "https://ticket.${DOMAIN}/api/public/health/live"
```

For a local stack, use `https://ticket.localhost/api/public/health/live` (the local
self-signed certificate must be trusted by the client).

| Cause | Fix |
| --- | --- |
| Container crash-looping | Read the logs. Usually a bad migration or a missing env var |
| Postgres unreachable | Check the container; check `TASKDESK_DATABASE_URL` |
| Traefik not routing | On local development, use `dc logs traefik`. In production, inspect the host proxy's own Compose project or service; TaskDesk's production overlay does not own Traefik. Check `DOMAIN` and labels |
| Certificate expired | Check the ACME resolver; renew manually if needed |
| Disk full | `df -h`. Usually Postgres WAL or Docker logs |

### Slow

```bash
dc stats --no-stream taskdesk
dc exec -T postgres psql -U "${POSTGRES_USER:-taskdesk}" -d "${POSTGRES_DB:-taskdesk}" -c "select state, count(*) from pg_stat_activity where datname = current_database() group by state order by state;"
```

| Cause | Fix |
| --- | --- |
| DB connections high | Inspect the `pg_stat_activity` query above and TaskDesk logs for pool errors; pool waiters are not currently instrumented |
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
| MFA required, not enrolled | **Planned behavior:** after MFA enforcement is implemented, route the user to enrollment before protected use. Current API source has no factor enrollment/verifier; a required policy must fail closed until that support exists. |
| Portal boundary | A customer on the agent origin — this is correct behaviour |
| **All administrators locked out** | See break-glass below |

### Notifications not arriving

```bash
dc logs --since=1h taskdesk | grep -Ei 'outbox|notification' || true
dc exec -T postgres psql -U "${POSTGRES_USER:-taskdesk}" -d "${POSTGRES_DB:-taskdesk}" -c "select type, count(*) as notifications from notification where created_at > now() - interval '1 hour' group by type order by type;"
```

| Cause | Fix |
| --- | --- |
| No recent notification rows or logged send failures | Check the notification preferences and SMTP/ntfy settings; the current delivery path has no persistent outbox or retry queue |
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
dc exec -T postgres psql -U "${POSTGRES_USER:-taskdesk}" -d "${POSTGRES_DB:-taskdesk}" -c "select * from job_lease;"
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
dc exec taskdesk node apps/api/dist/cli.js grant-instance-admin you@example.com
```

Run it from an interactive terminal as the container's configured `taskdesk` service user;
the command refuses non-TTY or host-side execution and does not fall back to an
unconfigured local database. It works only after first-run setup is complete. Confirm the
recovery attestations and target in the prompt. A committed grant remains in effect if
SMTP is unavailable; the command reports aggregate delivery counts and directs the
operator to the host incident channel for any failed notices.

The CLI is a build target of the image (`apps/api/src/cli.ts` →
`apps/api/dist/cli.js`, [container-image.md](container-image.md)). The recovery command writes
an audit row with `actor_type = 'system'`, the effective container UID, and its passwd name.
The implemented command is:

| Command | Does |
| --- | --- |
| `grant-instance-admin <email>` | Break-glass: grants `instance:admin` to an existing person |

The command writes an `audit_log` row recording that break-glass was used. If it appears in
the audit log and nobody knows why, treat it as an incident.

---

## Rolling back

```bash
scripts/deploy.sh rollback <previous-digest> <release-tag>
curl -sf "https://ticket.${DOMAIN}/api/public/health/ready"
```

`deploy.sh rollback` verifies the cosign signature on the digest using the tag annotation
that was signed when that image was published, stores both values in `.env`, and brings
the service back with `--wait`. For example, pass `v2.0.0` when rolling back to a digest
published as `v2.0.0`. **Rolling back
onto an unverified digest is still a supply-chain decision** — which is why the manual
sequence below is the labelled fallback rather than the procedure. After an upgrade the
script prints a complete rollback command using the prior running container's digest and
configured image tag. If it cannot recover that signed tag, it says so instead of printing
a command that cannot pass verification:

```bash
dc down taskdesk                     # no signature verification
# edit TASKDESK_IMAGE_DIGEST in .env
dc up -d --wait taskdesk
```

**Migrations do not roll back.** If the release included a destructive migration, a code
rollback alone will not work — restore the pre-upgrade backup. This is why destructive
migrations are two-phase, and why the pre-upgrade backup is mandatory.

---

## Verify a published image

Resolve the release tag to a digest first, then check both the cosign signature and the
GitHub build-provenance attestation for that immutable digest. Replace the example digest
with the value printed by `docker buildx imagetools inspect`.

```bash
IMAGE_TAG='v2.0.0' # use edge for the UAT edge channel
SOURCE_SHA='<40-hex-main-commit>'
IMAGE_REF='ghcr.io/thomasheinthura/taskdesk@sha256:<64-hex-digest>'
cosign verify \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --certificate-identity 'https://github.com/ThomasHeinThura/ticketing/.github/workflows/release.yml@refs/heads/main' \
  --annotations "tag=${IMAGE_TAG}" \
  --annotations "source_sha=${SOURCE_SHA}" \
  "$IMAGE_REF"
gh attestation verify "oci://${IMAGE_REF}" \
  --repo ThomasHeinThura/ticketing \
  --signer-workflow ThomasHeinThura/ticketing/.github/workflows/release.yml \
  --source-ref refs/heads/main \
  --predicate-type 'https://slsa.dev/provenance/v1'
gh attestation verify "oci://${IMAGE_REF}" \
  --repo ThomasHeinThura/ticketing \
  --signer-workflow ThomasHeinThura/ticketing/.github/workflows/release.yml \
  --source-ref refs/heads/main \
  --predicate-type 'https://github.com/ThomasHeinThura/ticketing/attestations/release-source/v1' \
  --format json \
  | jq -e --arg repo 'ThomasHeinThura/ticketing' \
      --arg source "$SOURCE_SHA" \
      --arg image 'ghcr.io/thomasheinthura/taskdesk' \
      --arg digest "${IMAGE_REF##*@}" \
      'any(.[]; .verificationResult.statement.predicate.sourceRepository == $repo and
        .verificationResult.statement.predicate.sourceRef == "refs/heads/main" and
        .verificationResult.statement.predicate.sourceCommit == $source and
        .verificationResult.statement.predicate.image == $image and
        .verificationResult.statement.predicate.imageDigest == $digest)'
```

All three checks (cosign signature, workflow SLSA provenance, and the selected-source
predicate) must succeed before promoting a digest. The GitHub attestation checks also
require GitHub CLI authentication with read access to the repository. The SLSA predicate
identifies the workflow run that published the image; the separate signed TaskDesk
predicate binds that image digest to the validated source SHA, including when a manual
release selects an older commit on `main`.

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

## Policy shadow summary

Issue #8, Slice 2's request-path shadow middleware records every request it evaluates to
`policy_shadow_tally` and, for a disagreement, `policy_shadow_event`
([data-model.md § Policy shadow evidence](../01-architecture/data-model.md#policy-shadow-evidence-issue-8-slice-2)).
For development/P0 and UAT verification, this per-router summary reports the user-authorized
three UTC calendar-date window — run against the deployment's own database, not exposed as an
HTTP endpoint. It does not establish production readiness or authorize production promotion;
production-specific go-live criteria apply only when promoting an actual production release.

**Per-router, per-date development summary for three UTC dates** (UTC today and the preceding
two dates; agree / disagree / unevaluated counts, by router group and outcome):

```sql
select
  day as utc_day,
  router_group,
  outcome,
  reason_code,
  sum(count) as total,
  max(last_seen_at) as last_seen_at
from policy_shadow_tally
where day >= ((now() at time zone 'UTC')::date - 2)
group by day, router_group, outcome, reason_code
order by day, router_group, outcome, total desc;
```

The inclusive predicate selects exactly three UTC date buckets. Record the selected date
values, source/build identity, and actual source-bound UTC coverage interval with the result.
The current UTC date may be partial: the date buckets alone do not prove three complete days
or 72 hours. Claim three issue-free days only when actual traffic and exercised router/behavior
coverage support all three dates; do not synthesize or backfill missing observations. Existing
representative evidence may count if it covers the same source and behavior.

**"Clean" means zero *unexplained* disagreements** — every `legacy_allow_policy_deny`,
`legacy_deny_policy_allow`, `unevaluated` and `evaluator_error` row above for a router group
must either be fixed or have its `reason_code` explained in the evidence for the window being
assessed. Record each summary output as it stood at decision time so later writes cannot
change the evidence underneath it (the Opus review of #323, S7). Any decision citing this query
must paste the complete output and identify its environment and window; a P0/UAT summary is
not production evidence. **`shadow_saturated` is never explainable row-by-row**: a router with
any such row in the window is not clean, because part of its traffic was never evaluated (the
Opus delta of #323, D1).

The three-day window applies to P0 development and UAT verification; it is not a seven-day UAT
cutover prerequisite. Actual production promotion remains subject to its production-specific
go-live criteria, which this development query does not satisfy or change.

An event cap can omit details after 50 matching events in a bucket. A non-agree tally bucket
whose count exceeds its event-row count is therefore not explained row by row and cannot be
declared clean. Check for such buckets before reviewing the event details:

```sql
select t.day, t.route_key, t.outcome, t.reason_code,
       t.count as tally_count, count(e.id) as event_count
from policy_shadow_tally t
left join policy_shadow_event e
  on e.day = t.day
 and e.route_key = t.route_key
 and e.outcome = t.outcome
 and e.reason_code is not distinct from t.reason_code
where t.day >= ((now() at time zone 'UTC')::date - 2)
  and t.outcome <> 'agree'
group by t.day, t.route_key, t.outcome, t.reason_code, t.count
having t.count > count(e.id)
order by t.day, t.route_key, t.outcome;
```

**Latest disagreements for one router**, to see exactly what tripped:

```sql
select route_key, outcome, reason_code, legacy_status, policy_status, policy_code,
       identity_kind, workspace_id, trace_id, created_at
from policy_shadow_event
where router_group = :router_group
order by created_at desc
limit 50;
```

**Coverage check** — this reports observed requests per router and UTC date. Compare each
required router group against all three selected dates; a missing date means coverage for that
router is not established and the window is not clean:

```sql
select day as utc_day, router_group, sum(count) as requests_evaluated
from policy_shadow_tally
where day >= ((now() at time zone 'UTC')::date - 2)
group by day, router_group
order by day, requests_evaluated asc;
```

**Coverage share, before vs after a cutover** (issue #324 acceptance criterion 6) — per
router group, what fraction of requests actually got a full policy comparison
(`agree`/`legacy_allow_policy_deny`/`legacy_deny_policy_allow`) rather than
`unevaluated`/`evaluator_error`, split by a chosen cutover day (a deploy date, a slice
boundary, or any other date worth comparing across). Substitute the literal date for
`:cutover_day` — this is a documented query, not a bound parameter:

```sql
select
  router_group,
  round(100.0 * coalesce(sum(count) filter (
    where day < :cutover_day
      and outcome in ('agree', 'legacy_allow_policy_deny', 'legacy_deny_policy_allow')
  ), 0) / nullif(sum(count) filter (where day < :cutover_day), 0), 1) as evaluated_pct_before,
  sum(count) filter (where day < :cutover_day) as total_before,
  round(100.0 * coalesce(sum(count) filter (
    where day >= :cutover_day
      and outcome in ('agree', 'legacy_allow_policy_deny', 'legacy_deny_policy_allow')
  ), 0) / nullif(sum(count) filter (where day >= :cutover_day), 0), 1) as evaluated_pct_after,
  sum(count) filter (where day >= :cutover_day) as total_after
from policy_shadow_tally
group by router_group
order by router_group;
```

A blank `evaluated_pct_before`/`evaluated_pct_after` means that window has no rows at all
for that router group (never exercised in that window), distinct from `0.0` (exercised, but
nothing evaluated) — `nullif`/`coalesce` are load-bearing for exactly that distinction, not
decoration. Verified against a scratch database seeded with known before/after counts per
router group (mixed evaluated/unevaluated, one group with data only before the cutover, one
only after) before this was committed.

## Useful commands

```bash
dc logs -f taskdesk
dc exec postgres psql -U "${POSTGRES_USER:-taskdesk}" -d "${POSTGRES_DB:-taskdesk}"
docker stats
df -h && du -sh /var/lib/docker/volumes/*
```

## Related

- [Deployment](deployment.md) · [Backup and restore](backup-and-restore.md)
- [Observability](../01-architecture/observability.md) · [Scaling](scaling.md)
