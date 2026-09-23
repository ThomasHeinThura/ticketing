import { sql } from "drizzle-orm";
import { APPEND_ONLY_TABLES } from "./append-only-tables";
import type { DatabaseInstance } from "./index";
import { resolveDatabaseConfig } from "./resolve-database-url";

/**
 * Advisory-lock namespace for this file's `CREATE ROLE`/grant sequence (issue #296,
 * non-blocking finding from the independent review of this PR: two replicas
 * booting at once raced on `CREATE ROLE` in 2 of 5 live trials, one crashing with a
 * duplicate-object error). Single-argument form, like `auth.ts`'s
 * `pg_advisory_xact_lock(2026)` admin-promotion lock — this serializes the whole
 * function globally rather than per-entity, since there is exactly one application
 * role to create, not one per project/workspace the way `1524`/`4002`/`4003`/`4004`
 * are. Distinct from every namespace already in use: `1524` (project create/
 * reorder), `2026` (auth.ts admin promotion), `4002` (workspace membership), `4003`
 * (workspace role), `4004` (column seed), `4010` (audit chain).
 */
const ENSURE_APPLICATION_ROLE_LOCK_NAMESPACE = 4_011;

/**
 * Issue #296: split the database role the API runs migrations as from the role it
 * serves requests as. `migrationDb` (`getMigrationDatabase()`) is the owner
 * connection — it owns every table and is allowed to run DDL, and on a fresh
 * bundled-Postgres deployment is literally the image's `POSTGRES_USER`, which the
 * official postgres image makes a superuser at cluster init — unavoidable for that
 * one role, per #296's "Done when". It runs this function, once, after every
 * schema-changing startup step (`runStartupTasks` in `apps/api/src/index.ts`) —
 * never the application role itself, which must never have DDL rights.
 *
 * Idempotent and re-run on every boot rather than shipped as a one-shot Drizzle
 * migration, for two reasons: (1) it needs the application role's password, which
 * comes from `TASKDESK_DATABASE_URL` at deploy time — a Drizzle migration is a
 * static file, journal-tracked to run exactly once, and cannot carry a value that
 * differs per deployment or that an operator may rotate; re-running
 * `ALTER ROLE ... WITH PASSWORD` every boot keeps the role's password in sync with
 * whatever secret the deployment is currently configured with. (2) the set of
 * append-only tables (`./append-only-tables.ts`) can grow, and re-deriving the
 * grant set from the current table list on every boot means a newly-added
 * append-only table gets its restricted grant the next time the API starts, with
 * no separate migration required.
 *
 * `ALTER DEFAULT PRIVILEGES` is set once here (also idempotent — Postgres treats a
 * repeat identically to the first) so a table a *future* migration creates gets the
 * ordinary (SELECT/INSERT/UPDATE/DELETE) grant automatically, without this function
 * having to run again first. A future append-only table's *restricted* grant is not
 * something a blanket default can express — adding its name to `APPEND_ONLY_TABLES`
 * narrows it down to SELECT/INSERT the next time the API boots, same as `audit_log`
 * and `activity` are handled today.
 */
export async function ensureApplicationRole(
  migrationDb: DatabaseInstance,
): Promise<void> {
  const appConfig = resolveDatabaseConfig();
  const roleName = appConfig.username;
  const password = extractPassword(appConfig.connectionString);

  if (!roleName) {
    throw new Error(
      "Cannot ensure the application database role: TASKDESK_DATABASE_URL has no username.",
    );
  }
  if (!password) {
    throw new Error(
      "Cannot ensure the application database role: TASKDESK_DATABASE_URL has no password.",
    );
  }

  // One query answers both "what is the owner role's own name" (needed below, for
  // `ALTER DEFAULT PRIVILEGES FOR ROLE`) and "is that the SAME role the application
  // is about to connect as" (the single-URL-mode guard) — the latter via Postgres's
  // own `current_user = ...` comparison rather than comparing two independently
  // derived JS strings (non-blocking finding from the independent review of this
  // PR: a JS-side string compare of a locally re-parsed URL username against a
  // separately-queried `current_user` is one avoidable source of a case or
  // encoding mismatch; asking Postgres to do the comparison itself removes that
  // whole class of divergence).
  const ownerInfo = await migrationDb.execute(
    sql`SELECT current_user AS name, (current_user = ${roleName}) AS is_same_role`,
  );
  const ownerRow = ownerInfo.rows[0] as
    | { name?: string; is_same_role?: boolean }
    | undefined;
  if (!ownerRow?.name) {
    throw new Error(
      "Could not determine the current (migration/owner) database role.",
    );
  }
  const ownerRoleName = ownerRow.name;
  const isSingleUrlMode = Boolean(ownerRow.is_same_role);

  // Single-URL mode (`TASKDESK_MIGRATION_DATABASE_URL` unset, resolveMigrationDatabaseConfig's
  // documented fallback): the migration connection IS the application connection, so
  // `roleName` here is literally the role this function is currently running as. There is
  // nothing to create, and altering it — in particular `NOSUPERUSER`, which a role can
  // apply to itself — would mutate a role that may be shared far outside this one
  // database (the cluster-wide `postgres` role on a shared Postgres instance, for
  // instance), which is a much bigger blast radius than this deployment's own tables.
  // Skip entirely; `assertApplicationRoleIsNotPrivileged` (called right after this
  // function, over the now-first-connected application pool) is what surfaces the actual
  // problem if that shared role turns out to be unsafe — a loud startup failure, not a
  // silent mutation of a role other things depend on.
  if (isSingleUrlMode) {
    console.log(
      `🛈 Application role "${roleName}" is the same as the migration/owner role ` +
        "(TASKDESK_MIGRATION_DATABASE_URL is unset — single-URL mode); skipping role " +
        "creation. assertApplicationRoleIsNotPrivileged will refuse to start if this " +
        "is not safe.",
    );
    return;
  }

  const quotedRole = quoteIdentifier(roleName);
  const quotedPassword = quoteLiteral(password);
  const ownerRole = quoteIdentifier(ownerRoleName);

  console.log(`🔄 Ensuring application database role "${roleName}"...`);

  // Everything below runs in one transaction, guarded by an advisory lock held for
  // its duration (issue #296, non-blocking finding from the independent review of
  // this PR: two replicas booting at once raced on `CREATE ROLE` — reproduced live,
  // 2 of 5 trials, one crashing with a duplicate-object error). A second replica
  // blocks here until the first commits, then finds the role already created and
  // takes the idempotent `ALTER ROLE`/re-`GRANT` path instead of racing it.
  await migrationDb.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${ENSURE_APPLICATION_ROLE_LOCK_NAMESPACE})`,
    );

    const roleExists = await tx.execute(
      sql`SELECT 1 FROM pg_roles WHERE rolname = ${roleName}`,
    );

    if (roleExists.rows.length === 0) {
      // NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOBYPASSRLS are Postgres's own defaults for
      // `CREATE ROLE`; spelled out here so the intent — this role can never become a
      // superuser by inheriting a default that later changes — is readable without
      // knowing Postgres's defaults.
      await tx.execute(
        sql.raw(
          `CREATE ROLE ${quotedRole} LOGIN PASSWORD ${quotedPassword} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
        ),
      );
    } else {
      // Re-applied every boot so a rotated TASKDESK_DATABASE_URL password takes effect,
      // and so a role that was ever manually altered to be a superuser is forced back —
      // this line is as much an enforcement of the invariant as it is a convenience.
      await tx.execute(
        sql.raw(
          `ALTER ROLE ${quotedRole} WITH LOGIN PASSWORD ${quotedPassword} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
        ),
      );
    }

    await tx.execute(
      sql.raw(
        `GRANT CONNECT ON DATABASE ${quoteIdentifier(appConfig.database)} TO ${quotedRole}`,
      ),
    );
    await tx.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${quotedRole}`));

    const existingTables = await tx.execute(
      sql`SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const appendOnly = new Set(APPEND_ONLY_TABLES);

    for (const row of existingTables.rows as Array<{ table_name: string }>) {
      const tableName = row.table_name;
      const quotedTable = quoteIdentifier(tableName);

      // REVOKE ALL first, then grant exactly the intended set: makes this idempotent
      // regardless of what a previous run (or a manually-run GRANT) left in place —
      // a table that moves into APPEND_ONLY_TABLES loses UPDATE/DELETE the next boot
      // instead of keeping whatever it was first granted.
      await tx.execute(
        sql.raw(`REVOKE ALL ON TABLE ${quotedTable} FROM ${quotedRole}`),
      );

      if (appendOnly.has(tableName)) {
        await tx.execute(
          sql.raw(
            `GRANT SELECT, INSERT ON TABLE ${quotedTable} TO ${quotedRole}`,
          ),
        );
      } else {
        await tx.execute(
          sql.raw(
            `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${quotedTable} TO ${quotedRole}`,
          ),
        );
      }
    }

    // Sequences: identity columns (e.g. `activity.seq`) and any plain `serial`/
    // `bigserial` column need USAGE (nextval) and SELECT (currval) on their backing
    // sequence — table privileges alone do not cover it.
    await tx.execute(
      sql.raw(
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quotedRole}`,
      ),
    );

    // Future migrations: a table or sequence created by a later `migrate()` run gets
    // the ordinary grant automatically, without this function needing to run again
    // first. `FOR ROLE` names the role that will own the future object — the
    // migration/owner role running this function right now.
    await tx.execute(
      sql.raw(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRole}`,
      ),
    );
    await tx.execute(
      sql.raw(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${quotedRole}`,
      ),
    );
  });

  console.log(`✅ Application database role "${roleName}" is ready`);
}

function extractPassword(connectionString: string): string {
  return decodeURIComponent(new URL(connectionString).password);
}

/** Quotes a SQL identifier (role, table, schema, database name). */
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Quotes a SQL string literal. Standard-conforming strings (Postgres's default)
 * treat `\` literally, so only the enclosing `'` needs doubling. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
