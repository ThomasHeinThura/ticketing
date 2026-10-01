import { PostgreSqlContainer } from "@testcontainers/postgresql";

/**
 * A dedicated container for the RLS prototype. It intentionally ignores
 * TASKDESK_DATABASE_URL and .env: this experiment must never connect to a
 * developer, shared, UAT, or production database.
 */
export default async function setup() {
  const container = await new PostgreSqlContainer("postgres:18-alpine")
    .withDatabase("taskdesk_rls_prototype")
    .withUsername("postgres")
    .withPassword("rls-prototype-only")
    .start();

  process.env.RLS_PROTOTYPE_DATABASE_URL = container.getConnectionUri();

  return async () => {
    await container.stop();
  };
}
