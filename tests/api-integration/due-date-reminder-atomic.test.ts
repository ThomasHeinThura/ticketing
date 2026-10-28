/**
 * P0R1-04: the due-date reminder's sent marker and its notification row commit in one
 * transaction. A failure after the marker rolls both back, so the next run delivers.
 */
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { checkDueDateReminders } from "../../apps/api/src/scheduler/due-date-reminders";
import { resetTestDatabase } from "./helpers/database";
import { seedLegacy, setupWorld } from "./helpers/reach-world";

async function overdueTask() {
  const world = await setupWorld();
  const s = await seedLegacy(world, world.projectMember.user.id);
  await db
    .update(schema.taskTable)
    .set({
      userId: world.projectMember.user.id,
      dueDate: new Date(Date.now() - 2 * 60_000),
    })
    .where(eq(schema.taskTable.id, s.taskId));
  return { world, taskId: s.taskId };
}

const markers = (taskId: string) =>
  db
    .select()
    .from(schema.taskReminderSentTable)
    .where(eq(schema.taskReminderSentTable.taskId, taskId));
const notifications = (taskId: string) =>
  db
    .select()
    .from(schema.notificationTable)
    .where(eq(schema.notificationTable.resourceId, taskId));

describe("API integration: due-date reminder atomicity", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("writes the marker and the notification together and never repeats", async () => {
    const { taskId } = await overdueTask();
    expect(await checkDueDateReminders()).toEqual({ degraded: false });
    expect(await markers(taskId)).toHaveLength(1);
    const rows = await notifications(taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("task_overdue");

    await checkDueDateReminders();
    expect(await markers(taskId)).toHaveLength(1);
    expect(await notifications(taskId)).toHaveLength(1);
  });

  it("a failure after the marker rolls the marker back and the retry delivers", async () => {
    const { taskId } = await overdueTask();
    // The notification insert fails after the marker insert, inside the same transaction.
    await db.execute(sql`
      CREATE FUNCTION p0_fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated crash after marker'; END $$`);
    await db.execute(sql`
      CREATE TRIGGER p0_fail_notification BEFORE INSERT ON notification
      FOR EACH ROW EXECUTE FUNCTION p0_fail_notification()`);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await checkDueDateReminders()).degraded).toBe(true);
      expect(await markers(taskId)).toHaveLength(0);
      expect(await notifications(taskId)).toHaveLength(0);
    } finally {
      await db.execute(sql`DROP TRIGGER p0_fail_notification ON notification`);
      await db.execute(sql`DROP FUNCTION p0_fail_notification()`);
      errors.mockRestore();
    }

    expect(await checkDueDateReminders()).toEqual({ degraded: false });
    expect(await markers(taskId)).toHaveLength(1);
    expect(await notifications(taskId)).toHaveLength(1);
  });
});
