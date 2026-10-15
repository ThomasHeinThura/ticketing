import { isCurrentInstanceAdmin } from "../../instance/observability/audit-failure-notifier";
import { listVisibleNotificationRows } from "../inbox.repository";

async function getNotifications(
  userId: string,
  credentialCanReadTask: boolean,
) {
  const canReadInstanceAlerts = await isCurrentInstanceAdmin(userId);
  const rows = await listVisibleNotificationRows({
    userId,
    canReadInstanceAlerts,
    credentialCanReadTask,
  });

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
