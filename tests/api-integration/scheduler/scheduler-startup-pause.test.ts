import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import db from "../../../apps/api/src/database";
import { instanceJobConfigurationTable } from "../../../apps/api/src/database/schema-instance-jobs";
import {
  initializeScheduler,
  registeredJobByName,
  registeredJobCatalog,
  registeredJobs,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler";

afterAll(async () => {
  shutdownScheduler();
  await db
    .delete(instanceJobConfigurationTable)
    .where(eq(instanceJobConfigurationTable.name, "outbox-drain"));
});

describe("scheduler startup configuration gate", () => {
  it("keeps default Cron callbacks paused until persisted disable state is read", async () => {
    await db.insert(instanceJobConfigurationTable).values({
      name: "outbox-drain",
      pattern: null,
      enabled: false,
      version: 1,
    });
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`LOCK TABLE instance_job_configuration IN ACCESS EXCLUSIVE MODE`,
      );
      initializeScheduler();
      expect(registeredJobs().length).toBeGreaterThan(0);
      expect(registeredJobs().every((job) => !job.isRunning())).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(
        registeredJobCatalog().find((job) => job.name === "outbox-drain"),
      ).toMatchObject({ enabled: false, nextRunAt: null });
      expect(registeredJobByName("outbox-drain")?.isRunning()).toBe(false);
    });

    const expiresAt = Date.now() + 5_000;
    while (Date.now() < expiresAt) {
      const outbox = registeredJobCatalog().find(
        (job) => job.name === "outbox-drain",
      );
      if (outbox?.enabled === false) {
        expect(outbox.nextRunAt).toBeNull();
        expect(registeredJobByName("outbox-drain")?.isRunning()).toBe(false);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Persisted disabled state did not load into the scheduler");
  });
});
