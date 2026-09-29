import db from "../../database";
import { taskActivityTable } from "../../database/schema";
import { lockTaskAndAssertProjectLive } from "../../task/assert-task-project-live";

async function createActivity(
  taskId: string,
  type: string,
  userId: string,
  content: string | null,
  eventData?: Record<string, unknown> | null,
) {
  const activity = await db.transaction(async (tx) => {
    await lockTaskAndAssertProjectLive(tx, taskId);
    const [row] = await tx
      .insert(taskActivityTable)
      .values({
        taskId,
        type,
        userId,
        content,
        eventData: eventData ?? null,
      })
      .returning();
    return row;
  });
  return activity;
}

export default createActivity;
