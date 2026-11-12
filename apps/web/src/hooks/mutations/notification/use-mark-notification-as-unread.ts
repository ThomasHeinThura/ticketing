import markNotificationAsUnread from "@/fetchers/notification/mark-notification-as-unread";
import { useOptimisticNotification } from "./use-optimistic-notification";

export default function useMarkNotificationAsUnread() {
  return useOptimisticNotification(markNotificationAsUnread, (id) => ({
    id,
    read: false,
  }));
}
