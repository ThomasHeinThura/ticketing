import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@taskdesk/ui";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import useMarkAllNotificationsAsRead from "@/hooks/mutations/notification/use-mark-all-notifications-as-read";
import useGetNotifications from "@/hooks/queries/notification/use-get-notifications";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import {
  getNotificationContent,
  getNotificationTitle,
  isLegacyTaskNotification,
  useNotificationClick,
} from "./notification-content";

/**
 * The notification menu popup. It reads the deferred `notifications` namespace, so the dropdown
 * renders it only inside a `NamespaceBoundary` (`WORK_ROUTE_GATED_SURFACES`).
 */
export default function NotificationMenu({
  onClearAll,
}: {
  onClearAll: () => void;
}) {
  const { t } = useTranslation();
  const { data: inbox } = useGetNotifications("all");
  const notifications = inbox?.pages[0]?.data;
  const unreadCount = inbox?.pages[0]?.unreadCount ?? 0;
  const { mutate: markAllAsRead } = useMarkAllNotificationsAsRead();
  const handleNotificationClick = useNotificationClick();
  const hasNotifications = notifications && notifications.length > 0;

  return (
    <DropdownMenuContent align="end" className="w-88 p-0">
      {/* A menu may own only groups, items and separators (axe aria-required-children): the
          header is the group's label and the empty state a disabled item, not loose text. */}
      <DropdownMenuGroup className="overflow-hidden rounded-lg">
        <div className="flex h-10 items-center justify-between border-border/50 border-b pr-2 pl-3">
          <DropdownMenuLabel className="p-0 font-medium text-foreground text-sm">
            {t("notifications:title")}
          </DropdownMenuLabel>
          {unreadCount > 0 && (
            <DropdownMenuItem
              closeOnClick={false}
              onClick={() => markAllAsRead()}
              className="min-h-0 w-auto cursor-pointer rounded-md px-1.5 py-1 text-muted-foreground text-xs sm:min-h-0 sm:text-xs data-highlighted:text-foreground"
            >
              {t("common:actions.markAllRead")}
            </DropdownMenuItem>
          )}
        </div>

        <div className="relative max-h-80 overflow-y-auto p-1">
          {!hasNotifications ? (
            <DropdownMenuItem
              disabled
              data-testid="notifications-empty"
              className="flex-col items-center gap-1 py-10 text-center data-disabled:opacity-100"
            >
              <Bell
                aria-hidden="true"
                className="mb-1 size-5 text-muted-foreground opacity-100"
              />
              <span className="block text-muted-foreground text-sm">
                {t("notifications:emptyTitle")}
              </span>
              <span className="block text-muted-foreground text-xs">
                {t("notifications:emptySubtitle")}
              </span>
            </DropdownMenuItem>
          ) : (
            notifications.map((notification) => {
              const content = getNotificationContent(notification, t);
              return (
                <DropdownMenuItem
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className="cursor-pointer items-start rounded-md px-2.5 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "truncate text-sm transition-colors duration-fast",
                          notification.isRead
                            ? "text-muted-foreground"
                            : "font-medium text-foreground",
                        )}
                      >
                        {getNotificationTitle(notification, t)}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                        {formatRelativeTime(notification.createdAt)}
                      </span>
                      {!notification.isRead && (
                        <span className="size-1.5 shrink-0 rounded-full bg-info" />
                      )}
                    </div>
                    {content && (
                      <p
                        className={cn(
                          "mt-0.5 line-clamp-1 text-xs transition-colors duration-fast",
                          notification.isRead
                            ? "text-muted-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {content}
                      </p>
                    )}
                    {isLegacyTaskNotification(notification) && (
                      <p className="mt-0.5 text-muted-foreground text-xs italic">
                        {t("notifications:unavailable")}
                      </p>
                    )}
                  </div>
                </DropdownMenuItem>
              );
            })
          )}
        </div>
        {hasNotifications && (
          <div className="border-border/50 border-t p-1">
            <DropdownMenuItem
              onClick={onClearAll}
              className="min-h-0 cursor-pointer justify-center rounded-md px-2 py-1 text-muted-foreground text-xs sm:min-h-0 sm:text-xs data-highlighted:text-destructive"
            >
              {t("notifications:clearAll")}
            </DropdownMenuItem>
          </div>
        )}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  );
}
