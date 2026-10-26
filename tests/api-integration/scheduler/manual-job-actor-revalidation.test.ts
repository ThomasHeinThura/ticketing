import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { instanceJobRunTable } from "../../../apps/api/src/database/schema-instance-jobs";
import { dispatchOneManualRun } from "../../../apps/api/src/instance/jobs/runtime";
import { ensureStaffPersonForUser } from "../../../apps/api/src/utils/seed-internal-organisation";

const userId = `jobs-admin-${randomUUID()}`;
const runId = randomUUID();
const jobName = `actor-revalidation-${randomUUID()}`;
let personId: string | undefined;

afterAll(async () => {
  await db.delete(instanceJobRunTable).where(eq(instanceJobRunTable.id, runId));
  if (personId)
    await db
      .delete(schema.personTable)
      .where(eq(schema.personTable.id, personId));
  await db.delete(schema.userTable).where(eq(schema.userTable.id, userId));
});

describe("manual job actor revalidation", () => {
  it("does not invoke a queued handler after the requesting admin loses authority", async () => {
    await db.insert(schema.userTable).values({
      id: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
      name: "Synthetic job runner",
      role: "admin",
    });
    await ensureStaffPersonForUser(userId);
    const person = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId))
      .limit(1);
    personId = person[0]?.id;
    expect(personId).toBeTruthy();

    await db.insert(instanceJobRunTable).values({
      id: runId,
      name: jobName,
      trigger: "manual",
      state: "queued",
      actorPersonId: personId,
    });
    await db
      .update(schema.userTable)
      .set({ role: "user" })
      .where(eq(schema.userTable.id, userId));

    const handler = vi.fn().mockResolvedValue(undefined);
    await dispatchOneManualRun(() => handler);

    const [run] = await db
      .select({
        state: instanceJobRunTable.state,
        errorCode: instanceJobRunTable.errorCode,
      })
      .from(instanceJobRunTable)
      .where(eq(instanceJobRunTable.id, runId));
    expect(run?.state).toBe("failed");
    expect(run?.errorCode).toBe("authorization_lost");
    expect(handler).not.toHaveBeenCalled();
  });
});
