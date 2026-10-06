import { isCurrentInstanceAdmin } from "../../instance/observability/audit-failure-notifier";
import { listVisibleNotifications } from "../repository";

async function getNotifications(userId: string) {
  const canReadInstanceAlerts = await isCurrentInstanceAdmin(userId);
  const rows = await listVisibleNotifications(userId, canReadInstanceAlerts);

  return rows.map(({ notification, projectId, workspaceId }) => {
    if (!projectId && !workspaceId) {
      return notification;
    }

    const existing =
      notification.eventData &&
      typeof notification.eventData === "object" &&
      !Array.isArray(notification.eventData)
        ? (notification.eventData as Record<string, unknown>)
        : {};

    return {
      ...notification,
      eventData: {
        ...existing,
        projectId: projectId ?? existing.projectId ?? null,
        workspaceId: workspaceId ?? existing.workspaceId ?? null,
      },
    };
  });
}

export default getNotifications;
