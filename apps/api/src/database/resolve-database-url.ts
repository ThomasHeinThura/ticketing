const LOCAL_FALLBACK_CONNECTION_STRING = "postgresql://localhost:5432/taskdesk";

type DatabaseConfigSource =
  | "TASKDESK_DATABASE_URL"
  | "TASKDESK_MIGRATION_DATABASE_URL"
  | "POSTGRES_ENV"
  | "LOCAL_FALLBACK";

export type ResolvedDatabaseConfig = {
  connectionString: string;
  source: DatabaseConfigSource;
  host: string;
  port: number;
  database: string;
  username: string;
  logConfig: {
    source: DatabaseConfigSource;
    host: string;
    port: number;
    database: string;
    username: string;
  };
};

function getDerivationSignal(): boolean {
  return Boolean(
    process.env.POSTGRES_PASSWORD ||
      process.env.POSTGRES_HOST ||
      process.env.POSTGRES_PORT,
  );
}

function toResolvedConfig(
  connectionString: string,
  source: DatabaseConfigSource,
): ResolvedDatabaseConfig {
  const url = new URL(connectionString);

  const logConfig = {
    source,
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.replace(/^\//, ""),
    username: decodeURIComponent(url.username),
  };

  return {
    connectionString,
    ...logConfig,
    logConfig,
  };
}

export function resolveDatabaseConfig(): ResolvedDatabaseConfig {
  if (process.env.TASKDESK_DATABASE_URL) {
    return toResolvedConfig(
      process.env.TASKDESK_DATABASE_URL,
      "TASKDESK_DATABASE_URL",
    );
  }

  if (getDerivationSignal()) {
    if (!process.env.POSTGRES_PASSWORD) {
      throw new Error(
        "POSTGRES_PASSWORD must be set when deriving TASKDESK_DATABASE_URL from POSTGRES_* variables",
      );
    }

    const username = process.env.POSTGRES_USER || "taskdesk";
    const password = encodeURIComponent(process.env.POSTGRES_PASSWORD);
    const host = process.env.POSTGRES_HOST || "postgres";
    const port = process.env.POSTGRES_PORT || "5432";
    const database = process.env.POSTGRES_DB || "taskdesk";

    return toResolvedConfig(
      `postgresql://${encodeURIComponent(username)}:${password}@${host}:${port}/${database}`,
      "POSTGRES_ENV",
    );
  }

  return toResolvedConfig(LOCAL_FALLBACK_CONNECTION_STRING, "LOCAL_FALLBACK");
}

export function resolveDatabaseConnectionString(): string {
  return resolveDatabaseConfig().connectionString;
}

/**
 * The migration/owner connection (issue #296): a role that is allowed to run DDL and
 * owns every table, kept separate from the application connection
 * (`resolveDatabaseConfig`), which must be neither a superuser nor a table owner.
 *
 * `TASKDESK_MIGRATION_DATABASE_URL` is deliberately optional, not a sixth required
 * variable: when it is absent, this falls back to whatever `resolveDatabaseConfig`
 * resolves — the existing single-URL behaviour local development and any deployment
 * that has not yet split roles still relies on. In that mode the same role runs
 * migrations and serves requests, which is exactly the configuration #296 exists to
 * move deployments away from; `assertApplicationRoleIsNotPrivileged`
 * (`./assert-application-role-is-not-privileged.ts`) fails startup loudly rather than
 * silently accepting it once a deployment's app connection turns out to be a superuser
 * or a table owner.
 */
export function resolveMigrationDatabaseConfig(): ResolvedDatabaseConfig {
  if (process.env.TASKDESK_MIGRATION_DATABASE_URL) {
    return toResolvedConfig(
      process.env.TASKDESK_MIGRATION_DATABASE_URL,
      "TASKDESK_MIGRATION_DATABASE_URL",
    );
  }

  return resolveDatabaseConfig();
}

export function resolveMigrationDatabaseConnectionString(): string {
  return resolveMigrationDatabaseConfig().connectionString;
}
