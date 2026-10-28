import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";

const ids = [randomUUID(), randomUUID()];

afterAll(async () => {
  await db.execute(sql`
    DELETE FROM instance_job_run WHERE id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
});

describe("instance job run lifecycle constraints", () => {
  it("rejects failed rows without a closed error code", async () => {
    await expect(
      db.execute(sql`
        WITH tick AS (SELECT clock_timestamp() AS value)
        INSERT INTO instance_job_run
          (id, name, trigger, state, requested_at, started_at, heartbeat_at,
           finished_at, duration_ms, error_code)
        SELECT ${ids[0]}, 'constraint-test', 'manual', 'failed',
               tick.value, tick.value, tick.value, tick.value, 0, NULL
          FROM tick
      `),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("rejects lease-lost rows without the matching closed error code", async () => {
    await expect(
      db.execute(sql`
        WITH tick AS (SELECT clock_timestamp() AS value)
        INSERT INTO instance_job_run
          (id, name, trigger, state, requested_at, started_at, heartbeat_at,
           finished_at, duration_ms, error_code)
        SELECT ${ids[1]}, 'constraint-test', 'scheduled', 'lease_lost',
               tick.value, tick.value, tick.value, tick.value, NULL, NULL
          FROM tick
      `),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});
