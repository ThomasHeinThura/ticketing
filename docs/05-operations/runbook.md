# Runbook

What to do when something is wrong. Symptom-first, because that is how you arrive here.

Run the Compose commands below from the TaskDesk checkout on the host. On a production
host, select the same base and production overlay as `scripts/deploy.sh`:

```bash
dc() { docker compose -f compose.yml -f deploy/compose.prod.yml "$@"; }
```

For local development, use `dc() { docker compose -f compose.yml -f deploy/compose.local.yml -f deploy/compose.traefik.yml "$@"; }`.
The first-run `scripts/deploy.sh local` command sets up the local certificate and secrets.

**Metrics endpoint:** the serving API role starts a dedicated listener on port `9464` at
`GET /metrics`. Scrapes require the current bearer token; the listener reads its SHA-256
digest from PostgreSQL for each request. Rotate the token in God Mode → Observability and
store the one-time response directly in the monitoring system's secret store. Never put the
token in a command argument, log, ticket, or incident record. A missing or incorrect token
returns `401`; a database credential-read failure returns `503`. The listener bind failure
prevents API readiness. Migration and job roles do not start this listener.

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

AU-14 also writes an in-app notification for each current active instance administrator.
The notification contains only the finite operation name and occurrence time. The notifier
makes one bounded retry in a separate transaction after the audit savepoint has rolled back.
If both writes fail, the counter and safe error log remain the operator signals. Check the
administrators' in-app notifications alongside the matching metric and log record; neither
signal means the underlying mutation was rolled back.

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
| **Setup token expired or lost** | The token is short-lived and single-use. While `setup_completed_at` is null, **every container restart prints a fresh token and invalidates the previous one** ([auth-and-identity.md](../01-architecture/auth-and-identity.md)) — so run `dc restart taskdesk` and read the new one out of `dc logs taskdesk`. Nothing else is lost; no administrator exists yet |
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
dc exec taskdesk node dist/cli.js grant-instance-admin you@example.com
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

## Before upgrading to migration 0088 and later: applied-history check

The Drizzle migrator runs a pending migration only when its journal `when` is greater than the
newest `created_at` already recorded. If an environment ever applied different migrations with
higher timestamps (for example a deploy from a train branch before the spine landed), the spine
migrations at or below that timestamp are **silently skipped**. On every target database, before
upgrading:

```sql
select to_regclass('drizzle.__drizzle_migrations') as migrations_table;
select max(created_at) from drizzle.__drizzle_migrations;  -- skip if the first query returned null
```

- A **fresh or empty** database proceeds: `migrations_table` is null (no `drizzle` schema or
  table yet), or the table exists with zero rows (`max` is null). All migrations then run from the
  start.
- Otherwise the result must be exactly `1791107747302`, the value for an environment at accepted
  `main` (through `0087_romantic_sway`). If it is anything else, **stop**: do not upgrade, and ask
  the conductor to reconcile the applied history first.

---

## Upgrading across migration 0093: duplicate membership rows

Migration `0093_mature_exodus` replaces the non-unique `membership_personId_scope_scopeId_idx`
with the UNIQUE index `membership_person_scope_scope_id_unique` on
`(person_id, scope, scope_id)`. If the database already holds two membership rows for the same
person and scope, `CREATE UNIQUE INDEX` fails and **the whole upgrade aborts**: the Drizzle
migrator runs the pending migrations in one transaction, so nothing from 0088 onward is applied
and `__drizzle_migrations` is unchanged. The API runs migrations at startup (the migrate step in
`apps/api/src/index.ts`), so an affected deployment does not become ready until the duplicates
are removed. The failure is atomic and safe to retry.

**Preflight** (run on the target database before upgrading from any version below 0093; it must
return no rows):

```sql
select person_id, scope, scope_id, count(*)
from membership
group by 1, 2, 3
having count(*) > 1;
```

### Remediation, only if the preflight returns rows

Authority is **not** decided by `rank` alone. The permission resolver
(`apps/api/src/permissions/resolve-identity.ts`, `wellAnchored`, lines 491-530) unions every
membership row, but it ignores a row whose role does not belong to the scope's workspace, and a
person's capabilities are the union of their rows' roles. Deleting the wrong row can therefore
remove access (for example the only anchored row), keep a row the resolver ignores, or make
`sees_all` count when it did not. The `rank` collapse in `list-assignable-people.ts` is a display
rule only and is **not** a safe deletion rule.

Take the pre-upgrade backup first (see [backup-and-restore](backup-and-restore.md)). **Stop the
API (or keep it read-only) before block (a) and leave it stopped until block (b) has committed**, so
no membership row changes between the plan and the apply. Block (b) also takes a
`share row exclusive` lock on `membership`, recomputes the plan with the same query as (a) (a
temp view defined once in (a)), and refuses to act unless the recomputed plan is identical to the
reviewed plan on every column, in both directions. Any change to a planned row (role, scope,
`sees_all`, inheritance, or a deleted, moved or newly duplicated row) therefore stops it.
Then work in
**one interactive `psql` session** against the database, in this order. **Do not run either
block with `psql -f` or any unattended tool**: the review pause is the point. Keep the session
open between the blocks (the plan is a session temp table), and save the printed output in the
release record.

**(a) Plan.** Read-only apart from a temp table. It prints every row of every duplicate group
with its role's workspace, rank and capabilities, whether the row is anchored the way the
resolver requires, whether it is direct or inherited, and its `sees_all`.

```sql
drop table if exists pg_temp.membership_dedupe_plan;
drop table if exists pg_temp.membership_dedupe_plan_now;
drop view if exists pg_temp.membership_dedupe_plan_q;

-- The plan query, defined once. Block (b) re-runs exactly this view after locking.
create temp view membership_dedupe_plan_q as
with base as (
  select m.id, m.person_id, m.scope, m.scope_id, m.role_id, m.sees_all,
         m.inherited_from, m.derived_from, m.created_at,
         r.scope as role_scope, r.workspace_id as role_workspace_id,
         r.rank as role_rank, r.capabilities as role_capabilities,
         -- Same test as resolve-identity.ts `wellAnchored`: the role must belong to the scope's workspace.
         (r.scope = m.scope and (
            (m.scope = 'workspace'
               and exists (select 1 from workspace w where w.id = m.scope_id)
               and r.workspace_id = m.scope_id)
         or (m.scope = 'project'
               and exists (select 1 from project p where p.id = m.scope_id
                           and p.workspace_id is not null and r.workspace_id = p.workspace_id))
         or (m.scope = 'organisation'
               and exists (select 1 from organisation o where o.id = m.scope_id)
               and r.workspace_id is null)
         )) as anchored,
         (m.inherited_from is null and m.derived_from is null) as direct
  from membership m
  join role r on r.id = m.role_id
), grp as (
  select b.person_id, b.scope, b.scope_id, count(*) as group_size,
         count(distinct b.role_id) as distinct_roles,
         bool_and(b.anchored) as all_anchored,
         exists (select 1 from base a
                  where (a.person_id, a.scope, a.scope_id) = (b.person_id, b.scope, b.scope_id)
                    and not exists (select 1 from base c
                                     where (c.person_id, c.scope, c.scope_id) = (a.person_id, a.scope, a.scope_id)
                                       and not (c.role_capabilities <@ a.role_capabilities))) as caps_nested,
         bool_or(b.sees_all) filter (where b.anchored) as anchored_sees_all
  from base b
  group by 1, 2, 3
  having count(*) > 1
)
select b.*, g.group_size, g.distinct_roles, g.all_anchored, g.caps_nested, g.anchored_sees_all,
       -- Automatic only when every row is anchored AND all rows carry the same role.
       case when g.all_anchored and g.distinct_roles = 1 then 'AUTO' else 'MANUAL' end as decision,
       row_number() over (
         partition by b.person_id, b.scope, b.scope_id
         order by b.anchored desc, b.direct desc, b.role_rank desc, b.created_at asc, b.id asc
       ) as keep_order
from base b
join grp g using (person_id, scope, scope_id);

create temp table membership_dedupe_plan as select * from pg_temp.membership_dedupe_plan_q;

-- (1) Review EVERY row of every duplicate group. keep_order = 1 is the row that would be kept.
select person_id, scope, scope_id, id, decision, keep_order, role_id, role_workspace_id,
       role_rank, role_capabilities, anchored, direct, inherited_from, derived_from,
       sees_all, anchored_sees_all, caps_nested, created_at
from membership_dedupe_plan
order by person_id, scope, scope_id, keep_order;

-- (2) Groups that need a human. Must be resolved by hand before the apply block will run.
select person_id, scope, scope_id, group_size, distinct_roles, all_anchored, caps_nested
from membership_dedupe_plan
where decision = 'MANUAL'
group by 1, 2, 3, 4, 5, 6, 7;
```

Rules the plan applies. A group is `AUTO` only when **every** row is anchored **and** all rows
carry the **same** `role_id`. Then the rows differ only in provenance and `sees_all`: the kept row
(`keep_order = 1`) is the anchored, direct row before an inherited one, then higher rank, then the
oldest, and it takes `sees_all` from the anchored rows only. Every other group is `MANUAL`:
any mis-anchored row, any differing `role_id`, or capability sets that are not nested
(`caps_nested = false`). Nothing is deleted automatically for a `MANUAL` group.

For each `MANUAL` group, decide by hand which rows to remove, from the printed capabilities and
anchoring, and delete those rows by `id` yourself (a person must keep every capability they hold
through an anchored row, or the loss must be signed off by the owner of that workspace). Then
re-run block (a) to rebuild the plan (it drops and recreates the temp table); the second result
set must be empty.

**(b) Apply.** Run only when the second result set of (a) is empty. It refuses to run if any
`MANUAL` group remains or the plan is stale (after either error, run `rollback;` and re-run (a)), updates `sees_all` on the kept row,
and deletes the other rows of the `AUTO` groups, in one transaction.

```sql
begin;

-- Block writers on membership until commit, then refuse to act on a plan that no longer matches.
lock table membership in share row exclusive mode;

drop table if exists pg_temp.membership_dedupe_plan_now;
create temp table membership_dedupe_plan_now as select * from pg_temp.membership_dedupe_plan_q;

do $$
begin
  if exists (select 1 from membership_dedupe_plan where decision = 'MANUAL') then
    raise exception 'MANUAL duplicate groups remain: resolve them by hand and re-run the plan';
  end if;
  -- The plan, recomputed now under the lock, must equal the reviewed plan on every column.
  if exists (select * from membership_dedupe_plan except select * from membership_dedupe_plan_now)
     or exists (select * from membership_dedupe_plan_now except select * from membership_dedupe_plan) then
    raise exception 'stale plan: membership changed since block (a); roll back and re-run block (a)';
  end if;
end $$;

-- AUTO groups: every row is anchored and has the same role, so the rows differ only in
-- provenance and sees_all. The kept row (keep_order = 1: direct before inherited, then oldest)
-- takes sees_all from the anchored rows of its group.
update membership k
   set sees_all = true
  from membership_dedupe_plan p
 where p.id = k.id and p.keep_order = 1 and p.anchored_sees_all and not k.sees_all;

delete from membership
 where id in (select id from membership_dedupe_plan where keep_order > 1);

commit;
```

Re-run the preflight; it must return no rows. Then upgrade. Record the preflight result for every
target environment in the release record.

**Foreign keys into `membership`.** When upgrading from accepted `main` (through 0087) no table
references `membership`, so deleting rows cannot cascade or null anything. A database that already
applied 0090-0092 has `membership_grant.membership_id` and `scim_group_member.membership_id`
(`0090_unique_the_stranger.sql`), both `ON DELETE SET NULL`: deleting a duplicate nulls those
provenance links on rows pointing at it, so review them before deleting.

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

## Strict policy router cutover

`TASKDESK_POLICY_ENFORCE` is a temporary bootstrap control for strict request-path evaluation
(`apps/api/src/permissions/strict-policy-enforcement.ts`). It accepts a comma-separated list of
exact registered policy-source paths. The default is empty, so no source is enforced. A listed
source is evaluated after that route's existing middleware and request validation, immediately
before its terminal handler. Existing authorization checks continue to run; a registry denial
prevents the handler from starting. The setting is read and validated during API module startup.
An unknown, duplicate, blank, reordered, or malformed source refuses startup rather than
silently selecting a weaker policy set.

For a development or UAT rollout, first establish the documented three real, issue-free UTC
date buckets for the exact source and representative behaviors being considered (see **Policy
shadow summary** above). Record the source/build identity, selected UTC dates, route coverage,
complete summary output, and any explained outcomes with the deployment evidence. Do not
backfill missing observations or count a partial current day as a complete date. Only after
that evidence is accepted should the deployment's operator set the approved exact source list
and restart the API. Add eligible non-task sources in registry-owned path order; the complete
registered set must precede `apps/api/src/task/policy.ts`, which is required to be last. Do not
enable the task router until the role re-key prerequisite is verified and every preceding
source is already enforced. This staged setting does not authorize production promotion.

**Rollback:** remove the affected exact source path from the setting and restart the API. If
the task path is selected, remove it first before removing any preceding source. Setting the
value to empty and restarting returns all routes to their existing authorization plus shadow
mode. Confirm the running deployment's environment through the deployment's protected
configuration interface; never print environment values into a shell transcript or logs. Record
the rollback source/build and reason. A malformed setting intentionally prevents boot, so use
the last known-valid configuration when correcting a startup refusal.

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
