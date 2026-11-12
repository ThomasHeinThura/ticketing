import markAllNotificationsAsRead from "@/fetchers/notification/mark-all-notifications-as-read";
import { useOptimisticNotification } from "./use-optimistic-notification";

export default function useMarkAllNotificationsAsRead() {
  return useOptimisticNotification<void>(markAllNotificationsAsRead, () => ({
    read: true,
  }));
}
