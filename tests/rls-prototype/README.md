# PostgreSQL RLS prototype (test-only)

This is an isolated experiment for the P0 decision in
docs/01-architecture/multi-tenancy.md and the 2026-09-06 decision-log entry. It applies
temporary policies to a fresh PostgreSQL 18 Testcontainer after applying the repository's
real Drizzle migrations. It does not alter a migration, application schema, runtime
connection wrapper, role grants, CI, or production policy.

Run from the repository root:

    pnpm --filter @taskdesk/api exec vitest run --config vitest.rls-prototype.config.ts
    pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.rls-prototype.json

The dedicated Vitest globalSetup always creates its own container and does not inspect
TASKDESK_DATABASE_URL or .env. The test connects only to the container URL created by
that setup. Container startup requires Docker. No local-development, UAT, or production
database is a valid target.

The prototype tests a transaction-local
taskdesk.rls_organisation_ids GUC as a comma-separated set of organisation IDs resolved
by the caller. This is a test contract, not a production setting or connection wrapper.
The test explicitly demonstrates that the database role can change this custom GUC; a
runtime integration must derive it from trusted authorization context. RLS is not an
independent identity authority. The application remains responsible for exact
project/actor authorization. A set of tenant organisations allows an internal staff
scope to span customers; it intentionally does not encode project membership or
`sees_all` authority.

The live database source does not match all of the intended model: data-model.md §3
declares nullable project.organisation_id, but the current project table has no such
column. The fixture uses the available authoritative chain
work_item.workspace_id -> workspace.organisation_id, and comment.workspace_id ->
workspace.organisation_id plus the comment's parent work_item consistency check. It
creates customer workspaces directly in this isolated database because no current
application writer creates them. For attachments, the parent workspace determines the
tenant; attachment.organisation_id is separately compared with its documented
representation (customer organisation ID, or NULL for an internal organisation). A
deliberately mismatched fixture is reported, never treated as evidence that the field can
safely be ignored. Submission-parent attachments are not covered by this first prototype.

The run records three evidence groups:

1. Pool reuse with a single connection and transaction-local GUCs, including commit,
   rollback, unset/empty values, and cross-organisation request order.
2. A tenant-level RLS boundary for a customer and internal staff with cross-customer reach.
   Project-specific actor authorization is compared separately to show where RLS is
   intentionally broader than the application.
3. Alternating paired relative timings and EXPLAIN (ANALYZE, BUFFERS) for representative
   work-item list, comment detail, and attachment detail queries. Both modes use a
   dedicated one-connection, non-owner role with the same SELECT grants; the baseline
   role has BYPASSRLS and the probe role is NOBYPASSRLS. This compares policy overhead
   without a superuser query role.

Timing is an experimental local sample, not a production forecast. The report belongs in
docs/07-planning/rls-prototype-results.md only after the Testcontainers run completes.
