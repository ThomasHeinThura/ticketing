import { Button, Tabs, TabsList, TabsTrigger } from "@taskdesk/ui";
import { Bell, Mail, MailOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getNotificationContent,
  getNotificationTitle,
  useNotificationClick,
} from "@/components/notification/notification-dropdown";
import useMarkAllNotificationsAsRead from "@/hooks/mutations/notification/use-mark-all-notifications-as-read";
import useMarkNotificationAsRead from "@/hooks/mutations/notification/use-mark-notification-as-read";
import useMarkNotificationAsUnread from "@/hooks/mutations/notification/use-mark-notification-as-unread";
import useGetNotifications from "@/hooks/queries/notification/use-get-notifications";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import type { AgentInboxFilter } from "@/lib/routes";
import { matchesInboxFilter } from "./notification-filters";

type InboxFilter = AgentInboxFilter;

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
  const { mutate: markAsRead } = useMarkNotificationAsRead();
  const { mutate: markAsUnread } = useMarkNotificationAsUnread();
  const openNotification = useNotificationClick();

  const unread = notifications?.filter((n) => !n.isRead) ?? [];
  const visible = (notifications ?? []).filter((n) =>
    matchesInboxFilter(n, filter),
  );
  const emptyKey = {
    all: "notifications:emptyTitle",
    unread: "navigation:inbox.emptyUnread",
    mentions: "navigation:inbox.emptyMentions",
    assignments: "navigation:inbox.emptyAssignments",
  }[filter];

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
            <TabsTrigger value="mentions">
              {t("navigation:inbox.mentions")}
            </TabsTrigger>
            <TabsTrigger value="assignments">
              {t("navigation:inbox.assignments")}
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
          <p className="text-muted-foreground text-sm">{t(emptyKey)}</p>
          <p className="text-muted-foreground text-xs">
            {t("notifications:emptySubtitle")}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {visible.map((notification) => {
            const content = getNotificationContent(notification, t);
            const toggleLabel = notification.isRead
              ? t("common:actions.markUnread")
              : t("common:actions.markRead");
            return (
              <li key={notification.id} className="group relative">
                <Button
                  variant="ghost"
                  onClick={() => openNotification(notification)}
                  className="h-auto w-full sm:h-auto items-start justify-start gap-3 whitespace-normal rounded-none px-4 py-3 pr-14 text-left font-normal hover:bg-accent/50"
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
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={toggleLabel}
                  title={toggleLabel}
                  className="absolute top-2 right-3 text-muted-foreground opacity-0 pointer-coarse:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                  onClick={() =>
                    notification.isRead
                      ? markAsUnread(notification.id)
                      : markAsRead(notification.id)
                  }
                >
                  {notification.isRead ? (
                    <Mail className="size-4" />
                  ) : (
                    <MailOpen className="size-4" />
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
