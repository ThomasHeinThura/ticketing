/**
 * Tables that are append-only by grant, not only by the absence of an update/delete
 * endpoint (issue #296; `docs/04-engineering/migrations.md` § Append-only tables;
 * decision log 2026-09-23 "audit_log is append-only by trigger, not by grant").
 *
 * `ensureApplicationRole` (./ensure-application-role.ts) grants the application role
 * `SELECT, INSERT` only on every table named here, and `SELECT, INSERT, UPDATE, DELETE`
 * on every other ordinary table. `audit_log` (migration `0067`, issue #37) also has its
 * own `BEFORE UPDATE OR DELETE`/`BEFORE TRUNCATE` triggers, which reject a mutation
 * regardless of grant — the two controls are deliberately redundant (`migrations.md`).
 * A future table named here before its own migration lands is a harmless no-op:
 * `ensureApplicationRole` only grants on tables that actually exist.
 *
 * Named here, not computed from a table's schema (e.g. "no `updatedAt` column"),
 * because append-only-ness is a deliberate policy decision about a table, not something
 * reliably inferable from its shape — do-not 11's "single authoritative document" for
 * this concept is `migrations.md`, and this list is this file's mirror of it in code.
 */
export const APPEND_ONLY_TABLES: readonly string[] = ["activity", "audit_log"];
