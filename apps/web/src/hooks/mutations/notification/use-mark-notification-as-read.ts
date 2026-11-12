import markNotificationAsRead from "@/fetchers/notification/mark-notification-as-read";
import { useOptimisticNotification } from "./use-optimistic-notification";

export default function useMarkNotificationAsRead() {
  return useOptimisticNotification(markNotificationAsRead, (id) => ({
    id,
    read: true,
  }));
}
