# PostgreSQL RLS prototype results

**Run date:** 2026-10-01  
**Measurement base:** `a0ecc965c9de65af5575361eb6c5286bf05a4bdd` (`origin/main`)  
**Refreshed review base:** `c891e9bcd4abf9b77b4916561d9bc5ca367065e` (status-only PR #530 merge; prototype files unchanged)  
**Scope:** isolated test-only prototype on `work_item`, `comment`, and `attachment`. No
production migration, runtime policy, auth code, shared schema, CI task, or application
connection wrapper changed.

## Recommendation

Keep this as a measured test-only prototype and retain RLS as a candidate tenant backstop.
The fixture shows customer tenant agreement for valid rows and internal multi-organisation
reach. In this one small warmed local run, the RLS-on median increased by 0.205 ms (16.5%)
for the work-item list, 0.516 ms (63%) for comments, and 0.824 ms (105%) for attachments.
Those values quantify this fixture only; they do not establish whether the cost is material
for production workloads. It does **not** justify a production policy rollout by itself:
the GUC is writable by the
database role, tenant scope must be derived by trusted application code, a real PgBouncer
path was not exercised, and the fixture exposed an attachment attribution mismatch.
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

The suite starts a new `postgres:18-alpine` Testcontainer and applies all real Drizzle
migrations from this base. It never reads `.env`, `TASKDESK_DATABASE_URL`, or the migration
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

This exercises `pg.Pool` reuse with a single physical backend, not an actual PgBouncer
process or production connection wrapper. It verifies transaction-local scope is removed
after commit and rollback, empty/unset scopes fail closed, and subsequent customer scope
does not leak across reuse. It also shows the GUC is caller-controlled: the SELECT role can
set it to customer B and read B's 300 rows. Therefore this GUC is not an identity
credential. It is useful only when the trusted application wrapper derives and binds the
organisation set for the request; it does not protect against arbitrary SQL execution by
that role.

## Tenant boundary results

| Read set | Application boundary | RLS probe | Result |
| --- | ---: | ---: | --- |
| Customer A work items | 600 | 600 | Same valid tenant rows |
| Customer A comments | 600 | 600 | Same valid parent-consistent rows |
| Customer A attachments | 602 | 602 | Same rows by parent workspace |
| Internal staff work items | 1,200 across internal + A + B | 1,200 | Multi-organisation reach works |
| Internal staff comments | 1,200 | 1,200 | Same tenant set |
| Internal staff attachments | 1,202 | 1,202 | Same tenant set |

The application actor fixture reaches 900 work items across its three allowed projects.
The RLS staff scope sees 300 additional work items in the other customer-A project.
That is expected: organisation-level RLS is a tenant backstop, not a replacement for
project membership, capability evaluation, or `sees_all` rules.

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
| Work item list page | RLS off | 101 | 1.244 | 1.732 | 0.533 | 46 / 0 |
| Work item list page | RLS on | 101 | 1.449 | 2.399 | 0.381 | 24 / 0 |
| Comment detail | RLS off | 2 | 0.815 | 0.957 | 0.036 | 4 / 0 |
| Comment detail | RLS on | 1 | 1.331 | 1.661 | 0.140 | 13 / 0 |
| Attachment detail | RLS off | 2 | 0.783 | 0.900 | 0.057 | 4 / 0 |
| Attachment detail | RLS on | 2 | 1.607 | 1.867 | 0.152 | 18 / 0 |

The benchmark SQL follows the current list, comment activity, and attachment controller
read predicates. It does not call HTTP handlers. The comment row-count difference is the
intentionally corrupt workspace-mismatch comment: the baseline query sees it by
`work_item_id`, while RLS rejects it. The clean application-boundary comparison above
uses the tenant's parent work-item relationship and matches for valid comments. The
attachment plan adds parent and tenant checks; observed shared reads remained zero in this
small warmed fixture. Larger and realistic distributions are still needed to assess plan
stability and production costs.

## Test evidence

* `pnpm --filter @taskdesk/api exec vitest run --silent=false --reporter=verbose --config vitest.rls-prototype.config.ts` — **1 test passed**, on this base and current test-only worktree.
* `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.rls-prototype.json` — **passed** after building the workspace `@taskdesk/email` type declarations required by the API test project.
* `pnpm lint:ci` — **passed**, checked 1,621 files, with 123 warnings.
* `pnpm typecheck` — **passed**, all 9 workspace tasks succeeded.
* `pnpm test` — **failed** on the refreshed review branch. The API suite reported 64/66 files passed and 525/529 tests passed (four failures across two files; one reported failure is in `tests/api/storage/index.test.ts`, where a temp storage path is rejected as a symlink escape). The web suite reported four failures in `src/hooks/use-task-filters-with-labels-support.test.tsx`. These paths are untouched by this test-only change; the failure is recorded rather than treated as a passing gate.
* `pnpm check:env` — **passed**; the test harness lives under `tests/`, which the check
  does not scan as application runtime. Within its 29 application environment-read
  occurrences, the checker attributed every occurrence to the configuration reference.
  This does not clear the separate existing environment ratchet findings: the repository
  audit still records 49 active unapproved names and two unattributable files (issue #10).
* `pnpm exec biome check ...` — completed with exit 0; reports three expected warnings
  about the isolated test-only `RLS_PROTOTYPE_DATABASE_URL` not being declared in Turbo
  task environment metadata, plus style suggestions. The suite is run directly with
  Vitest, not through a cached Turbo task.

This document is evidence for the RLS P0 prototype decision, not a claim that P0 or the
RLS work is complete. Any adoption, runtime wrapper, policy/migration, or status/decision
log change requires its own authorized task and normal review.
