import { useQuery } from "@tanstack/react-query";
import {
  getAnnouncementAudienceOptions,
  listAnnouncements,
} from "@/fetchers/announcements";

/** Under the service-management prefix, so its invalidation and approved deletions refresh it. */
export const announcementKeys = {
  list: (workspaceId: string) =>
    ["service-management", "announcements", workspaceId] as const,
  audience: (workspaceId: string) =>
    ["service-management", "announcement-audience", workspaceId] as const,
};

export function useAnnouncements(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: announcementKeys.list(workspaceId),
    queryFn: () => listAnnouncements(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    retry: false,
  });
}

export function useAnnouncementAudienceOptions(
  workspaceId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: announcementKeys.audience(workspaceId),
    queryFn: () => getAnnouncementAudienceOptions(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    retry: false,
  });
}
