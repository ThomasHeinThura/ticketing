/**
 * P0R1-04: the due-date reminder's sent marker and its notification row commit in one
 * transaction. A failure after the marker rolls both back, so the next run delivers.
 */
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { checkDueDateReminders } from "../../apps/api/src/scheduler/due-date-reminders";
import * as schedulerRepository from "../../apps/api/src/scheduler/repository";
import updateTask from "../../apps/api/src/task/controllers/update-task";
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

  it("catches up overdue and upcoming reminders once after a missed scan", async () => {
    const { taskId } = await overdueTask();
    await db
      .update(schema.taskTable)
      .set({ dueDate: new Date(Date.now() - 23 * 60 * 60_000) })
      .where(eq(schema.taskTable.id, taskId));
    await checkDueDateReminders();
    await checkDueDateReminders();
    expect(
      (await notifications(taskId)).filter(
        (row) => row.type === "task_overdue",
      ),
    ).toHaveLength(1);

    const upcoming = await overdueTask();
    await db
      .update(schema.taskTable)
      .set({ dueDate: new Date(Date.now() + 60 * 60_000) })
      .where(eq(schema.taskTable.id, upcoming.taskId));
    await checkDueDateReminders();
    await checkDueDateReminders();
    expect(
      (await notifications(upcoming.taskId)).filter(
        (row) => row.type === "due_date_reminder",
      ),
    ).toHaveLength(1);
  });

  it("clears markers only when a full task update changes the due date", async () => {
    const { world, taskId } = await overdueTask();
    await checkDueDateReminders();
    expect(await markers(taskId)).toHaveLength(1);
    const task = (
      await db
        .select()
        .from(schema.taskTable)
        .where(eq(schema.taskTable.id, taskId))
    )[0];
    if (!task?.dueDate) throw new Error("missing task or due date");
    const identity = await resolveIdentity({
      userId: world.projectMember.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("missing identity");
    const update = (dueDate: string) =>
      updateTask(
        identity,
        task.id,
        undefined,
        task.title,
        task.status,
        task.startDate?.toISOString(),
        dueDate,
        task.projectId,
        task.description ?? "",
        task.priority,
        task.position ?? 0,
        task.userId ?? undefined,
        world.projectMember.user.id,
      );
    await update(task.dueDate.toISOString());
    expect(await markers(taskId)).toHaveLength(1);
    await update(new Date(Date.now() - 60_000).toISOString());
    expect(await markers(taskId)).toHaveLength(0);
    await checkDueDateReminders();
    expect(await markers(taskId)).toHaveLength(1);
  });

  it("does not deliver or mark a candidate rescheduled after the scan", async () => {
    const { world, taskId } = await overdueTask();
    const [task] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, taskId));
    if (!task) throw new Error("missing task");
    const identity = await resolveIdentity({
      userId: world.projectMember.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("missing identity");
    const nextDue = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    let resume!: () => void;
    let scanned!: () => void;
    let foundCandidate = false;
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const candidateRead = new Promise<void>((resolve) => {
      scanned = resolve;
    });
    const original = schedulerRepository.listTasksNeedingReminder;
    const spy = vi
      .spyOn(schedulerRepository, "listTasksNeedingReminder")
      .mockImplementation(async (...args) => {
        const tasks = await original(...args);
        if (args[2] === "overdue") {
          foundCandidate = tasks.some((candidate) => candidate.id === taskId);
          scanned();
          await paused;
        }
        return tasks;
      });
    const scan = checkDueDateReminders();
    try {
      await candidateRead;
      await updateTask(
        identity,
        task.id,
        undefined,
        task.title,
        task.status,
        task.startDate?.toISOString(),
        nextDue.toISOString(),
        task.projectId,
        task.description ?? "",
        task.priority,
        task.position ?? 0,
        task.userId ?? undefined,
        world.projectMember.user.id,
      );
    } finally {
      resume();
      await scan;
      spy.mockRestore();
    }
    expect(foundCandidate).toBe(true);
    expect(await markers(taskId)).toHaveLength(0);
    expect(await notifications(taskId)).toHaveLength(0);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date(nextDue.getTime() + 2 * 60_000));
      expect(await checkDueDateReminders()).toEqual({ degraded: false });
      expect(await markers(taskId)).toHaveLength(1);
      expect((await notifications(taskId))[0]?.type).toBe("task_overdue");
    } finally {
      vi.useRealTimers();
    }
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
