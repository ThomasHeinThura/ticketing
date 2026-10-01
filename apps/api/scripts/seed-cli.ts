import { resolveDatabaseConfig } from "../src/database/resolve-database-url";

type SeedProfileModule = typeof import("./seed-profile");

/**
 * Resolve configuration before the lazily loaded profile module imports the database
 * module. That module has a localhost development fallback; the seed command must not
 * silently treat that fallback as authorization to write fixture rows.
 */
export async function loadConfiguredSeedProfile(
  loadProfile: () => Promise<SeedProfileModule> = () =>
    import("./seed-profile"),
): Promise<SeedProfileModule> {
  const config = resolveDatabaseConfig();
  if (config.source === "LOCAL_FALLBACK") {
    throw new Error(
      "Seed requires an explicitly configured database. Set TASKDESK_DATABASE_URL " +
        "or configure POSTGRES_PASSWORD (and optional POSTGRES_HOST, POSTGRES_PORT, " +
        "POSTGRES_DB, and POSTGRES_USER). No database connection was attempted.",
    );
  }

  return loadProfile();
}
