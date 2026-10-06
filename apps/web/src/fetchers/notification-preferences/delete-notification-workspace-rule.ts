import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import type { NotificationPreferences } from "./get-notification-preferences";

async function deleteNotificationWorkspaceRule(
  workspaceId: string,
): Promise<NotificationPreferences> {
  const response = await apiFetch(
    getApiUrl(`/notification-preferences/workspaces/${workspaceId}`),
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return (await response.json()) as NotificationPreferences;
}

export default deleteNotificationWorkspaceRule;
