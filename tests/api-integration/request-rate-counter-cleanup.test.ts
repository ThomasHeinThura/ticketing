import { beforeEach, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { purgeExpiredRequestRateCounters } from "../../apps/api/src/scheduler/repository";
import { resetTestDatabase } from "./helpers/database";

beforeEach(resetTestDatabase);

it("bounds expired-budget cleanup, preserves active budgets, and is idempotent", async () => {
  const now = Date.now();
  await db.insert(schema.requestRateLimitCounterTable).values([
    ...Array.from({ length: 1005 }, (_, index) => ({
      bucket: "anonymous_scim_failure",
      keyHash: index.toString(16).padStart(64, "0"),
      windowStartedAt: new Date(now - 120_000),
      expiresAt: new Date(now - 60_000),
      count: 20,
    })),
    {
      bucket: "scim_connection",
      keyHash: "f".repeat(64),
      windowStartedAt: new Date(now),
      expiresAt: new Date(now + 60_000),
      count: 600,
    },
  ]);
  expect(await purgeExpiredRequestRateCounters()).toBe(1000);
  expect(await purgeExpiredRequestRateCounters()).toBe(5);
  expect(await purgeExpiredRequestRateCounters()).toBe(0);
  const rows = await db.select().from(schema.requestRateLimitCounterTable);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ bucket: "scim_connection", count: 600 });
});
