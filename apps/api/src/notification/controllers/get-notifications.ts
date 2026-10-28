import { QUIET_HOURS_HOLD_KEY } from "../../notification-preferences/delivery.repository";
import type { AuthenticatedApiKey } from "../../permissions/resolve-request-identity";
import type { MaterializedNotificationRow } from "../inbox.repository";
import { listVisibleNotificationRows } from "../inbox.repository";
import {
  resolveNotificationDeepLinks,
  resolveNotificationWorkItemKeys,
} from "../links";

export async function enrichVisibleNotifications(
  rows: ReadonlyArray<{
    notification: MaterializedNotificationRow;
    projectId: string | null;
    workspaceId: string | null;
  }>,
) {
  // Deep links are an enhancement: if resolving them fails the inbox still lists.
  const notifications = rows.map(({ notification }) => notification);
  const workItemKeys = await resolveNotificationWorkItemKeys(
    notifications,
  ).catch(() => new Map<string, string>());
  const deepLinks = resolveNotificationDeepLinks(notifications);

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
      deepLink: deepLinks.get(base.id) ?? null,
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
  return enrichVisibleNotifications(rows);
}

export default getNotifications;
