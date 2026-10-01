# PostgreSQL RLS prototype results

**Run date:** 2026-10-01  
**Measurement base:** `c891e9bcd4abf9b77b4916561d9bc5ca367065e` (`origin/main`, after status-only PR #530)
**Scope:** isolated test-only prototype on `work_item`, `comment`, and `attachment`. No
production migration, runtime policy, auth code, shared schema, CI task, or application
connection wrapper changed.

## Recommendation

Keep this as a measured test-only prototype and retain RLS as a candidate tenant backstop.
The actual work-item routes agree with RLS for the full customer-A data set and the explicit
internal-staff multi-organisation fixture. Sampled activity reads expose one difference for
an intentionally malformed comment row, which the production composite FK prevents; sampled
attachment reads agree while preserving the stored organisation mismatch. In this one small
warmed local run, the RLS-on median increased by 0.213 ms (19.1%) for the work-item list,
0.449 ms (85.4%) for comments, and 0.564 ms (110.6%) for attachments. Those values quantify
this fixture only; they do not establish whether the cost is material for production
workloads. It does **not** justify a production policy rollout by itself: the GUC is
writable by the database role, tenant scope must be derived by trusted application code,
the application has no GUC-setting wrapper and is not routed through PgBouncer by this
prototype, and the fixture exposed an attachment attribution mismatch. This candidate adds
a repeatable test of prototype scope through real PgBouncer transaction pooling; it does not
establish application-wrapper or production compatibility.
Project/actor reach is intentionally broader than the tenant policy. Keep the application
permission and reach checks primary as the architecture requires.

Before a runtime rollout, define and test the transaction wrapper against the deployment
pooling mode, keep the app role non-owner and `NOBYPASSRLS`, derive the GUC from resolved
request authority, and reconcile the attachment organisation mismatch. Do not interpret
these results as equality between an RLS tenant backstop and project-level actor policy.

## Reproduction and setup

Run from repository root:

```sh
pnpm --filter @taskdesk/api exec vitest run --config vitest.rls-prototype.config.ts
```

The prototype's dedicated TypeScript project is also included in the API package's normal
`typecheck` script, so the monorepo `pnpm typecheck` gate checks it without a separate CI
task or coverage-guard change.

The suite starts a fresh `postgres:18-alpine` Testcontainer and pinned PgBouncer container
on a UUID-named private Docker network, maps only random ports on `127.0.0.1`, and applies
all real Drizzle migrations from this base. Each run uses a unique database name and
generated credentials. It never reads `.env`, `TASKDESK_DATABASE_URL`, or the migration
database URL, and it cannot connect to local development, UAT, or production. It seeds
three organisations (using the migration-seeded internal organisation plus two customer
fixtures), creates customer workspaces directly because no application writer creates
them yet, and seeds four projects with 300 work items each: one internal, two in customer
A, and one in customer B. The resulting data has 1,200 work items, 1,201 comments, and
1,202 attachments, including intentional malformed-parent and denormalized-organisation
fixtures described below.

The policy roles are disposable and SELECT-only. `taskdesk_rls_baseline` is a non-owner,
non-superuser role with `BYPASSRLS`; `taskdesk_rls_probe` has the same SELECT grants and
`NOBYPASSRLS`. Both use one-connection pools. The benchmark alternates RLS-off baseline
and RLS-on probe requests in each sample pair, with eight warmups and 40 measured pairs
per query. Each sample includes pool checkout, transaction begin/commit, and the read.
EXPLAIN runs separately and does not contribute to sample timing.

The original `c891e9b` direct-pool measurements exercised `pg.Pool` reuse with one physical
backend; they did not exercise PgBouncer. The candidate retains those direct PostgreSQL
pools for direct-vs-direct policy timing and routes separate probe connections through a
real PgBouncer transaction pool. The automated test verifies transaction-local scope is
removed after commit and rollback, empty/unset scopes fail closed, customer A/B do not
bleed across reuse, and two separate logical clients queue on and reuse the same single
backend. The GUC remains caller-controlled: the SELECT role can set it to customer B and
read B's 300 rows. Therefore this GUC is not an identity credential. It is useful only when
the trusted application wrapper derives and binds the organisation set for the request; it
does not protect against arbitrary SQL execution by that role. The application wrapper
itself is not implemented or tested through PgBouncer.

## Tenant boundary results

| Read set | Expected rows from handwritten tenant predicate | RLS probe | Result |
| --- | ---: | ---: | --- |
| Customer A work items | 600 | 600 | Same valid tenant rows |
| Customer A comments | 600 | 600 | Same valid parent-consistent rows |
| Customer A attachments | 602 | 602 | Same rows by parent workspace |
| Internal staff work items | 1,200 across internal + A + B | 1,200 | Multi-organisation reach works |
| Internal staff comments | 1,200 | 1,200 | Same tenant set |
| Internal staff attachments | 1,202 | 1,202 | Same tenant set |

The hand-selected project set below contains 900 work items. The RLS staff scope sees 300
additional work items in the other customer-A project. This is a project-subset illustration,
not an executed actor decision. The actual route comparison below uses explicit workspace
membership and returns all projects in each reachable workspace. Organisation-level RLS
remains a tenant backstop, not a replacement for project membership, capability evaluation,
or `sees_all`.

## Actual application read-path comparison

The prototype now runs the existing Hono routes and controllers against the disposable
Testcontainer. It dynamically imports the application only after setting
`TASKDESK_DATABASE_URL` to the container's `taskdesk_rls_probe` role URL, then verifies
`current_user` and `current_database()`. The route requests use the repository's existing
`mockAuthenticatedSession` integration-test helper. The app role is non-owner and
`NOBYPASSRLS`; RLS is disabled for these baseline application requests, then re-enabled for
the separate probe-pool comparisons. It is still a direct app connection, not PgBouncer, and
the application does not set the prototype GUC.

The full `GET /api/projects/{projectId}/work-items` route exercises project lookup,
workspace access, capability middleware and `controllers/list-work-items.ts`. It paginates
all 300 work items in each fixture project. An internal-staff person with membership only in
customer A's workspace returns 600 A work items; an attempt to list customer B returns 400.
The RLS A-scope returns the same 600 IDs (SHA-256
`6671983679966e1c967616e6ffbe8dd2286692fa5617d3fd09519ded83c27c11`). No customer principal
or customer-portal agent request was created or tested: this is customer-A **data scope** as
read by an internal-staff actor.

A second staff person whose home organisation is the seeded internal organisation has
explicit member rows for internal, A and B workspaces. The route returns all 1,200 work-item
IDs, exactly matching the RLS scope for those three organisations (SHA-256
`a2ddfe696a8ae07a140d366909cd96092bcb5baa9d2a4ba80908de6a7b67bbcd`). This is the current
live workspace-membership route behavior. It does not prove project-level reach equality:
the actual route grants all projects in a member workspace, and `resolveIdentity` currently
reports membership reach with `seesAll: false`; project-level membership and `sees_all` are
not enforced by this work-item route. The hand-selected 900-row set in the preceding table
is not the result of application authorization.

The actual `GET /api/work-items/{key}/activity` and
`GET /api/work-items/{key}/attachments` routes are also run for one deterministic first item
in each project. Attachments match RLS in all four samples, including the customer-A row
whose stored `attachment.organisation_id` says B while its parent workspace belongs to A.
The activity route returns the intentionally malformed comment whose `workspace_id` says B
but whose parent work item belongs to A; the RLS comment policy rejects it. The fixture can
insert this row only by disabling FK triggers in the disposable container, and the real
composite FK prevents it in ordinary data. This is a concrete disagreement on invalid
fixture state, not evidence that the routes agree on malformed rows. The invalid state stays
visible in the report rather than being filtered out of either result.

The route actor is always a `person.side = 'staff'` principal in the internal organisation.
The fixture adds explicit workspace memberships to model current live access. It does not
invent customer-agent access or claim the route implements the architecture's future
project-membership/`sees_all` distinction.

Two deliberately inconsistent records remain visible as evidence, not as valid data:

* A customer-A attachment points to a customer-A workspace but stores
  `attachment.organisation_id = customer B`. The tenant predicate uses the parent
  workspace and therefore keeps it visible to A and not B; the mismatch remains and may
  misattribute organisation-based quota accounting. RLS does not repair the stored
  denormalization.
* A comment points at a customer-A work item but claims a customer-B workspace. The real
  composite FK prevents this. In the disposable test database only, FK triggers were
  disabled for insertion; the prototype policy hides this comment from A because comment
  workspace must agree with its parent work item.

The data-model specification lists nullable `project.organisation_id`, but the actual
migrated `project` table has no such column. The experiment follows the present schema's
authoritative chain `work_item.workspace_id -> workspace.organisation_id`. It also
confirms customer workspace rows are currently test-seeded only; the app does not yet
create them. Attachment `submission_id` parents are not covered by this first policy
prototype; the attachment policy fails closed for them rather than guessing a tenant.

## Hot-read measurements

Local Docker reports 14 CPUs and 16 GiB memory assigned to the engine; the host reports 14
logical CPUs and 36 GiB physical memory. The isolated suite was the only intentionally
heavy database workload in the measurement window. PostgreSQL tables were analyzed after
seeding. These are one warmed local run, not a production latency forecast; absolute
sample times include loopback round trips and transaction setup, and plan variance is
visible in the different planner choices.

| Query shape | Mode | Rows | Median ms | p95 ms | EXPLAIN execution ms | Shared hit/read blocks |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Work item list page | RLS off | 101 | 1.114 | 1.390 | 0.522 | 46 / 0 |
| Work item list page | RLS on | 101 | 1.327 | 1.727 | 0.356 | 24 / 0 |
| Comment detail | RLS off | 2 | 0.526 | 0.620 | 0.024 | 4 / 0 |
| Comment detail | RLS on | 1 | 0.975 | 1.233 | 0.083 | 13 / 0 |
| Attachment detail | RLS off | 2 | 0.510 | 0.568 | 0.028 | 4 / 0 |
| Attachment detail | RLS on | 2 | 1.074 | 1.387 | 0.085 | 18 / 0 |

The benchmark SQL follows the current list, comment activity, and attachment controller
read predicates. Separate measurements above now call the actual Hono read paths. The comment row-count difference is the
intentionally corrupt workspace-mismatch comment: the baseline query sees it by
`work_item_id`, while RLS rejects it. The clean application-boundary comparison above
uses the tenant's parent work-item relationship and matches for valid comments. The
attachment plan adds parent and tenant checks; observed shared reads remained zero in this
small warmed fixture. Larger and realistic distributions are still needed to assess plan
stability and production costs.

## Test evidence

The following records the earlier application-read-path candidate and repository gates; it
is historical context, not a claim that those full gates were rerun for the PgBouncer-only
extension. Its latest dedicated test/typecheck and scoped lint evidence is in the section
below.

* `pnpm --filter @taskdesk/api exec vitest run --silent=false --reporter=verbose --config vitest.rls-prototype.config.ts` — **1 test passed** on the earlier candidate, including route/controller comparison; log: `/private/tmp/pr531-actual-read-path-test.log`.
* `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.rls-prototype.json` — **passed** after building the workspace `@taskdesk/email` type declarations required by the API test project. This project is now invoked by the normal API `typecheck` script; re-run that gate on this candidate before treating typecheck as green.
* `pnpm lint:ci` — **passed on the current worktree**, checked 1,621 files, with 124 warnings.
* `pnpm --filter @taskdesk/api typecheck` — **passed** with the dedicated prototype TypeScript config included by the package script.
* `pnpm typecheck` — **passed**, all 9 workspace tasks succeeded; API typecheck executed on this candidate with the new project included.
* `pnpm test` — **failed on local head `0a8b21f` before the application-read harness delta**: API 64/66 files and 525/529 tests passed; `tests/api/storage/filesystem.test.ts` had three failures and `tests/api/storage/index.test.ts` one failure. The affected tests throw `Storage path escapes the storage root via a symlink.` from the storage path check, including one upload-size assertion that expected the size-limit error. The web suite had four failures in `src/hooks/use-task-filters-with-labels-support.test.tsx`; `window.localStorage` is undefined in its `beforeEach` and `afterEach`. Root independently reproduced all eight failures on clean `main`. The current local full suite has not been rerun after this test-only harness delta; the failing runtime/test files are untouched. Hosted unit gates were green on `0a8b21f`; current-head hosted checks must complete separately. Captured local logs: `/private/tmp/pr531-pnpm-test.log` and `/private/tmp/pr531-web-filter-test.log`.
* `pnpm check:env` — **passed**; the test harness lives under `tests/`, which the check
  does not scan as application runtime. Within its 29 application environment-read
  occurrences, the checker attributed every occurrence to the configuration reference.
  This does not clear the separate existing environment ratchet findings: the repository
  audit still records 49 active unapproved names and two unattributable files (issue #10).
* `pnpm exec biome check --write tests/rls-prototype/rls-prototype.test.ts` — completed on this candidate, applying formatting/import order only. The remaining isolated `RLS_PROTOTYPE_DATABASE_URL` undeclared-Turbo-environment warnings are non-blocking; the suite is run directly with Vitest, not through a cached Turbo task.

## Automated PgBouncer transaction-pool repeatability

The bounded extension is test-only. Code and setup are in source commit
`283678e1cd1642065fcb82321f45402b06a2373a` (based directly on
`1118552f7bbee00ba2e694a021db969dda2769da`). It routes the prototype `probePool` and two
independent logical-client pools through an actual PgBouncer process; the existing baseline,
application route, and RLS timing comparison pools remain direct PostgreSQL connections.
The suite still uses only the existing Testcontainers dependencies (`testcontainers` and
`@testcontainers/postgresql` 12.1.0); it adds no package or runtime dependency.

The latest repeatability run on 2026-10-01 used Node 26.8.2, pnpm 10.32.1, Docker Engine
29.4.0, and Vitest 4.1.11. PostgreSQL reported `18.6`; the `postgres:18-alpine` tag resolved
locally to `postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873`.
PgBouncer reported `1.25.2`, from
`pgbouncer/pgbouncer@sha256:c0c55b277858ca308eb5df7baf8b83fbaea60b2c666604f29d8fe25e9decac68`.
The test read back `pool_mode=transaction` and `default_pool_size=1` from its admin
interface. The isolated run database was `taskdesk_rls_1afed7645a2a4c92`; generated
credentials are intentionally not written to the log or this report.

The single new test passed. It verified the server connection as the expected database and
the probe role flags (`rolsuper=false`, `rolbypassrls=false`, not owner of `work_item`).
Across all three tables it compared the complete sorted visible ID sets against the
handwritten valid-tenant predicate:

| Scope/table | Rows | SHA-256 of ordered IDs |
| --- | ---: | --- |
| Customer A `work_item` | 600 | `6671983679966e1c967616e6ffbe8dd2286692fa5617d3fd09519ded83c27c11` |
| Customer A `comment` | 600 | `3f3fda34094bcff593ee015eb9ab925b11e8c737aa488e618ef0886e1e2ca732` |
| Customer A `attachment` | 602 | `5dca6ca30a94a21cf8121a414b413481e6baf6312de51a9bff6b9ef024bc4dc1` |
| Customer B `work_item` | 300 | `8805631360ad831a490bd5057ba93dacc5e9752d542336a07dc6961e9441b1a4` |
| Customer B `comment` | 300 | `61bd348511e3723a65e5177dae2109edcedc1ec83ccb713994bfbd00efbb000f` |
| Customer B `attachment` | 300 | `4d6a1c29773f71c8e17b6a0b1fe5a37e22c5db09db0588789cab518eef7db928` |

The probe found zero visible rows for unset scope after commit, unset scope after rollback,
and empty scope for each of the three tables. Distinct A and B logical clients both reached
backend PID 771 in the final run. While client A held a scoped transaction, PgBouncer
reported `cl_active=2`, `cl_waiting=1`, `sv_active=1`, and `pool_mode=transaction`; after
release, client B observed scope `UNSET` before setting B and returned only B rows. The
database reported exactly one `taskdesk_rls_probe` server backend after the probe. The same
scope set was read and checked on every sequential client transaction after backend reuse.

The first automated attempt stopped at the probe's `SHOW CONFIG` decoder because this
PgBouncer release names the setting column `key` rather than `name`; correcting the decoder
made the run pass. The final dedicated Vitest command passed **1 file / 2 tests**. The
dedicated TypeScript check (`pnpm --filter @taskdesk/api exec tsc --noEmit -p
tsconfig.rls-prototype.json`) passed. Scoped `biome check` passed with 11
`noUndeclaredEnvVars` warnings for ephemeral suite-only variables; these variables are
created and removed by Vitest global setup, and this command does not run via Turbo. Docker
inspection after completion found no containers or networks labelled for this probe.

This validates the small prototype's transaction-local `set_config(..., true)` behavior
through the stated PgBouncer version and topology. PostgreSQL documents the `is_local=true`
setting as transaction-local ([`set_config`](https://www.postgresql.org/docs/18/functions-admin.html));
PgBouncer documents transaction mode as releasing a server connection at transaction end and
lists session `SET`/`RESET` as incompatible with transaction pooling
([pooling modes](https://www.pgbouncer.org/config.html#pool_mode),
[`features`](https://www.pgbouncer.org/features.html)). This test uses `set_config` inside
explicit transactions, but it does not exercise the application's request authority,
connection wrapper, driver preparation behavior, failover, multiple PgBouncer instances,
or deployed configuration. Its timings are deliberately not compared with the historical
direct-connection measurements, and it adds no performance claim.

This document is evidence for the RLS P0 prototype decision, not a claim that P0 or the
RLS work is complete. Any adoption, runtime wrapper, policy/migration, or status/decision
log change requires its own authorized task and normal review.
