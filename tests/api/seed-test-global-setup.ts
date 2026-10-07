import { randomBytes } from "node:crypto";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { configureSeedTestOrigins } from "../../apps/api/scripts/seed-test-origins";

export function validateExplicitSeedTestDatabaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Explicit seed test database URL is invalid.");
  }
  const name = url.pathname.slice(1);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !/^[a-zA-Z0-9_-]+_test$/u.test(name) ||
    url.username.length === 0 ||
    url.hostname.length === 0
  ) {
    throw new Error(
      "Explicit seed test database must be a configured *_test PostgreSQL database.",
    );
  }
  return name;
}

export default async function setup() {
  configureSeedTestOrigins(process.env);
  const explicitUrl = process.env.TASKDESK_DATABASE_URL;
  if (explicitUrl) {
    validateExplicitSeedTestDatabaseUrl(explicitUrl);
    const alternateNames = ["DATABASE_URL", "TEST_DATABASE_URL"] as const;
    for (const name of alternateNames) {
      const alternate = process.env[name];
      if (alternate && alternate !== explicitUrl) {
        throw new Error(
          "Seed test database URLs must identify the same explicit target.",
        );
      }
    }
    return () => {};
  }

  const password = randomBytes(24).toString("base64url");
  const container = await new PostgreSqlContainer("postgres:18-alpine")
    .withDatabase("taskdesk_seed_test")
    .withUsername("postgres")
    .withPassword(password)
    .start();

  process.env.TASKDESK_DATABASE_URL = container.getConnectionUri();
  return async () => {
    await container.stop();
  };
}
