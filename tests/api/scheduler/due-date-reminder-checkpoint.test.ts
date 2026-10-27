import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertOwned: vi.fn(),
  createNotification: vi.fn(),
  listTasks: vi.fn(),
  insertSent: vi.fn(),
  ReservationLost: class extends Error {},
}));

vi.mock("../../../apps/api/src/scheduler/leader-lock", () => ({
  assertJobExecutionOwned: () => mocks.assertOwned(),
  JobExecutionReservationLostError: mocks.ReservationLost,
}));
vi.mock(
  "../../../apps/api/src/notification/controllers/create-notification",
  () => ({
    default: (...args: unknown[]) => mocks.createNotification(...args),
  }),
);
vi.mock("../../../apps/api/src/database", () => ({
  default: { transaction: (fn: (tx: unknown) => unknown) => fn({}) },
}));
vi.mock("../../../apps/api/src/events", () => ({
  publishEvent: vi.fn(async () => {}),
}));
vi.mock("../../../apps/api/src/scheduler/repository", () => ({
  insertReminderSent: (...args: unknown[]) => mocks.insertSent(...args),
  listTasksNeedingReminder: (...args: unknown[]) => mocks.listTasks(...args),
}));

import { checkDueDateReminders } from "../../../apps/api/src/scheduler/due-date-reminders";

describe("due-date reminder checkpoints", () => {
  beforeEach(() => {
    mocks.assertOwned.mockReset().mockResolvedValue(undefined);
    mocks.createNotification.mockReset().mockResolvedValue(undefined);
    mocks.listTasks.mockReset();
    mocks.insertSent.mockReset().mockResolvedValue(true);
  });

  it("finishes the current reminder pair and refuses the next task", async () => {
    mocks.listTasks.mockResolvedValue([
      {
        id: "task-one",
        title: "First",
        userId: "user-one",
        dueDate: null,
        projectId: "project-one",
        leadTimeMinutes: null,
      },
      {
        id: "task-two",
        title: "Second",
        userId: "user-two",
        dueDate: null,
        projectId: "project-two",
        leadTimeMinutes: null,
      },
    ]);
    mocks.assertOwned
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new mocks.ReservationLost("reservation lost"));

    await expect(checkDueDateReminders()).rejects.toThrow("reservation lost");
    expect(mocks.insertSent).toHaveBeenCalledOnce();
    expect(mocks.createNotification).toHaveBeenCalledOnce();
  });
});
