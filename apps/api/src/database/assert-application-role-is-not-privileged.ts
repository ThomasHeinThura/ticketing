import { sql } from "drizzle-orm";
import type { DatabaseInstance } from "./index";

/**
 * Predefined Postgres roles that grant a powerful capability purely through
 * membership — none of them show up as `rolsuper`/`rolcreaterole`/`rolbypassrls`/
 * `rolreplication` on the member role itself, so they need their own check.
 * `pg_write_server_files`/`pg_read_server_files`/`pg_execute_server_program` reach
 * the filesystem and can execute arbitrary programs as the postgres OS user;
 * `pg_signal_backend` can cancel/terminate other sessions' backends, a
 * denial-of-service primitive; `pg_database_owner` (Postgres 14+) means whatever the
 * CURRENT database's owner can do, which varies by deployment and is never
 * something the application role should inherit.
 */
const DANGEROUS_PREDEFINED_ROLES = new Set([
  "pg_write_server_files",
  "pg_read_server_files",
  "pg_execute_server_program",
  "pg_signal_backend",
  "pg_database_owner",
]);

type ReachableRole = {
  rolname: string;
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolbypassrls: boolean;
  rolreplication: boolean;
};

/**
 * Issue #296's deploy-time check, and the independent Opus/Sonnet review of this
 * PR's first version (finding: "misses role-membership escalation" — reproduced
 * live: `GRANT postgres TO taskdesk_app` made the original, narrower version of
 * this check pass, and the app connection could then `SET ROLE postgres`).
 *
 * The original version asked "is `current_user` itself a superuser, and does
 * `current_user` itself own a table" — two questions about one role. The real
 * question is broader: **every role this connection can act as**, whether by
 * ordinary inherited membership or by `SET ROLE`, must be free of every privilege
 * and every piece of ownership that would let it undo the append-only/no-DDL
 * controls #296 exists to protect. A role that is merely a *member* of a
 * superuser role is not itself marked `rolsuper` — but `SET ROLE` makes it one for
 * the rest of that session, which is exactly the escape hatch the original check
 * missed.
 *
 * `pg_has_role(current_user, r.oid, 'MEMBER')` is Postgres's own answer to "can
 * this session become role r" — per the Postgres docs, `MEMBER` denotes direct or
 * indirect membership without regard to whether it is INHERIT-marked, which is
 * precisely "reachable via `SET ROLE`, whether or not it is auto-inherited" (the
 * live reproduction above did not even need an explicit `SET ROLE`-eligible grant
 * — plain membership was enough for the attacker to `SET ROLE` afterwards). This
 * query always includes `current_user` itself (a role trivially has `MEMBER`
 * standing in itself), so the single query below subsumes the original
 * `rolname = current_user` check as a special case rather than needing it
 * separately.
 *
 * For every role in that reachable set, this refuses to boot if any of them:
 *   - is a superuser, can create roles, bypasses row-level security, or can
 *     initiate replication (`rolsuper`/`rolcreaterole`/`rolbypassrls`/
 *     `rolreplication`) — each one is its own path to defeating a grant-based
 *     control, not just superuser;
 *   - is itself one of the predefined roles above, reached via membership;
 *   - owns anything in `pg_class` (every relkind — tables, views, materialized
 *     views, sequences, indexes, foreign tables, partitioned tables — not just
 *     `pg_tables`, which is base tables only and is what the original version
 *     checked), `pg_proc` (functions/procedures), `pg_namespace` (schemas — no
 *     schema is an expected exception; the application role owns none by design),
 *     or `pg_type` (including domains and enums, which only ever exist if
 *     something created one — the application role runs no DDL, so any hit here
 *     is as real a signal as a table).
 *
 * Run once at boot, against `getDatabase()` (the application pool), immediately
 * after `ensureApplicationRole` has had a chance to create/fix the role — not on
 * every `/api/public/health/ready` poll. A per-request or per-poll query here would
 * run this check dozens of times a minute for a fact that cannot change without a
 * restart (nothing in this codebase alters a role's privileges or memberships
 * except `ensureApplicationRole`, which only ever runs at boot); the boot check is
 * the least invasive option that still satisfies #296's "Done when" — a check that
 * asserts it, not a comment that assumes it.
 */
export async function assertApplicationRoleIsNotPrivileged(
  appDb: DatabaseInstance,
): Promise<void> {
  const reachable = await appDb.execute(
    sql`SELECT
          r.oid::int AS oid,
          r.rolname,
          r.rolsuper,
          r.rolcreaterole,
          r.rolbypassrls,
          r.rolreplication
        FROM pg_roles r
        WHERE pg_has_role(current_user, r.oid, 'MEMBER')
        -- Most severe/most legible finding first: when a connection is reachable
        -- to more than one flagged role at once (a superuser that also happens to
        -- be, say, the current database's owner via pg_database_owner), the
        -- superuser reason is what an operator should see, not whichever row
        -- Postgres happened to return first with no ORDER BY.
        ORDER BY r.rolsuper DESC, r.rolcreaterole DESC, r.rolbypassrls DESC,
                 r.rolreplication DESC, r.oid`,
  );

  const roles = reachable.rows as Array<ReachableRole & { oid: number }>;

  if (roles.length === 0) {
    // Cannot happen (a role always has MEMBER standing in itself) — fail closed
    // rather than silently treating "no rows" as "nothing to worry about".
    throw new Error(
      "Refusing to start: could not determine the application database " +
        "connection's own role membership (issue #296). This should be " +
        "impossible — a role is always a member of itself.",
    );
  }

  for (const role of roles) {
    const flags: Array<[string, boolean]> = [
      ["rolsuper (superuser)", role.rolsuper],
      ["rolcreaterole (can create/alter other roles)", role.rolcreaterole],
      ["rolbypassrls (bypasses row-level security)", role.rolbypassrls],
      ["rolreplication (can initiate replication)", role.rolreplication],
    ];

    for (const [label, present] of flags) {
      if (present) {
        throw new Error(
          "Refusing to start: the application database connection " +
            `(TASKDESK_DATABASE_URL, connected as "${roles[0]?.rolname}") can act ` +
            `as role "${role.rolname}" (directly or via membership/SET ROLE), ` +
            `which has ${label}. Every append-only/no-DDL control this project ` +
            "relies on assumes the application connection can never reach a " +
            "role with this privilege, through any path (issue #296). Remove " +
            `"${role.rolname}"'s ${label.split(" ")[0]} attribute, or revoke ` +
            `the application role's membership in "${role.rolname}". See ` +
            "docs/05-operations/configuration-reference.md.",
        );
      }
    }

    if (DANGEROUS_PREDEFINED_ROLES.has(role.rolname)) {
      throw new Error(
        "Refusing to start: the application database connection " +
          `(TASKDESK_DATABASE_URL, connected as "${roles[0]?.rolname}") is a ` +
          `member of the predefined role "${role.rolname}", which grants a ` +
          "capability no application role should hold (server-side file access, " +
          "arbitrary program execution, or backend termination, depending on the " +
          `role). Revoke membership in "${role.rolname}" (issue #296). See ` +
          "docs/05-operations/configuration-reference.md.",
      );
    }
  }

  const roleOids = roles.map((role) => role.oid);
  if (roleOids.some((oid) => !Number.isInteger(oid))) {
    // Defensive: every `oid` here came straight from `pg_roles.oid::int` above, so
    // this should be unreachable — fail closed rather than let a non-integer value
    // reach the `IN (...)` literal below.
    throw new Error(
      "Refusing to start: could not read the application database connection's " +
        "reachable role OIDs as integers (issue #296).",
    );
  }

  // `sql`'s tagged template flattens a JS array VALUE into a comma list of bound
  // parameters (for `IN (${list})`-style expansion) rather than binding it as a
  // single Postgres array, so `= ANY(${roleOids})` does not do what it looks like —
  // with one element it sends a bare scalar where `ANY` needs an array, and
  // Postgres rejects it ("malformed array literal"). `roleOids` are `::int` values
  // we just read back from `pg_roles.oid` ourselves, never user input, so building
  // the literal `IN (...)` list directly is safe — the same trust boundary every
  // other `sql.raw` call in this file already relies on (identifiers/values this
  // module derived from a prior query or from `resolveDatabaseConfig()`, never from
  // an unvalidated external source).
  const oidList = roleOids.length > 0 ? roleOids.join(",") : "-1";

  const ownershipChecks: Array<{
    label: string;
    query: ReturnType<typeof sql>;
  }> = [
    {
      label: "a relation in pg_class (table, view, sequence, index, etc.)",
      query: sql.raw(
        `SELECT relname AS name FROM pg_class WHERE relowner IN (${oidList}) LIMIT 5`,
      ),
    },
    {
      label: "a function or procedure in pg_proc",
      query: sql.raw(
        `SELECT proname AS name FROM pg_proc WHERE proowner IN (${oidList}) LIMIT 5`,
      ),
    },
    {
      label: "a schema in pg_namespace (no schema is an expected exception)",
      query: sql.raw(
        `SELECT nspname AS name FROM pg_namespace WHERE nspowner IN (${oidList}) LIMIT 5`,
      ),
    },
    {
      label: "a type (including a domain or enum) in pg_type",
      query: sql.raw(
        `SELECT typname AS name FROM pg_type WHERE typowner IN (${oidList}) LIMIT 5`,
      ),
    },
  ];

  for (const check of ownershipChecks) {
    const result = await appDb.execute(check.query);
    if (result.rows.length > 0) {
      const sample = (result.rows as Array<{ name: string }>)
        .map((row) => row.name)
        .join(", ");

      throw new Error(
        "Refusing to start: the application database connection " +
          `(TASKDESK_DATABASE_URL, connected as "${roles[0]?.rolname}") — or a ` +
          "role it can act as via membership/SET ROLE — owns " +
          `${check.label} (e.g. ${sample}). The application role, and every role ` +
          "it can reach, must own nothing: an owner bypasses every GRANT on what " +
          "it owns, including the append-only restriction (issue #296). Run " +
          "migrations as TASKDESK_MIGRATION_DATABASE_URL's role, not as the " +
          "application role or anything it is a member of.",
      );
    }
  }
}
