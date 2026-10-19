import type { ResolvedIdentity } from "@taskdesk/permissions";
import { listTaskActivitiesNewestFirst } from "../repository";

async function getActivitiesFromTaskId(
  identity: ResolvedIdentity,
  taskId: string,
) {
  const activities = await listTaskActivitiesNewestFirst(identity, taskId);
  activities.forEach((activity) => {
    if (activity.content) {
      activity.content = activity.content.replace(/\n+/g, "\n");
    }
  });
  return activities;
}

export default getActivitiesFromTaskId;
