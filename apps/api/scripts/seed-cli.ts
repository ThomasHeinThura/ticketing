import { config } from "dotenv-mono";
import {
  type ResolvedDatabaseConfig,
  resolveDatabaseConfig,
} from "../src/database/resolve-database-url";

type SeedProfileModule = typeof import("./seed-profile");

/**
 * Resolve configuration before the lazily loaded profile module imports the database
 * module. That module has a localhost development fallback; the seed command must not
 * silently treat that fallback as authorization to write fixture rows.
 */
export async function loadConfiguredSeedProfile(
  loadProfile: () => Promise<SeedProfileModule> = () =>
    import("./seed-profile"),
  loadEnvironment: () => void = () => config(),
): Promise<SeedProfileModule> {
  // Match the API's existing dotenv-mono initialization so documented local .env
  // configuration is visible before deciding whether the fallback is authorized.
  loadEnvironment();

  let databaseConfig: ResolvedDatabaseConfig;
  try {
    databaseConfig = resolveDatabaseConfig();
  } catch (error) {
    // Node's ERR_INVALID_URL error carries the full URL in `input`, which can
    // include credentials. Do not let the CLI's top-level error logger expose it.
    if (
      error instanceof TypeError &&
      "code" in error &&
      error.code === "ERR_INVALID_URL"
    ) {
      throw new Error("Seed database URL configuration is invalid.");
    }
    throw error;
  }
  if (databaseConfig.source === "LOCAL_FALLBACK") {
    throw new Error(
      "Seed requires an explicitly configured database. Set TASKDESK_DATABASE_URL " +
        "or configure POSTGRES_PASSWORD (and optional POSTGRES_HOST, POSTGRES_PORT, " +
        "POSTGRES_DB, and POSTGRES_USER). No database connection was attempted.",
    );
  }

  return loadProfile();
}
