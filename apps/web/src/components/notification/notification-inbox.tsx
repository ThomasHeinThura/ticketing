import { Button, Tabs, TabsList, TabsTrigger } from "@taskdesk/ui";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getNotificationContent,
  getNotificationTitle,
  useNotificationClick,
} from "@/components/notification/notification-dropdown";
import useMarkAllNotificationsAsRead from "@/hooks/mutations/notification/use-mark-all-notifications-as-read";
import useGetNotifications from "@/hooks/queries/notification/use-get-notifications";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";

type InboxFilter = "all" | "unread";

/**
 * `/agent/inbox`: kaneo's notifications as a full page, using the same API, hooks and row
 * rendering as the bell dropdown. `filter` is URL state.
 */
export default function NotificationInbox({
  filter,
  onFilterChange,
}: {
  filter: InboxFilter;
  onFilterChange: (filter: InboxFilter) => void;
}) {
  const { t } = useTranslation();
  const {
    data: notifications,
    isLoading,
    isError,
    refetch,
  } = useGetNotifications();
  const { mutate: markAllAsRead, isPending: isMarkingAll } =
    useMarkAllNotificationsAsRead();
  const openNotification = useNotificationClick();

  const unread = notifications?.filter((n) => !n.isRead) ?? [];
  const visible = filter === "unread" ? unread : (notifications ?? []);

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="sr-only">{t("navigation:sidebar.inbox")}</h1>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={filter}
          onValueChange={(value) => onFilterChange(value as InboxFilter)}
        >
          <TabsList className="bg-sidebar gap-2">
            <TabsTrigger value="all">{t("navigation:inbox.all")}</TabsTrigger>
            <TabsTrigger value="unread">
              {t("navigation:inbox.unread", { count: unread.length })}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {unread.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isMarkingAll}
            onClick={() => markAllAsRead()}
          >
            {t("common:actions.markAllRead")}
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t("common:empty.loading")}
        </p>
      ) : isError ? (
        <div className="flex items-center gap-3 text-sm" role="alert">
          <span>{t("navigation:inbox.loadError")}</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t("common:actions.retry")}
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-border py-16 text-center">
          <Bell className="mb-1 size-5 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">
            {filter === "unread"
              ? t("navigation:inbox.emptyUnread")
              : t("notifications:emptyTitle")}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("notifications:emptySubtitle")}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {visible.map((notification) => {
            const content = getNotificationContent(notification, t);
            return (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => openNotification(notification)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "truncate text-sm",
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
                    {content ? (
                      <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">
                        {content}
                      </p>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
