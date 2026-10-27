import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import db, { getDatabasePool, schema } from "../../../apps/api/src/database";
import { migrateWithMembershipProvenanceCutover } from "../../../apps/api/src/database/migrate-membership-provenance";
import { invalidateFeatureFlagCache } from "../../../apps/api/src/feature-flag/enforce";
import { assertDisposableTestDatabaseUrl } from "./disposable-database";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../../apps/api/drizzle");

let migrationPromise: Promise<void> | null = null;
let ensuredDatabaseConnectionString: string | null = null;
/** Module state, so it restarts with every test file (Vitest isolates each file's modules). */
let resetsSinceTruncate = 0;
const RESETS_PER_TRUNCATE = 50;

function getDatabaseName(connectionString: string) {
  return assertDisposableTestDatabaseUrl(connectionString);
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

  if (ensuredDatabaseConnectionString === connectionString) {
    return;
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
    ensuredDatabaseConnectionString = connectionString;
  } finally {
    await adminClient.end();
  }
}

export async function ensureTestDatabaseMigrated() {
  // Check every invocation, including a cached migration, before any reset can run.
  assertDisposableTestDatabaseUrl(process.env.TASKDESK_DATABASE_URL ?? "");
  const actualConnection = getDatabasePool().options.connectionString;
  if (typeof actualConnection !== "string") {
    throw new Error(
      "Integration fixtures require a PostgreSQL connection string",
    );
  }
  assertDisposableTestDatabaseUrl(actualConnection);
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
async function listPublicTables(): Promise<{
  allTableNames: string[];
  dirtyTableNames: string[];
  autovacuumTableNames: string[];
}> {
  const result = await db.execute<{
    table_name: string;
    needs_truncate: boolean;
    autovacuum: boolean;
  }>(sql`
    SELECT
      c.relname AS table_name,
      (
        pg_relation_size(c.oid) > 0
        OR c.relname IN ('activity', 'audit_log', 'submission')
      ) AS needs_truncate,
      NOT ('autovacuum_enabled=false' = ANY (COALESCE(c.reloptions, '{}'))) AS autovacuum
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
    ORDER BY c.relname
  `);

  const allTableNames = result.rows.map((row) => row.table_name);
  const dirtyTableNames = result.rows
    .filter((row) => row.needs_truncate)
    .map((row) => row.table_name);
  const autovacuumTableNames = result.rows
    .filter((row) => row.autovacuum)
    .map((row) => row.table_name);
  return { allTableNames, dirtyTableNames, autovacuumTableNames };
}

// The sequences TRUNCATE ... RESTART IDENTITY would restart: those owned by a table column,
// whether as a serial (`a`) or an identity (`i`) dependency.
async function listOwnedSequences(): Promise<string[]> {
  const result = await db.execute<{ sequence_name: string }>(sql`
    SELECT s.relname AS sequence_name
    FROM pg_class s
    JOIN pg_namespace n ON n.oid = s.relnamespace
    JOIN pg_depend d
      ON d.classid = 'pg_class'::regclass
     AND d.objid = s.oid
     AND d.refclassid = 'pg_class'::regclass
     AND d.deptype IN ('a', 'i')
    WHERE n.nspname = 'public'
      AND s.relkind = 'S'
    ORDER BY s.relname
  `);
  return result.rows.map((row) => row.sequence_name);
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
  /** Skip enabling the runtime-gated default-off features (see `enableRuntimeGatedFeatures`). */
  defaultOffFeatures?: false;
  onLockUnavailable?: (details: {
    attempt: number;
    error: unknown;
  }) => void | Promise<void>;
}) {
  await ensureTestDatabaseExists();
  let {
    allTableNames: tableNames,
    dirtyTableNames,
    autovacuumTableNames,
  } = await listPublicTables();

  if (tableNames.length === 0) {
    migrationPromise = null;
    await ensureTestDatabaseMigrated();
    ({
      allTableNames: tableNames,
      dirtyTableNames,
      autovacuumTableNames,
    } = await listPublicTables());
  }

  if (tableNames.length === 0) {
    throw new Error(
      "resetTestDatabase found no tables to truncate. Did migrations run?",
    );
  }

  const formattedTableNames = tableNames.map(quoteIdentifier).join(", ");
  const dirtyTables = dirtyTableNames.length > 0 ? dirtyTableNames : tableNames;
  const ownedSequences = await listOwnedSequences();
  // The first reset of every test file, and every RESETS_PER_TRUNCATE-th one after it, still
  // truncates: it rewrites each table empty, so the dead rows the cheaper DELETE resets leave
  // behind never accumulate across files and every file starts from fresh relations.
  const truncate = resetsSinceTruncate % RESETS_PER_TRUNCATE === 0;

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
        // DELETE leaves dead rows; autovacuum/autoanalyze workers would then take
        // SHARE UPDATE EXCLUSIVE locks between tests and make the NOWAIT lock above fail, and
        // would reuse freed space so unordered reads stop following insertion order. This is a
        // disposable test database (asserted above), so switch them off once per table; the
        // periodic TRUNCATE below is what reclaims the space.
        if (autovacuumTableNames.length > 0) {
          await tx.execute(
            sql.raw(
              autovacuumTableNames
                .map(
                  (table) =>
                    `ALTER TABLE ${quoteIdentifier(table)} SET (autovacuum_enabled = false, toast.autovacuum_enabled = false)`,
                )
                .join("; "),
            ),
          );
        }
        if (truncate) {
          // `audit_log`'s own append-only triggers correctly refuse an ordinary TRUNCATE.
          // Disable user-defined triggers only for this transaction; TRUNCATE CASCADE remains
          // driven by FK metadata.
          await tx.execute(
            sql.raw(
              `TRUNCATE TABLE ${dirtyTables.map(quoteIdentifier).join(", ")} RESTART IDENTITY CASCADE`,
            ),
          );
          return;
        }
        // Otherwise empty every table that holds rows, then restart owned sequences: the same
        // end state as `TRUNCATE ... RESTART IDENTITY CASCADE`. TRUNCATE CASCADE rewrites
        // almost every table (nearly all of them reference user/workspace), ~300 ms per reset
        // once the schema passed 170 tables; DELETE touches only tables that hold rows. A table
        // with rows always has a non-empty relation, so it is always in the dirty list.
        // `session_replication_role = replica` (above) disables user-defined triggers
        // (including `audit_log`'s append-only guard) and the internal FK triggers for this
        // transaction only, so no ordering between referencing tables is needed.
        await tx.execute(
          sql.raw(
            dirtyTables
              .map((table) => `DELETE FROM ${quoteIdentifier(table)}`)
              .join("; "),
          ),
        );
        if (ownedSequences.length > 0) {
          await tx.execute(
            sql.raw(
              ownedSequences
                .map(
                  (sequence) =>
                    `ALTER SEQUENCE ${quoteIdentifier(sequence)} RESTART`,
                )
                .join("; "),
            ),
          );
        }
      });
      resetsSinceTruncate = truncate ? 1 : resetsSinceTruncate + 1;
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
  if (options?.defaultOffFeatures !== false) await enableRuntimeGatedFeatures();
  // The portal flag lookups are cached in process for a few seconds (P4R2-L1); a reset
  // database must not answer from the previous test's cache.
  invalidateFeatureFlagCache();
}

/**
 * P4R1-M2: these flags default to off and are now enforced at runtime (`feature.sla`, the portal
 * router, the Timeline and Calendar views), so every fixture database starts with them enabled
 * at the instance, the way a deployed instance that uses them does. A test of the disabled
 * behaviour passes `{ defaultOffFeatures: false }` or turns the flag off itself.
 */
export const RUNTIME_GATED_FEATURES = [
  "feature.customer_portal",
  "feature.sla",
  "feature.timeline",
  "feature.calendar",
] as const;

export async function enableRuntimeGatedFeatures() {
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values(
      RUNTIME_GATED_FEATURES.map((featureKey) => ({
        featureKey,
        enabled: true,
      })),
    )
    .onConflictDoNothing();
}

class ResetLockUnavailableError extends Error {
  constructor(readonly original: unknown) {
    super("Could not acquire a test-reset table lock immediately");
    this.name = "ResetLockUnavailableError";
  }
}
