import db from "../database";
import { publishEvent } from "../events";
import createNotification from "../notification/controllers/create-notification";
import {
  assertJobExecutionOwned,
  JobExecutionReservationLostError,
} from "./leader-lock";
import { REMINDER_WINDOW_MINUTES } from "./reminder-timing";
import {
  insertReminderSent,
  listTasksNeedingReminder,
  type ReminderType,
} from "./repository";

const MINUTE_MS = 60 * 1000;

function buildWindows(now: Date) {
  const nowMs = now.getTime();

  return {
    upcoming: {
      start: new Date(nowMs - REMINDER_WINDOW_MINUTES * MINUTE_MS),
      end: now,
      type: "configured_before" as ReminderType,
      notificationType: "due_date_reminder" as const,
    },
    overdue: {
      end: now,
      start: new Date(nowMs - 10 * MINUTE_MS),
      type: "overdue" as ReminderType,
      notificationType: "task_overdue" as const,
    },
  };
}

async function getTasksNeedingReminder(
  windowStart: Date,
  windowEnd: Date,
  reminderType: ReminderType,
) {
  return listTasksNeedingReminder(windowStart, windowEnd, reminderType);
}

async function processReminder(
  task: {
    id: string;
    title: string;
    userId: string | null;
    dueDate: Date | null;
    projectId: string;
    leadTimeMinutes: number | null;
  },
  reminderType: ReminderType,
  notificationType: "due_date_reminder" | "task_overdue",
) {
  if (!task.userId) return;
  const userId = task.userId;

  // P0R1-04: the sent marker and the notification row commit together. A failure after the
  // marker rolls both back, so the next run retries; a committed marker always has its
  // notification (or a deliberate preference/reach skip). The realtime publish follows commit.
  const notification = await db.transaction(async (tx) => {
    const inserted = await insertReminderSent(task.id, reminderType, tx);
    if (!inserted) return null;
    return createNotification({
      userId,
      type: notificationType,
      eventData: {
        taskTitle: task.title,
        reminderType,
        leadTimeMinutes: task.leadTimeMinutes ?? 1440,
        dueDate: task.dueDate?.toISOString() ?? null,
      },
      resourceId: task.id,
      resourceType: "task",
      executor: tx,
    });
  });
  if (notification) {
    await publishEvent("notification.created", {
      notificationId: notification.id,
      userId,
    }).catch(() => {});
  }
}

export async function checkDueDateReminders(): Promise<{ degraded: boolean }> {
  const now = new Date();
  const windows = buildWindows(now);
  let degraded = false;

  for (const window of Object.values(windows)) {
    await assertJobExecutionOwned();
    try {
      const tasks = await getTasksNeedingReminder(
        window.start,
        window.end,
        window.type,
      );

      for (const task of tasks) {
        // A reminder is one unit from its sent marker through notification
        // creation. Check only before beginning the next task.
        await assertJobExecutionOwned();
        try {
          await processReminder(task, window.type, window.notificationType);
        } catch (error) {
          if (error instanceof JobExecutionReservationLostError) throw error;
          degraded = true;
          console.error("Failed to process due date reminder", {
            taskId: task.id,
            reminderType: window.type,
            error,
          });
        }
      }
    } catch (error) {
      if (error instanceof JobExecutionReservationLostError) throw error;
      degraded = true;
      console.error("Failed to query tasks for due date reminders", {
        reminderType: window.type,
        error,
      });
    }
  }

  return { degraded };
}
