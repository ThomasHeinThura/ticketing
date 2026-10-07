import { config } from "dotenv-mono";
import { resolveDatabaseConfig } from "../apps/api/src/database/resolve-database-url.ts";

config();

async function main() {
  const databaseConfig = (() => {
    try {
      return resolveDatabaseConfig();
    } catch {
      throw new Error(
        "Test user seeding requires an explicitly configured database.",
      );
    }
  })();
  if (databaseConfig.source === "LOCAL_FALLBACK") {
    throw new Error(
      "Test user seeding refuses the implicit local database fallback.",
    );
  }
  const { runTestUserSeedCli } = await import(
    "../apps/api/scripts/seed-test-users.ts"
  );
  await runTestUserSeedCli(databaseConfig.database);
}

main().catch(() => {
  console.error(
    "Test-user seed stopped. Check the exact test database, command usage, and private credential path.",
  );
  process.exitCode = 1;
});
