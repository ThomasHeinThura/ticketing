import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isDisposableDatabaseUrl,
  type MfaCsrfAppFixtureSetup,
} from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const apiRequire = createRequire(resolve(root, "apps/api/package.json"));
type Client = {
  connect(): Promise<void>;
  query<T extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  end(): Promise<void>;
};
const { Client: PgClient } = apiRequire("pg") as {
  Client: new (options: { connectionString: string }) => Client;
};

/** Validate the inspected fresh Testcontainers binding before opening a SQL connection. */
export function assertMembershipDatabaseBinding(
  fixture: Pick<MfaCsrfAppFixtureSetup, "databaseBinding" | "databaseUrl">,
): void {
  const { databaseBinding: binding, databaseUrl } = fixture;
  if (
    !binding ||
    !Object.isFrozen(binding) ||
    !/^[a-f0-9]{64}$/.test(binding.containerId) ||
    !/^mfa_csrf_[a-f0-9]{32}_test$/.test(binding.databaseName) ||
    !isDisposableDatabaseUrl(
      databaseUrl,
      binding.host,
      binding.port,
      binding.databaseName,
      "taskdesk_e2e_app",
    )
  )
    throw new Error(
      "Membership fixture requires the inspected disposable application database binding",
    );
}

export async function withMembershipDatabase<T>(
  fixture: Pick<MfaCsrfAppFixtureSetup, "databaseBinding" | "databaseUrl">,
  fn: (db: Client) => Promise<T>,
): Promise<T> {
  assertMembershipDatabaseBinding(fixture);
  const db = new PgClient({ connectionString: fixture.databaseUrl });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/** Synthetic non-direct roster row: the API must withhold its History target ID. */
export async function seedUnbackedProjectMembership(
  fixture: Pick<MfaCsrfAppFixtureSetup, "databaseBinding" | "databaseUrl">,
  workspaceId: string,
  projectId: string,
  personId: string,
): Promise<string> {
  return withMembershipDatabase(fixture, async (db) => {
    const role = await db.query<{ id: string }>(
      "select id from role where workspace_id = $1 and scope = 'project' and key = 'project-viewer'",
      [workspaceId],
    );
    if (role.rows.length !== 1 || !role.rows[0]?.id)
      throw new Error("Synthetic project viewer role absent");
    const id = randomUUID();
    await db.query(
      "insert into membership (id, person_id, scope, scope_id, role_id, sees_all, created_at, updated_at) values ($1, $2, 'project', $3, $4, false, now(), now())",
      [id, personId, projectId, role.rows[0].id],
    );
    return id;
  });
}
