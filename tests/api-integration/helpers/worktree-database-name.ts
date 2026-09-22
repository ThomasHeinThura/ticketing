import { basename } from "node:path";

// #113: when no test database is configured (no TASKDESK_DATABASE_URL, no
// .env fallback), each git worktree/lane needs a *different* default
// database rather than one shared name — concurrent lanes truncating each
// other's rows produced failures that looked like real defects
// (docs/07-planning/decision-log.md and issue #113 have the full incident).
//
// This module derives that per-worktree default. It is pure (no fs/env
// access beyond `basename`) so it can be unit tested without a live
// database; `tests/api-integration/setup.ts` is the only caller.

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 5432;
const DEFAULT_USER = "postgres";
const DEFAULT_PASSWORD = "postgres";

const PREFIX = "taskdesk_";
const SUFFIX = "_test";

// Postgres identifiers are truncated (silently) past NAMEDATALEN - 1 = 63
// bytes -- see #241, where a generated constraint name crossed that limit
// unnoticed. Keep the derived database name comfortably clear of it: the
// worktree-derived segment gets whatever is left after the fixed prefix and
// suffix.
const POSTGRES_IDENTIFIER_LIMIT = 63;
const MAX_WORKTREE_SEGMENT_LENGTH =
  POSTGRES_IDENTIFIER_LIMIT - PREFIX.length - SUFFIX.length;

const FALLBACK_SEGMENT = "default";

/**
 * Sanitises an arbitrary worktree directory name into a valid, bounded
 * fragment of a Postgres identifier: lowercase, ASCII alphanumeric and
 * underscore only, no leading/trailing/doubled underscores, and no longer
 * than `MAX_WORKTREE_SEGMENT_LENGTH`. Never returns an empty string.
 */
export function sanitizeWorktreeSegment(rawName: string): string {
  const withUnderscores = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const trimmed = withUnderscores.replace(/^_+|_+$/g, "");
  const truncated = trimmed
    .slice(0, MAX_WORKTREE_SEGMENT_LENGTH)
    .replace(/_+$/, "");

  return truncated || FALLBACK_SEGMENT;
}

/**
 * Derives the per-worktree default test database name, e.g.
 * `taskdesk_feat_113_per_worktree_test_db_default_test`. Always ends in
 * `_test`, satisfying the existing safety guard in
 * `tests/api-integration/helpers/database.ts` that refuses to run
 * destructive operations (TRUNCATE, CREATE DATABASE) against a database
 * whose name doesn't end in `_test`.
 */
export function deriveWorktreeTestDatabaseName(worktreePath: string): string {
  const segment = sanitizeWorktreeSegment(basename(worktreePath));
  return `${PREFIX}${segment}${SUFFIX}`;
}

/**
 * Derives the full connection string used as the default when
 * TASKDESK_DATABASE_URL is unset and no .env fallback is found. Host, port
 * and credentials match the previous fixed shared default
 * (postgresql://postgres:postgres@localhost:5432/taskdesk_test) -- only the
 * database name becomes worktree-specific.
 */
export function deriveWorktreeTestDatabaseUrl(worktreePath: string): string {
  const databaseName = deriveWorktreeTestDatabaseName(worktreePath);
  return `postgresql://${DEFAULT_USER}:${DEFAULT_PASSWORD}@${DEFAULT_HOST}:${DEFAULT_PORT}/${databaseName}`;
}
