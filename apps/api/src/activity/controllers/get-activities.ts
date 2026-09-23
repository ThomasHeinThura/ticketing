import { desc, eq } from "drizzle-orm";
import db from "../../database";
import { taskActivityTable } from "../../database/schema";

async function getActivitiesFromTaskId(taskId: string) {
  const activities = await db.query.taskActivityTable.findMany({
    where: eq(taskActivityTable.taskId, taskId),
    orderBy: [desc(taskActivityTable.createdAt)],
  });

  activities.forEach((x) => {
    if (x.content) {
      x.content = x.content.replace(/\n+/g, "\n");
    }
  });

  return activities;
}

export default getActivitiesFromTaskId;
