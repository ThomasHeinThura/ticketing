import { listTaskActivitiesNewestFirst } from "../repository";

async function getActivitiesFromTaskId(taskId: string) {
  const activities = await listTaskActivitiesNewestFirst(taskId);

  activities.forEach((x) => {
    if (x.content) {
      x.content = x.content.replace(/\n+/g, "\n");
    }
  });

  return activities;
}

export default getActivitiesFromTaskId;
