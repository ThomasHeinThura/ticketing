import type { PoolClient } from "pg";
import { getDatabasePool } from "../../../apps/api/src/database";

export type TestDatabaseTimezone = "Asia/Yangon" | "America/New_York";

type PoolWithAsyncConnectHook = ReturnType<typeof getDatabasePool> & {
  options: {
    onConnect?: (client: PoolClient) => Promise<void>;
  };
};

/**
 * Apply a non-UTC setting to every existing pooled session and every session the
 * pool opens during one integration test. Production connection setup deliberately
 * pins UTC, so the fixture changes only session settings after connection startup.
 * The returned cleanup restores UTC and removes the listener; no database-wide or
 * process-wide PostgreSQL setting is changed.
 */
export async function setTestDatabaseTimezone(
  timezone: TestDatabaseTimezone,
): Promise<() => Promise<void>> {
  const pool = getDatabasePool();
  const configurablePool = pool as PoolWithAsyncConnectHook;
  const setting = `SET TIME ZONE '${timezone}'`;
  let restored = false;
  const previousOnConnect = configurablePool.options.onConnect;
  configurablePool.options.onConnect = async (client) => {
    await previousOnConnect?.(client);
    await client.query(setting);
  };

  const setExistingClients = async (value: string) => {
    if (pool.idleCount !== pool.totalCount)
      throw new Error("Timezone fixture requires an idle database pool");

    const count = Math.max(1, pool.totalCount);
    const clients = await Promise.all(
      Array.from({ length: count }, () => pool.connect()),
    );
    try {
      await Promise.all(
        clients.map((client) => client.query(`SET TIME ZONE '${value}'`)),
      );
      const zones = await Promise.all(
        clients.map(async (client) => {
          const result = await client.query<{ timezone: string }>(
            "SELECT current_setting('TimeZone') AS timezone",
          );
          return result.rows[0]?.timezone;
        }),
      );
      if (zones.some((zone) => zone !== value))
        throw new Error(
          "Timezone fixture did not configure every pooled session",
        );
    } finally {
      for (const client of clients) client.release();
    }
  };

  const restore = async () => {
    if (restored) return;
    restored = true;
    configurablePool.options.onConnect = previousOnConnect;
    await setExistingClients("UTC");
  };

  try {
    await setExistingClients(timezone);
    return restore;
  } catch (error) {
    await restore().catch(() => undefined);
    throw error;
  }
}
