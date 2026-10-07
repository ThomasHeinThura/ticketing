import { randomBytes } from "node:crypto";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

export default async function setup() {
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
