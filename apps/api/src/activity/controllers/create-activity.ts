import db from "../../database";
import { taskActivityTable } from "../../database/schema";

async function createActivity(
  taskId: string,
  type: string,
  userId: string,
  content: string | null,
  eventData?: Record<string, unknown> | null,
) {
  const [activity] = await db
    .insert(taskActivityTable)
    .values({
      taskId,
      type,
      userId,
      content,
      eventData: eventData ?? null,
    })
    .returning();
  return activity;
}

export default createActivity;
