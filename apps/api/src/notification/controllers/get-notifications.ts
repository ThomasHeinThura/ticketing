import { QUIET_HOURS_HOLD_KEY } from "../../notification-preferences/delivery.repository";
import type { AuthenticatedApiKey } from "../../permissions/resolve-request-identity";
import { listVisibleNotificationRows } from "../inbox.repository";
import { resolveNotificationWorkItemKeys } from "../links";

async function getNotifications(
  userId: string,
  credentialCanReadTask: boolean,
  credential: {
    apiKey?: AuthenticatedApiKey;
    impersonatedBy?: string | null;
  } = {},
) {
  const rows = await listVisibleNotificationRows({
    userId,
    credentialCanReadTask,
    credential,
  });

  // Deep links are an enhancement: if resolving them fails the inbox still lists.
  const workItemKeys = await resolveNotificationWorkItemKeys(
    rows.map(({ notification }) => notification),
  ).catch(() => new Map<string, string>());

  return rows.map(({ notification: base, projectId, workspaceId }) => {
    // `NO-14`: the owning work item's key (null when the resource has none), `kind` for the
    // inbox filters, and `readAt` so mark-unread round-trips.
    const { [QUIET_HOURS_HOLD_KEY]: _held, ...visibleEventData } =
      base.eventData &&
      typeof base.eventData === "object" &&
      !Array.isArray(base.eventData)
        ? (base.eventData as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    const notification = {
      ...base,
      eventData:
        base.eventData &&
        typeof base.eventData === "object" &&
        !Array.isArray(base.eventData)
          ? Object.keys(visibleEventData).length === 0
            ? null
            : visibleEventData
          : base.eventData,
      kind: base.kind ?? null,
      readAt: base.readAt ?? null,
      workItemKey: workItemKeys.get(base.id) ?? null,
    };
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
