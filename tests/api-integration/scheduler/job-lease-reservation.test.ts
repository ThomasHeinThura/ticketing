import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import db from "../../../apps/api/src/database";
import {
  assertJobExecutionOwned,
  withJobExecutionReservation,
  withJobLease,
} from "../../../apps/api/src/scheduler/leader-lock";
import {
  claimJobLease,
  ownsJobLease,
  releaseJobLease,
} from "../../../apps/api/src/scheduler/repository";

const name = `instance-jobs-test:${randomUUID()}`;
const owners = [randomUUID(), randomUUID()];
let heldOwner: string | undefined;
const expiredRunId = randomUUID();
const expiredOwner = randomUUID();
const expiredName = `instance-jobs-expired:${randomUUID()}`;

afterAll(async () => {
  await Promise.all(owners.map((owner) => releaseJobLease(name, owner)));
  await releaseJobLease(expiredName, expiredOwner);
  await db.execute(
    sql`DELETE FROM instance_job_run WHERE id = ${expiredRunId}`,
  );
});

describe("PostgreSQL job lease reservation", () => {
  it("lets exactly one competing Cron/manual owner reserve a job", async () => {
    const acquired = await Promise.all(
      owners.map((owner) => claimJobLease(name, owner, "60 seconds")),
    );

    expect(acquired.filter(Boolean)).toHaveLength(1);
    const winner = owners[acquired.indexOf(true)];
    const loser = owners[acquired.indexOf(false)];
    heldOwner = winner;
    expect(winner).toBeDefined();
    expect(loser).toBeDefined();
    expect(await ownsJobLease(name, winner as string)).toBe(true);
    expect(await ownsJobLease(name, loser as string)).toBe(false);
    expect(await claimJobLease(name, loser as string, "60 seconds")).toBe(
      false,
    );
  });

  it("allows the queued owner to reserve after the current lease is released", async () => {
    expect(heldOwner).toBeDefined();
    const active = heldOwner as string;
    const queued = owners.find((owner) => owner !== active) as string;
    await releaseJobLease(name, active);

    expect(await claimJobLease(name, queued, "60 seconds")).toBe(true);
    expect(await ownsJobLease(name, queued)).toBe(true);
  });

  it("returns the handler's real busy result while another owner holds the PostgreSQL lease", async () => {
    const owner = owners[0] as string;
    await Promise.all(
      owners.map((candidate) => releaseJobLease(name, candidate)),
    );
    expect(await claimJobLease(name, owner, "60 seconds")).toBe(true);
    const handler = async () => "worked";

    await expect(withJobLease(name, handler, () => "busy")).resolves.toBe(
      "busy",
    );
    expect(await ownsJobLease(name, owner)).toBe(true);
  });

  it("rejects a handler checkpoint after its PostgreSQL run reservation expires", async () => {
    await db.execute(sql`
      WITH tick AS (SELECT clock_timestamp() AS value)
      INSERT INTO instance_job_run
        (id, name, trigger, state, requested_at, started_at, heartbeat_at,
         runner_id, run_lease_expires_at)
      SELECT ${expiredRunId}, ${expiredName}, 'manual', 'running',
             tick.value - interval '2 minutes', tick.value - interval '2 minutes',
             tick.value - interval '2 minutes', ${expiredOwner},
             tick.value - interval '1 minute'
        FROM tick
    `);
    expect(await claimJobLease(expiredName, expiredOwner, "60 seconds")).toBe(
      true,
    );

    await expect(
      withJobExecutionReservation(
        {
          jobName: expiredName,
          runId: expiredRunId,
          runnerId: expiredOwner,
          leaseOwner: expiredOwner,
          assertRunOwned: async () => {
            const result = await db.execute(sql`
              SELECT 1 FROM instance_job_run
               WHERE id = ${expiredRunId} AND state = 'running'
                 AND runner_id = ${expiredOwner}
                 AND run_lease_expires_at > clock_timestamp()
            `);
            return (result.rowCount ?? 0) > 0;
          },
        },
        () => assertJobExecutionOwned(),
      ),
    ).rejects.toThrow("reservation is no longer owned");
  });
});
