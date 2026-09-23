import { sql } from "drizzle-orm";
import type { DatabaseInstance } from "./index";

/**
 * Issue #296's deploy-time check: fails startup loudly if the connection the API is
 * about to serve every request through turns out to be a Postgres superuser, or
 * owns any table. Every database-level control this project has (append-only
 * grants, no `TRUNCATE`, no DDL) assumes the application role is neither — a
 * compromised API process that is a superuser or a table owner can undo any of
 * them (`DISABLE TRIGGER`, `ALTER TABLE ... OWNER TO`, drop and recreate with no
 * grants at all), which is exactly what #296 was opened to close.
 *
 * Run once at boot, against `getDatabase()` (the application pool), immediately
 * after `ensureApplicationRole` has had a chance to create/fix the role — not on
 * every `/api/public/health/ready` poll. A per-request or per-poll query here would
 * run this check dozens of times a minute for a fact that cannot change without a
 * restart (nothing in this codebase alters a role's privileges except
 * `ensureApplicationRole`, which only ever runs at boot); the boot check is the
 * least invasive option that still satisfies #296's "Done when" — a check that
 * asserts it, not a comment that assumes it.
 */
export async function assertApplicationRoleIsNotPrivileged(
  appDb: DatabaseInstance,
): Promise<void> {
  const superuserCheck = await appDb.execute(
    sql`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`,
  );
  const isSuperuser = Boolean(
    (superuserCheck.rows[0] as { rolsuper?: boolean } | undefined)?.rolsuper,
  );

  if (isSuperuser) {
    throw new Error(
      "Refusing to start: the application database connection (TASKDESK_DATABASE_URL) " +
        "is a Postgres superuser. Every append-only/no-DDL control this project relies " +
        "on assumes it is not (issue #296). Point TASKDESK_DATABASE_URL at a " +
        "non-superuser application role and TASKDESK_MIGRATION_DATABASE_URL at the " +
        "owner role that runs migrations. See docs/05-operations/configuration-reference.md.",
    );
  }

  const ownedTables = await appDb.execute(
    sql`SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tableowner = current_user
        LIMIT 5`,
  );

  if (ownedTables.rows.length > 0) {
    const sample = (ownedTables.rows as Array<{ tablename: string }>)
      .map((row) => row.tablename)
      .join(", ");

    throw new Error(
      "Refusing to start: the application database connection (TASKDESK_DATABASE_URL) " +
        `owns ${ownedTables.rows.length === 5 ? "at least " : ""}${
          ownedTables.rows.length
        } table(s) in schema "public" (e.g. ${sample}). The application role must never ` +
        "own a table — a table's owner bypasses every GRANT on it, including the " +
        "append-only restriction (issue #296). Run migrations as " +
        "TASKDESK_MIGRATION_DATABASE_URL's role, not as the application role.",
    );
  }
}
