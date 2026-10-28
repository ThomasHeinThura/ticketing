import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  closeMigrationPool,
  getDatabasePool,
  getMigrationDatabasePool,
} from "../../apps/api/src/database";
import { withUtcDatabaseSession } from "../../apps/api/src/database/utc-connection-string";

describe("database UTC wall-clock handling", () => {
  it("overrides a non-UTC startup setting without losing other options", async () => {
    const url = new URL(process.env.TASKDESK_DATABASE_URL ?? "");
    url.searchParams.set(
      "options",
      "-c TimeZone=Asia/Yangon -c statement_timeout=12345",
    );
    const pool = new Pool({
      connectionString: withUtcDatabaseSession(url.toString()),
    });
    try {
      const { rows } =
        await pool.query(`SELECT current_setting('TimeZone') AS zone,
        current_setting('statement_timeout') AS timeout,
        now()::timestamp = (now() AT TIME ZONE 'UTC') AS utc_wall_clock`);
      expect(rows).toEqual([
        { zone: "UTC", timeout: "12345ms", utc_wall_clock: true },
      ]);
    } finally {
      await pool.end();
    }
  });

  it("uses UTC for both application and migration connections", async () => {
    try {
      for (const pool of [getDatabasePool(), getMigrationDatabasePool()]) {
        const { rows } = await pool.query("SHOW TimeZone");
        expect(rows).toEqual([{ TimeZone: "UTC" }]);
      }
    } finally {
      await closeMigrationPool();
    }
  });
});
