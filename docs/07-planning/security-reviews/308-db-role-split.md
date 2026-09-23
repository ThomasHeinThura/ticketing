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
