import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeMigrationPool,
  getMigrationDatabasePool,
  MIGRATION_LOCK_TIMEOUT_MS,
  withMigrationDatabaseSession,
} from "./index";

describe("migration database pool lock_timeout (DO-5)", () => {
  afterEach(async () => {
    await closeMigrationPool();
    vi.unstubAllEnvs();
  });

  it("configures UTC timezone and bounded lock_timeout in migration session options", () => {
    const resolved = new URL(
      withMigrationDatabaseSession(
        "postgresql://owner@localhost:5432/taskdesk?sslmode=require&options=-c%20statement_timeout%3D30000",
      ),
    );

    expect(resolved.searchParams.get("sslmode")).toBe("require");
    expect(resolved.searchParams.get("options")).toBe(
      `-c statement_timeout=30000 -c TimeZone=UTC -c lock_timeout=${MIGRATION_LOCK_TIMEOUT_MS}`,
    );
  });

  it("wires bounded lock_timeout into getMigrationDatabasePool()", () => {
    vi.stubEnv(
      "MIGRATION_DATABASE_URL",
      "postgresql://owner@localhost:5432/taskdesk_migrate_unit_test",
    );

    const pool = getMigrationDatabasePool();
    const connectionString = pool.options.connectionString ?? "";
    const parsed = new URL(connectionString);

    expect(parsed.searchParams.get("options")).toContain("-c TimeZone=UTC");
    expect(parsed.searchParams.get("options")).toContain(
      `-c lock_timeout=${MIGRATION_LOCK_TIMEOUT_MS}`,
    );
  });
});
