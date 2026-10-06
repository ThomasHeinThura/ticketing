import db from "../../database";
import { listActivities } from "../repository";

async function getActivitiesFromTaskId(taskId: string) {
  const activities = await listActivities(db, taskId);

  activities.forEach((x) => {
    if (x.content) {
      x.content = x.content.replace(/\n+/g, "\n");
    }
  });

  return activities;
}

export default getActivitiesFromTaskId;
