import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import db, { getDatabasePool } from "../../../apps/api/src/database";
import { migrateWithMembershipProvenanceCutover } from "../../../apps/api/src/database/migrate-membership-provenance";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../../apps/api/drizzle");

let migrationPromise: Promise<void> | null = null;

function getDatabaseName(connectionString: string) {
  return new URL(connectionString).pathname.replace(/^\//, "");
}

function getAdminDatabaseUrl(connectionString: string) {
  const url = new URL(connectionString);
  url.pathname = "/postgres";
  return url.toString();
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function ensureTestDatabaseExists() {
  const connectionString = process.env.TASKDESK_DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "TASKDESK_DATABASE_URL must be defined for integration tests",
    );
  }

  const databaseName = getDatabaseName(connectionString);

  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to manage non-test database "${databaseName}". TASKDESK_DATABASE_URL must point to a test database.`,
    );
  }

  const adminClient = new Client({
    connectionString: getAdminDatabaseUrl(connectionString),
  });

  await adminClient.connect();

  try {
    const result = await adminClient.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName],
    );

    if (result.rowCount === 0) {
      await adminClient.query(
        `CREATE DATABASE ${quoteIdentifier(databaseName)}`,
      );
    }
  } finally {
    await adminClient.end();
  }
}

export async function ensureTestDatabaseMigrated() {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      await ensureTestDatabaseExists();
      await migrateWithMembershipProvenanceCutover({
        database: db,
        pool: getDatabasePool(),
        migrationsFolder,
      });
    })();
  }

  try {
    await migrationPromise;
  } catch (error) {
    migrationPromise = null;
    throw error;
  }
}

// Ponytail: query Postgres directly. The catalog is the canonical source of
// what tables actually exist after migrations run. Reflecting on the schema
// object in apps/api/src/database misses any table that is not exported from
// the index.ts registry (for example task_reminder_sent). It used to name
// mcp_oauth_state too; #6 dropped that table in migration 0048.
async function listPublicTableNames(): Promise<string[]> {
  const result = await db.execute<{ table_name: string }>(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  return result.rows.map((row) => row.table_name);
}

function hasPostgresSqlState(error: unknown, expectedState: string) {
  let current = error;
  const visited = new Set<object>();
  while (typeof current === "object" && current !== null) {
    if (visited.has(current)) return false;
    visited.add(current);
    if ("code" in current && current.code === expectedState) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

export async function resetTestDatabase(options?: {
  onLockUnavailable?: (details: {
    attempt: number;
    error: unknown;
  }) => void | Promise<void>;
}) {
  await ensureTestDatabaseExists();
  let tableNames = await listPublicTableNames();

  if (tableNames.length === 0) {
    await ensureTestDatabaseMigrated();
    tableNames = await listPublicTableNames();
  }

  if (tableNames.length === 0) {
    throw new Error(
      "resetTestDatabase found no tables to truncate. Did migrations run?",
    );
  }

  const formattedTableNames = tableNames.map(quoteIdentifier).join(", ");

  // Take the same all-table locks TRUNCATE needs, but NOWAIT. Otherwise a test reset can
  // hold locks on early tables while waiting for a reader of a later table, as that reader
  // waits on an earlier lock: a lock-order cycle even though tests are serialized. A failed
  // lock statement aborts this transaction, releasing every partial lock before retry.
  const lockRetryDelaysMs = [10, 25, 50, 100] as const;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL session_replication_role = replica`);
        try {
          await tx.execute(
            sql.raw(
              `LOCK TABLE ${formattedTableNames} IN ACCESS EXCLUSIVE MODE NOWAIT`,
            ),
          );
        } catch (error) {
          if (hasPostgresSqlState(error, "55P03")) {
            throw new ResetLockUnavailableError(error);
          }
          throw error;
        }
        // `audit_log`'s own append-only triggers correctly refuse an ordinary TRUNCATE.
        // Disable user-defined triggers only for this transaction; TRUNCATE CASCADE remains
        // driven by FK metadata.
        await tx.execute(
          sql.raw(
            `TRUNCATE TABLE ${formattedTableNames} RESTART IDENTITY CASCADE`,
          ),
        );
      });
      break;
    } catch (error) {
      if (!(error instanceof ResetLockUnavailableError)) throw error;
      await options?.onLockUnavailable?.({
        attempt: attempt + 1,
        error: error.original,
      });
      if (attempt >= lockRetryDelaysMs.length) {
        throw new Error(
          `Could not acquire all test-reset table locks after ${attempt + 1} attempts`,
          { cause: error.original },
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, lockRetryDelaysMs[attempt]),
      );
    }
  }

  await ensureTestDatabaseMigrated();
}

class ResetLockUnavailableError extends Error {
  constructor(readonly original: unknown) {
    super("Could not acquire a test-reset table lock immediately");
    this.name = "ResetLockUnavailableError";
  }
}
