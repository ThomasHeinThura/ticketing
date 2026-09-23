# Security review: split db roles so the api never runs as postgres superuser (#296)

**Reviewer:** Opus 5.5, fresh independent context. I did not author, direct or remediate this change.
**Reviewed head:** `5e2164f9c896e9133e556992a726068e095dc379`
**Reviewed SHA:** `5e2164f9c896e9133e556992a726068e095dc379`. Confirmed with `gh pr view 308 --json headRefOid`.
The last code change is `1d75a11`, plus the conflict resolution in `5299302`, which only keeps
`main`'s policy-registry import and log line in `index.ts`. `git diff 5299302 aaa19be -- . ':!docs'`
is empty. `8de4b51` and `aaa19be` change docs only. `5e2164f` is a `main` merge, and its diff
against its `main` parent is exactly the PR's 24 files.
**Pull request:** #308 (issue #296)
**Date:** 2026-09-23

## Verdict

**CHANGES NEEDED.** There are two blocking findings.

- **S1.** The owner/superuser credential still sits in the long-running API process's
  environment.
- **S2.** On any failed role create or alter, the application role's password is written in
  plaintext to the API log and to the Postgres server log.

The grant mechanics hold under every SQL-level probe I ran (see Probes). The boot check is
sound except for one predefined-role gap (S3).

## Surfaces examined

- `apps/api/src/database/ensure-application-role.ts`,
  `assert-application-role-is-not-privileged.ts`, `resolve-database-url.ts`,
  `append-only-tables.ts`, `index.ts` (both pools, `closeMigrationPool`),
  `prepare-database-startup.ts`
- `apps/api/src/index.ts` (`runStartupTasks`, `startServer` error handler), and the four
  `utils/migrate-*.ts` callers
- `compose.yml`, `deploy/.env.example`, `deploy/entrypoint.sh`, `scripts/deploy.sh`
  (`generate_if_empty`, `chmod 0600`)
- `charts/taskdesk/templates/deployment.yaml`, `validations.yaml`, `values.yaml`, `README.md`
- Migrations `0066` (the `activity` foreign key) and `0067` (the `audit_log` triggers and
  `audit_log_reject_mutation()`)
- Decision log: the two newest entries on the branch, and "`audit_log` is append-only by
  trigger, not by grant", including #291 S5's residual-risk paragraph. Also AU-3 in
  `audit-trail.md` and `configuration-reference.md` (roles, Optional, Local development).
- `tests/api-integration/db-application-role.test.ts`

## Probes

Environment: private DB `pr308_opus_test` for the suites, and a second private DB
`pr308_opus_probe_test` for the probes, both on td-lane-pg (PostgreSQL 18.6). To mirror
compose, a scratch superuser owner `pr308_opus_owner` ran the real `migrate()`, the four
`migrate-*` fixups, `ensureApplicationRole` and `assertApplicationRoleIsNotPrivileged`
through a throwaway `tsx` harness. The harness mirrors `runStartupTasks`' DB steps, and it
was never committed. The app role was `taskdesk_app_pr308opus`, and its password contained
`'` and `$$`. Every probe DB and role was dropped afterwards.

1. **The threat model, as the app role over SQL.** Every one of these was denied:
   - `TRUNCATE`, `UPDATE` and `DELETE` on `audit_log` and on `activity`;
   - `ALTER TABLE audit_log DISABLE TRIGGER ALL` and `DISABLE TRIGGER audit_log_append_only`;
   - `DROP TRIGGER`, `CREATE RULE … DO INSTEAD NOTHING`, and `CREATE TRIGGER` on `activity`;
   - `SET session_replication_role = replica` ("permission denied to set parameter");
   - `CREATE TABLE`, `CREATE FUNCTION … SECURITY DEFINER` and `CREATE SCHEMA` in `public`
     (PG15+ semantics; Helm ships PG16 and compose PG18);
   - `COPY … TO PROGRAM`, `COPY … TO` a file, `lo_import`, `lo_export` and `pg_read_file`;
   - `pg_terminate_backend` against the owner's backends and against `postgres`;
   - `ALTER TABLE … OWNER`, `ALTER ROLE … SUPERUSER` or `CREATEROLE`, `GRANT <owner> TO self`
     and `SET ROLE <owner>`;
   - `CREATE EXTENSION dblink`, `ALTER SYSTEM`, `ALTER DEFAULT PRIVILEGES FOR ROLE <owner>`,
     `CREATE PUBLICATION` and `CREATE SUBSCRIPTION`.

   `has_table_privilege` on both append-only tables was false for UPDATE, DELETE, TRUNCATE,
   TRIGGER and REFERENCES. No `public` object carries a PUBLIC ACL. The app role can still
   create `TEMP` tables and `pg_temp` functions, which are session-local and cannot reach
   another session. The migration pool is closed before the app pool is first used.
2. **The foreign-key `ON DELETE` trick.** `activity` → `work_item` is `ON DELETE CASCADE`
   (`0066`), and the app role holds `DELETE` on `work_item`. I reproduced the pattern on a
   scratch parent/child pair with the same grant shape (child `SELECT, INSERT` only): the
   direct `DELETE` on the child was denied, and `DELETE` on the parent removed every child
   row. This is S4. On `audit_log` the only foreign key is to `organisation`, with
   `ON DELETE SET NULL` and `ON UPDATE CASCADE`. The trigger permits only the tombstone after
   deletion, and rejects any reassignment.
3. **Boot check.** The seven membership and ownership probes from the test file pass (25/25).
   I also granted each of the following to the app role in turn and re-ran boot:
   - `pg_write_all_data`: boot **passes**. Afterwards `has_table_privilege('activity','DELETE')`
     and `('audit_log','UPDATE')` are both true, and `DELETE FROM activity` succeeds. This is S3.
   - `pg_maintain`, `pg_create_subscription`, `pg_checkpoint`, `pg_monitor`: boot passes. None
     of them grants data modification. `pg_create_subscription` also needs `CREATE` on the
     database, which the app role lacks.

   Single-URL mode fails closed. As a superuser owner, boot refused on `rolsuper`. As a
   non-superuser who owns a table, it refused on the `pg_class` ownership check. The
   `POSTGRES_*` derivation fallback resolving to a superuser also refused.
4. **`ALTER DEFAULT PRIVILEGES`.** It is applied `FOR ROLE <current_user of the migration
   connection>`. A table created later by that role got `arwd` for the app role, as expected.
   If the migration role is ever changed to a different, non-superuser role, the per-boot
   `REVOKE`/`GRANT` loop only emits `WARNING: no privileges were granted` on tables it does not
   own. That fails closed (the app loses access) and is not an escalation. Tables created in the
   same boot are covered by the loop, which runs after `migrate()`.
5. **Credentials.**
   - Compose passes `TASKDESK_MIGRATION_DATABASE_URL` to the `taskdesk` (API) service
     (`compose.yml:52`).
   - Helm sets it in the API Deployment's container env (`deployment.yaml:141`, `:148`), inline
     in the pod spec unless `existingSecret` is used. No ConfigMap is rendered: I rendered the
     bundled, existing-secret and external+migration variants and found no ConfigMap, and no
     password outside Deployment env.
   - Nothing removes the variable from the environment after boot. `closeMigrationPool` only
     closes the pool.
   - I checked that deleting from `process.env` would not help either: after
     `delete process.env.X`, `/proc/self/environ` still contains `X=…` (verified with node 24).
   - `deploy.sh` generates `TASKDESK_APP_DB_PASSWORD` with `openssl rand -hex 32` into a `0600`
     `.env`, never echoes a value, and never regenerates an existing one. That is fine.
   - `prepareDatabaseStartup` logs only `logConfig` (source, host, port, database, username).
6. **Password leak on failure.** I ran `ensureApplicationRole` with a non-superuser owner that
   lacks `CREATEROLE`. That is the realistic shape of a BYO or Helm-external
   `migration.enabled` owner. The thrown `DrizzleQueryError` message is
   `Failed query: CREATE ROLE "…" LOGIN PASSWORD 'S3cretLeakMarker' …`. `startServer` prints it
   (`index.ts:1093`), and so does `prepareDatabaseStartup` (`:47`). td-lane-pg's server log
   recorded `STATEMENT: CREATE ROLE … PASSWORD 'S3cretLeakMarker'` as well, through the default
   `log_min_error_statement=error`. This is S2.
7. **Upgrade path, reasoned from code.**
   - Compose refuses to interpolate without `TASKDESK_APP_DB_PASSWORD`, which `deploy.sh`
     generates. The old owner keeps ownership: the new code runs no ownership-changing DDL and
     only `REVOKE`/`GRANT`s the app role.
   - In split mode the app pool never connects as the owner. `TASKDESK_DATABASE_URL` is always
     `taskdesk_app`, and no request is served before `assertApplicationRoleIsNotPrivileged`.
   - There is no data-loss path.
   - Helm with bundled PG fails the template without `appPassword`.
   - Helm with an external database left at the default `migration.enabled: false`, and any
     existing single-URL deployment, will now **refuse to boot**. The single role owns the
     tables, so it trips the ownership check. That fails closed, but it is a breaking upgrade
     (S5).
8. **Suites at this head.**
   - `db-application-role.test.ts`: 25/25.
   - Full integration: 76 files, 1054 tests, all passed.
   - API unit (`vitest.config.ts`): 52 files, 349 tests, all passed.
   - `node --test 'scripts/ci/**/*.test.mjs'`: 495/495.
   - `helm lint`: clean. `helm template` passed for bundled, existing-secret and
     external+migration, and a missing `appPassword` fails loudly. Helm was v3.15.4 from the
     scratchpad.
   - I did not run `docker build` or a container boot. The ordinary review already did, and none
     of these findings depends on the image: S1 can be read straight from `compose.yml` and the
     rendered Deployment.

## Findings

### S1 — BLOCKING: the owner/superuser credential stays in the serving process's environment

- **Where:** `compose.yml:52`, `charts/taskdesk/templates/deployment.yaml:141-155`,
  `apps/api/src/database/resolve-database-url.ts:104`, and `database/index.ts:282`
  (`closeMigrationPool` closes the pool, but the URL stays in `process.env` and
  `/proc/self/environ`).
- **What:** migrations run inside the same long-running API process, so that process is started
  with `TASKDESK_MIGRATION_DATABASE_URL`. That is the image-init superuser's credential, and it
  stays there for the process's whole life. Any compromise at process level (RCE, a malicious
  dependency, or an arbitrary file read of `/proc/self/environ`) can therefore connect as the
  superuser and `DISABLE TRIGGER`, `CREATE RULE`, `TRUNCATE`, or `COPY … TO PROGRAM`.
- **What the split does protect:** SQL-level compromise through the app pool, meaning SQL
  injection or bad queries issued by the app. That is a real gain, and I verified it above.
- **Why it blocks:** the change and its record claim more than that.
  - `compose.yml:36-39` says "a compromised API process cannot disable the append-only
    triggers/grants".
  - The decision log's "Why" (`decision-log.md:61-63`) says this closes the "compromised API
    process" item from #291 S5.
  - The same entry and AU-3 say the owner credential "must stay operator-only", and
    `configuration-reference.md` says the owner is acceptable "because it never serves a
    request". Yet the shipped deployments hand that credential to the process that serves
    every request.
  - #291 S5 was itself the correction of an overclaim about exactly this threat.
- **Required, one of:**
  - **(a), recommended:** run migrations and `ensureApplicationRole` in a separate one-shot
    process that alone receives the owner URL. In compose, that is a `taskdesk-migrate` service
    that runs a migrate entrypoint, with the API `depends_on` it via
    `service_completed_successfully`. In Helm, it is an initContainer or a pre-install/upgrade
    Job. The API container then gets only `TASKDESK_DATABASE_URL`. Scrubbing `process.env` in
    place is **not** sufficient (probe 5).
  - **(b):** narrow every claim above to "SQL-level compromise only". State in the decision log
    that a process-level API compromise still yields the superuser, and get Thomas's explicit,
    recorded risk acceptance with a tracked follow-up issue for (a). That is Thomas's call, not
    an agent's.

### S2 — BLOCKING: the app-role password is logged in plaintext when role create or alter fails

- **Where:** `ensure-application-role.ts:138-151`. The plaintext password is embedded in the
  `CREATE ROLE` / `ALTER ROLE` SQL text. It surfaces through `prepare-database-startup.ts:47`,
  `index.ts:1093`, and the Postgres server log.
- **What:** any failure, for example an owner without `CREATEROLE` (reproduced), writes
  `PASSWORD '<secret>'` twice to container stdout, and therefore to whatever aggregates logs,
  and once to the Postgres log. It repeats on every crash-loop restart.
- **Other leak routes:** even on success, any server with `log_statement = 'ddl'` or `'all'`, or
  pgaudit (common on managed Postgres), records it on every boot, because the step re-runs
  `ALTER ROLE … PASSWORD` each time.
- **PR claim:** the PR's checklist states "role creation/`ALTER ROLE` SQL never logs the
  password".
- **Fix:**
  - Send a client-computed SCRAM-SHA-256 verifier (`PASSWORD 'SCRAM-SHA-256$4096:…'`), which
    Postgres accepts as-is and which is not the password. That removes it from every log.
  - Also catch errors from these two statements and rethrow a message without the query text.
  - Add a regression test that forces the failure and asserts the password is absent from the
    thrown error's message, including its `cause` chain.

### S3 — NON-BLOCKING, fix in this PR: `pg_write_all_data` is not refused

- **Where:** `assert-application-role-is-not-privileged.ts:15-21`.
- **What:** membership in `pg_write_all_data` (PG14+) grants UPDATE and DELETE on every table.
  Reproduced: boot passed, and `DELETE FROM activity` succeeded. `audit_log` is still held by
  its trigger. `activity`, which has no trigger, is not.
- **Why:** this is exactly the "undo the append-only control" case the check exists for. The
  decision log's list of deliberate exclusions does not cover it.
- **Fix:** add it to `DANGEROUS_PREDEFINED_ROLES`, with a probe test like the existing seven. It
  is non-blocking only because the app role cannot grant this membership to itself.

### S4 — NON-BLOCKING: `activity` rows are erasable by cascade

- **Where:** migration `0066` (`ON DELETE CASCADE` to `work_item`), and
  `ensure-application-role.ts:186-190`, which grants `DELETE` on `work_item` and `project`.
- **What:** `DELETE FROM work_item`, or deleting a project, removes that item's `activity` rows
  as the table owner, with no privilege check on `activity`. The cascade was decided earlier,
  so this is not a regression. But the claim that `activity` has no `DELETE` holds only for
  direct DML.
- **Fix:** either say so in AU-3 and `migrations.md`, or revoke `DELETE` on `work_item` and
  `project` from the app role if no request path hard-deletes them. I found no caller of
  `delete(workItemTable)` in `apps/api/src`.

### S5 — NON-BLOCKING: the single-URL fallback never boots, but the docs say it does

- **Where:** `configuration-reference.md:237-241` ("fine for a throwaway local database"), AU-3
  in `audit-trail.md:118-120` ("the API still connects as the owner and only the triggers
  apply"), and `values.yaml`'s external-database default.
- **What:** in single-URL mode the one role ran the migrations, so it owns the tables and
  `assertApplicationRoleIsNotPrivileged` always refuses (reproduced for a superuser and for a
  non-superuser owner).
- **For security, this is the right outcome.** A production deployment cannot silently lose
  the protection, which answers the brief's question 5. There is no need for a separate
  "production mode" refusal.
- **What it breaks:** the documented local-dev path (`pnpm dev` with one URL), and every
  existing Helm external-database or single-URL deployment on upgrade.
- **Fix:** correct the docs, and give local dev a documented two-URL setup (or an explicit
  opt-out that the check itself names). Put the breaking upgrade in the upgrade notes.

### S6 — NON-BLOCKING: the refusal message names the wrong "connected as" role

- **Where:** `assert-application-role-is-not-privileged.ts:128`, `:143`, `:215`.
- **What:** `roles[0]` is the most severe reachable role, not `current_user`. For a superuser
  connection it printed `connected as "postgres"` when the connection was `pr308_opus_owner`.
  That is cosmetic, but it misleads the operator the message is for.
- **Fix:** select `current_user` separately.

### Notes, no action required for this PR

- There is no re-check after boot. Only a role that already holds superuser, `CREATEROLE` or
  owner rights could widen the app role, and such a role wins anyway. The one-shot check is
  proportionate.
- Helm puts the inline `appPassword` and `postgresql.auth.password` in the Deployment's pod spec
  env rather than in a Secret, unless `existingSecret` is used. This is the chart's pre-existing
  pattern. Passwords taken from a secret are interpolated into the URL without URL-encoding,
  also as before this PR.
- `GRANT USAGE, SELECT ON ALL SEQUENCES` includes identity sequences such as `audit_log.seq`,
  which INSERT does not need. The app can burn `nextval` values but cannot `setval`. This is
  harmless unless gap detection is ever built on `seq`.
- `0067`'s `audit_log_reject_mutation()` has no `SET search_path` and refers to `organisation`
  without a schema. A session `TEMP` table could shadow it. That is not reachable by the app
  role, which has no UPDATE on `audit_log`. Worth pinning `search_path` whenever `0067`'s
  functions are next touched.

## Cleanup

`pr308_opus_test` and `pr308_opus_probe_test` were dropped. `pr308_opus_owner`,
`pr308_opus_weakowner` and `taskdesk_app_pr308opus` were dropped, and no `taskdesk_app_%` role
remains. The probe harness files were removed. No containers, compose stacks or images were
started. td-lane-pg's server log keeps one `STATEMENT` line containing the throwaway marker
password `S3cretLeakMarker`. It is not a real credential.

---

## Delta review at `140f0f0`

**Reviewer:** Opus 5.5, the same independent context as above. I did not author, direct or
remediate the fix.
**Reviewed head:** `140f0f0eac5eee7950505668d99e64a5528561c5`
**Reviewed SHA:** `140f0f0eac5eee7950505668d99e64a5528561c5`. Confirmed with `gh pr view 308 --json headRefOid`.

Commits since `5e2164f`:
- `f857863`: the note above.
- `f196555`: the code fix.
- `7597dad`: docs.
- `140f0f0`: a `main` merge. `git diff 7597dad 140f0f0` over the PR's files is empty.

**Date:** 2026-09-23

### Delta verdict

**CHANGES NEEDED.** The security findings are closed:
- S1, S2, S3 and S6 are fixed, and I verified each one live.
- S4 and S5 are now documented correctly.

Two new defects break the deploy paths that the S1 fix introduced (D1, D2). Neither one lets
the API run with the owner credential. Both need fixing before merge, because they break
upgrade (compose) and fresh install (Helm).

### What I ran

I used a fresh detached worktree and private DB `pr308_opus_delta_test`, and dropped the DB
afterwards. I also built a throwaway image and brought up a compose stack. The stack used
project `-p pr308opusd`, the base `compose.yml` only (no Traefik overlay), and an override that
renamed the pinned `taskdesk` network to `pr308opusd-net`. I also ran a throwaway
`postgres:18-alpine` with `log_statement=all`. Everything was torn down afterwards:
containers, volumes, network, image and the scratch `.env`.

1. **Suites.**
   - `db-application-role.test.ts`: 29/29.
   - Full integration: 79 files, 1100 tests, all passed.
   - API unit: 56 files, 421 tests, all passed, including the new `tests/api/database` files.
   - `scripts/ci`: 495/495.
   - `helm lint`: clean.
2. **S1, compose, end to end.** This was a real upgrade from the pre-split state (item 5).
   - Inside the running `taskdesk` container, `env`, `/proc/1/environ` and every
     `/proc/*/environ` contain neither `TASKDESK_MIGRATION_DATABASE_URL` nor the owner password.
   - The image's `ENV` is only `PATH`, `NODE_*`, `YARN_VERSION` and `TASKDESK_PORT`.
   - There is no `.env` file in the image. Compose has no `env_file:`, and none of the four
     overlays touches the migration URL.
   - The live health and readiness checks both returned `{"status":"ok"}`.
   - `pg_stat_activity` showed the API connected as `taskdesk_app`, and only the idle owner
     session in `psql`.
   - Backstop: `docker compose run -e TASKDESK_MIGRATION_DATABASE_URL=… taskdesk` exits with
     "Refusing to start: TASKDESK_MIGRATION_DATABASE_URL is present…".
   - `TASKDESK_ROLE=all` (the default), pointed at the owner URL, exits with
     `connected as "taskdesk" … rolsuper`. The name is right now, which confirms S6.
3. **S1, Helm.** I rendered six cases:
   - bundled with inline passwords;
   - bundled with `existingSecret` for both roles;
   - external with `migration.enabled: false`;
   - external plus migration, inline;
   - external plus migration, `existingSecret`;
   - `migrateJob.enabled: false`.

   I split each render by object. In every case the `taskdesk` Deployment mentions
   `TASKDESK_MIGRATION_DATABASE_URL` only in a YAML comment. It carries no owner password, no
   owner-secret name or key, no `KANEO_POSTGRES_PASSWORD` and no
   `TASKDESK_EXTERNAL_MIGRATION_*`, and it has no `envFrom:` or `secretName:` anywhere. The
   owner credential appears only in `Job t-taskdesk-migrate` and in the bundled Postgres
   Deployment.

   The chart ships no `Role` or `RoleBinding`, so the shared ServiceAccount has no Secret read
   access unless the cluster grants it. Giving the Job its own ServiceAccount would be tidier.
   That is optional.
4. **S2.**
   - The verifier is `SCRAM-SHA-256$4096:<16-byte salt>$<StoredKey>:<ServerKey>`, which matches
     `scram_build_secret`. The iteration count equals the server's `scram_iterations` default
     (4096).
   - The salt differs on every run: two consecutive `docker compose run migrate` runs stored
     different salts.
   - Authentication over the network works. The compose Postgres `pg_hba` requires
     `scram-sha-256` for non-local hosts. The right password authenticated from the Postgres
     container to `host=postgres`, both before and after a rotation, and a wrong password
     failed. The API's own pool connected the same way. (A second check I ran on the scratch
     server went over `127.0.0.1`, which that image trusts, so it proves nothing. I rely on the
     compose result.)
   - With `log_statement=all`, the success path and a forced failure (an owner without
     `CREATEROLE`) put the plaintext marker in the server log **0** times, and in the thrown
     error, including its `cause` chain, **0** times. The failure message is
     `Failed to create application role "…": permission denied to create role (…)`.
   - The server log does hold the verifier. That is the same thing `psql`'s `\password` and
     `PQencryptPasswordConn` deliberately send, so it is standard practice. With
     `openssl rand -hex 32` passwords, an offline guess against it is infeasible. I accept it.
5. **Upgrade (compose).**
   - I built the pre-split state first. I ran `migrate` with `TASKDESK_DATABASE_URL` set to the
     owner URL, which is the old single-role shape: 46 tables owned by `taskdesk`, and no
     `taskdesk_app` role. Then I inserted a marker row.
   - Then I ran `up -d --wait taskdesk`. Migrate ran first, created `taskdesk_app`, and the API
     became healthy as `taskdesk_app`.
   - The owner still owns all 46 tables, and the marker row survived. There is no data-loss
     path and no DDL on data. The API never connected as the owner.
   - The one failure is in `deploy.sh` itself (D1).

### Findings (delta)

#### D1 — BLOCKING: `deploy.sh upgrade` and `rollback` abort at the new migrate step

- **Where:** `scripts/deploy.sh:397` and `:422` (`dc up -d --wait migrate`, under `set -Eeuo pipefail`).
- **What:** with Docker Compose v5.5.1, `up -d --wait` aimed directly at a one-shot service
  returns **exit 1** ("container … exited (0)") even when migrate succeeded. I reproduced it
  three times, including with `--force-recreate`.
- **Effect:**
  - `upgrade` stops after the new image's migrations have been applied, while the **old**
    `taskdesk` container keeps serving against the new schema.
  - On the first upgrade from a pre-split version, that old container is still the one
    connected as the superuser owner.
  - `rollback` aborts in the same place.
- **What does work:** `up -d --wait taskdesk` and a whole-stack `up -d --wait` both return 0,
  because Compose treats an exited dependency with `service_completed_successfully` as
  satisfied. So `deploy.sh`'s install paths (`:361`, `:376`) are fine.
- **Fix:** use `dc run --rm migrate`, which returns the container's exit code, or `dc up migrate`
  without `-d --wait` and check the exit code. Add a test in `scripts/ci`, or at least a
  shell-level check, if `deploy.sh` has one.

#### D2 — BLOCKING: a fresh `helm install` cannot complete the `pre-install` migrate hook

- **Where:** `charts/taskdesk/templates/migrate-job.yaml:27` (`helm.sh/hook: pre-install,pre-upgrade`), `:48`.
- **What:** Helm runs `pre-install` hooks *before any chart resource is created*. The Job uses
  `serviceAccountName: {{ taskdesk.serviceAccountName }}`, and that ServiceAccount is an ordinary
  chart resource (`serviceaccount.yaml`, `serviceAccount.create: true` by default). So on a first
  install the Job's pod is rejected at admission ("serviceaccount not found"), and `helm install`
  waits until `--timeout` and then fails.
- **Even without that:** with `serviceAccount.create: false`, the bundled
  `t-taskdesk-postgresql` Deployment and Service do not exist yet either. `waitForDatabase`
  exhausts its retries, and the Job fails once its backoff limit is reached.
- **Not a problem for upgrades:** `pre-upgrade` is fine, because both resources exist by then.
- **Caveat:** I reasoned this from Helm's documented hook order. I had no cluster, so I did not
  run it.
- **Fix, one of:**
  - (a) Run the migrate step as an **initContainer** of the taskdesk Deployment. The owner URL
    would be in the initContainer's env only. By default the main container's process cannot
    see an init container's `/proc`. That keeps S1 closed and solves the ordering.
  - (b) Use `post-install,pre-upgrade`. The API pods then crash-loop on the privilege check
    until the Job finishes, which fails closed.

  Whichever is chosen, `kubernetes.md`'s description has to match.

#### D3 — NON-BLOCKING: docs still say the serving process runs migrations

- `docs/05-operations/container-image.md:50`: the entrypoint list, step 2 "run migrations".
- `docs/05-operations/deployment.md:80`: "the application … applies migrations".

For `all`/`web`/`jobs` neither is true any more. The single-container story is now: run the
same image once with `TASKDESK_ROLE=migrate` and the owner URL, then run it with the app URL
only. `configuration-reference.md`'s Local development section says this. The operator-facing
image and deployment pages should say it too.

#### D4 — NON-BLOCKING: several doc and message inaccuracies

- `kubernetes.md:19-20` describes a chart-generated `Secret` and `taskdesk-web`/`taskdesk-jobs`
  Deployments. The chart renders neither: passwords are inline in the pod spec unless
  `existingSecret` is used, and there is one `taskdesk` Deployment.
- The decision log and `migrations.md` say that a Helm external database with
  `migration.enabled: false` makes the migrate Job "fail loudly at install if that role cannot
  run DDL". With the chart's own recommended external setup
  (`ALTER SCHEMA public OWNER TO taskdesk_user`), the Job **succeeds**, and it is the API pods
  that then refuse to boot on the ownership check. That still fails closed, but it happens in a
  different place from the one described.
- `ensure-application-role.ts:106` logs "TASKDESK_MIGRATION_DATABASE_URL is unset" whenever the
  two roles are equal, including when the variable is set (seen live).
- The `migrate-job.yaml` comment mentions a TTL, but none is set. `hook-delete-policy` handles
  cleanup.

### Question 4: `configuration-reference.md:74` and "no single-URL API mode"

These are consistent. Only `runMigrationStep` calls `resolveMigrationDatabaseConfig`, so the
fallback applies only inside the one-shot migrate process. The serving boot path never reads the
migration configuration, except to refuse when the variable is present. And it refuses any owner
or superuser connection whatever the environment. I verified both halves live (item 2).

### Delta cleanup

These are dropped or removed:
- `pr308_opus_delta_test`;
- compose project `pr308opusd` (`down -v --remove-orphans`), with its containers, volumes and
  `pr308opusd-net`;
- `pr308opusd-logpg`;
- image `ghcr.io/thomasheinthura/taskdesk:pr308opus-delta`;
- the scratch `.env` and override, and the probe harness.

I created no roles on td-lane-pg in this pass. The test suite's `taskdesk_app_%` roles were
cleaned up by its own `afterAll`, and none remains.

I did not touch `pr308-delta2-localpg` or the role `pr308_weakowner`. Both exist on the host but
are not mine.

---

## Second delta review at `13ebb0f`

**Reviewer:** Opus 5.5, the same independent context as above. I did not author, direct or
remediate any of this.
**Reviewed head:** `13ebb0f5d900bded6f68bcec053894cb78eab1c2`
**Reviewed SHA:** `13ebb0f5d900bded6f68bcec053894cb78eab1c2`. I confirmed it with
`gh pr view 308 --json headRefOid`, and `git merge-base --is-ancestor origin/main 13ebb0f` holds.

Commits since `b2a72f8`:
- `9f92a2b`: the D1–D4 fixes.
- `5d43ccb`: a `main` merge, bringing in #321's backfill.
- `8174863`: the CI Helm step.
- `d0e594f`: decision-log text.
- `13ebb0f`: the GitGuardian defuse.

I ran the probes at `d0e594f`. Then I re-ran the suites and both mutation checks at `13ebb0f`,
whose only change is a YAML comment and a test-local constant.

**Date:** 2026-09-23

### Second delta verdict

**CLEAR WITH FINDINGS.**
- D1 and D2 are fixed. D1 is fixed and verified end to end. D2 is fixed by moving migrate into
  an initContainer, which I reasoned about but could not run: there is no `kind`, `k3d` or
  `kubectl` on the host.
- D3 and D4 are corrected in the docs.
- `13ebb0f` removes no real secret, rotates nothing, and adds no ignore entry.
- The remaining findings (E1–E3) are non-blocking.

### `13ebb0f` (GitGuardian defuse), reviewed adversarially

- The commit is exactly two lines:
  - a sample URI in a `values.yaml` comment is reworded;
  - the test-local fixture prefix `S3cretLeakMarker_` becomes `EnsureRoleProbeValue_`.
- The value is `${prefix}${randomSuffix()}`, generated per run. The leak assertion reads the
  variable (`expect(fullText).not.toContain(targetPassword)`), so it is unchanged in strength.
- Neither value was ever a real credential, and nothing needed rotating.
- The PR diff against `main` does not touch `.gitleaksignore` or any `.gitguardian*` file.
  `.gitleaksignore` was last changed by #291. **There is no suppression, broad or narrow.**
- GitGuardian scans history, so the two historical incidents may still need resolving as false
  positives in its dashboard, as the commit message says.
- This note itself mentions the literal `S3cretLeakMarker` in the first review above. It is
  prose, not a `password=` assignment, but it could trip the same detector.

### What I ran

1. **Suites.**
   - Full integration: 82 files, 1115 tests, all passed, at both `d0e594f` and `13ebb0f`.
   - `db-application-role`: 29/29.
   - `boot-orchestration`: 3/3.
   - `boot-orchestration-success`: 1/1.
   - `backfill-workspace-project-defaults`: 11/11.
   - API unit: 56 files, 421 tests, all passed.
   - `scripts/ci`: 495/495.
   - `helm lint`: clean.

   I used private DB `pr308_opus_delta2_test`.
2. **D1: a real `scripts/deploy.sh` run.** I copied `compose.yml`, `deploy/` and
   `scripts/deploy.sh` into a scratch directory, and changed that copy only:
   - project `pr308opusd2`, network `pr308opusd2-net`;
   - the prod overlay's external `proxy` network became a local `pr308opusd2-proxy`, with no
     Traefik;
   - images came from a throwaway local registry on `127.0.0.1:55497`, carrying two variants
     with different digests.

   Results:
   - `production --no-verify` brought the stack up.
   - `upgrade --no-verify` to the second variant exited **0**: migrate ran, the API was
     replaced and was healthy.
   - `rollback sha256:<first digest> --no-verify` exited **0**.
   - A **genuinely failing migrate** (a wrong `POSTGRES_PASSWORD` in `.env`, so the owner login
     fails) made `upgrade` exit **1** at the migrate step. The `taskdesk` container was left
     untouched, with the same container ID and image, and was still serving. The wrong password
     never appeared in the output.
   - Note that `up -d --wait taskdesk` also re-runs `migrate` as its dependency after an image
     change. That is a harmless, idempotent second run.
3. **Two pre-existing `deploy.sh` defects, found while running it.** Neither was introduced by
   this PR.
   - `assert_port_unpublished` (`scripts/deploy.sh:277`): on Compose v5.5.1,
     `docker compose port taskdesk 5173` exits **0** and prints `invalid IP:0` for an unpublished
     port. `production` therefore died with a false "port is PUBLISHED" error. I patched my
     scratch copy only, to test for `:[1-9]` in the output.
   - The "Roll back with:" hint prints the full `repo@sha256:…` RepoDigest, but `rollback`
     accepts only `sha256:…`.

   Both are worth a small follow-up.
4. **D2, Helm.** I rendered seven cases: bundled inline, bundled `existingSecret`, external with
   `migration.enabled: false`, external plus migration inline, external plus migration
   `existingSecret`, `migrate.enabled: false`, and `replicaCount=3`. With comments stripped:
   - The owner URL, the owner password and the owner Secret name/key appear **only** in the
     `migrate` initContainer's `env`, plus the bundled Postgres Deployment, which is where they
     belong.
   - The `taskdesk` container has none of them.
   - There is no `envFrom` from the chart (`extraEnvFrom` is operator-supplied, and the backstop
     refuses if it carries the URL).
   - The main container has no `volumeMounts`, and no Secret volume exists.
   - There is no `downwardAPI`, `fieldRef` or `shareProcessNamespace`.
5. **The Pod-level threat.**
   - Containers in one Pod have separate PID namespaces by default, and nothing sets
     `shareProcessNamespace`. So the serving process cannot read the init container's
     `/proc/*/environ`.
   - The two containers share no volume, and a `secretKeyRef` is resolved by the kubelet into
     that container's env only. The runtime isolation is therefore equivalent to the hook Job.
   - It is weaker in one respect. With inline values the owner password now sits in the
     Deployment, ReplicaSet and Pod specs for the release's whole life, not just while a Job
     exists. It is readable by anyone with `get pods`, and by the Pod's own ServiceAccount token
     if the cluster ever grants it that. The chart creates no Role or RoleBinding, and does not
     set `automountServiceAccountToken: false`.
   - This is not a regression against the #296 threat model, because Helm's release Secret
     already holds every inline value.
   - With `existingSecret`, only the Secret's name and key are in the spec. See E2.
6. **Concurrent replicas.** `ensureApplicationRole` is serialized by
   `pg_advisory_xact_lock(4011)`. Drizzle's `migrate()` and the four hand-written fixups take
   **no** lock. Neither did `main`'s boot path, where every replica ran `migrate()` inline
   (`origin/main:apps/api/src/index.ts` has no advisory lock). So this is pre-existing, and I
   judge it survivable:
   - A concurrent DDL migration makes one runner fail on duplicate-object errors, and that init
     container restarts and succeeds.
   - A DML-only migration could, however, apply twice.

   `values.yaml:69-70` says migrations are "idempotent under their own advisory lock". That is
   not true for `migrate()`. See E1.
7. **Mutation checks, at `13ebb0f`.**
   - **(A)** Commenting out `assertNoMigrationUrlInApiProcess()` in `runApiBootTasks` turns
     `boot-orchestration.test.ts` red (1 failed, 2 passed). The test really exercises the
     backstop. Restored.
   - **(B)** I narrowed `ensureApplicationRole` to grant only `SELECT` on `work_item_type`. I
     confirmed it took effect: `has_table_privilege(…,'work_item_type','INSERT')` returned
     false. Even so, `boot-orchestration-success.test.ts` **still passed**. The test asserts
     only that some log line matches `/backfill/i`, and the backfill's summary line is printed
     even when every workspace failed. `processed` counts candidates, not successes. See E3.
     Restored.
8. **The #321 backfill, for real, in the compose stack.**
   - As the owner, I inserted a legacy workspace with no defaults, then restarted `taskdesk`.
   - The log showed `✅ Backfill (#316) summary: workspaces -- 1 processed (1 seeded default
     types, 1 seeded default templates, 0 failed)`, and the workspace now has 9
     `work_item_type` and 5 `state_template` rows.
   - `pg_stat_activity` shows the API connected only as `taskdesk_app`.
   - Every `/proc/*/environ` in the `taskdesk` container has 0 `MIGRATION` hits.

   So the backfill's DML succeeds under the app role's grants, and its advisory lock
   (`pg_advisory_xact_lock(1524, …)`) needs no extra privilege.
9. **Docs.** I checked the decision log's wording at `d0e594f` against the chart and the runs
   above, and it matches:
   - there is a migrate initContainer on the `taskdesk` Pod;
   - the external-database case with `migration.enabled: false` fails closed, either because the
     initContainer succeeds and the API then refuses, or because the initContainer fails;
   - `deploy.sh` runs `dc run --rm migrate` first.

   `charts/taskdesk/README.md:125` says the same thing. The rendered `ext_single` case confirms
   that the initContainer receives the app URL as its migration URL.
   - One case the prose does not list: a pre-migrated external database whose role neither owns
     the tables nor has DDL rights. There the initContainer succeeds as a no-op, and the API boots
     legitimately as a non-owner. That is safe, not a gap.

### Findings (second delta)

#### E1 — NON-BLOCKING: the chart comment overclaims migration locking

- **Where:** `charts/taskdesk/values.yaml:69-70`, and the comment in the `deployment.yaml`
  initContainer.
- **What:** only the role/grant step is locked. Concurrent `migrate()` runs are unserialized,
  exactly as they were on `main`.
- **Fix:** correct the comment, or better, wrap `runMigrationStep`'s whole DDL sequence in a
  session-level `pg_advisory_lock`. That also covers the Compose `migrate` service.

#### E2 — NON-BLOCKING: harden the Pod's view of the owner credential

- Set `automountServiceAccountToken: false` on the `taskdesk` Pod, since the API does not talk
  to the Kubernetes API.
- Recommend `postgresql.auth.existingSecret` or `external.migration.existingSecret` in
  production. The chart README already calls it the recommended path.
- This is equivalent to the hook Job at runtime (probe 5). It only narrows the exposure through
  the Kubernetes API.

#### E3 — NON-BLOCKING: the boot success test does not prove the backfill's DML worked

- **Where:** `tests/api-integration/boot-orchestration-success.test.ts:183`
  (`/backfill/i`).
- **What:** it passes with INSERT denied (mutation B).
- **Fix:** assert that the seeded legacy workspace has its `work_item_type`/`state_template`
  rows after `runApiBootTasks()`, or that the summary line reports `0 failed`. The behaviour
  itself is correct (probe 8). Only the test is weak.

### Second delta cleanup

These are dropped or removed:
- `pr308_opus_delta2_test`;
- the scratch deploy copy and its generated `.env`;
- compose project `pr308opusd2` (`down -v --remove-orphans`), with its containers, volumes,
  `pr308opusd2-net` and `pr308opusd2-proxy`;
- the local registry container `pr308opusd2-registry` and the `registry:2` image;
- the images `127.0.0.1:55497/taskdesk:tag-a`/`tag-b` and
  `ghcr.io/thomasheinthura/taskdesk:pr308opus-d2`;
- the mutation and probe files. Both mutations were reverted with `git checkout`.

`postgres:18-alpine` and `valkey/valkey:9-alpine` are left in place, because other stacks on the
host may use them. The only roles I created, `taskdesk_app_opusd2mut` and the test suites'
`taskdesk_app_*` roles, are dropped.
