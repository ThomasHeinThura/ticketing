import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@taskdesk/ui";
import { useState } from "react";
import {
  getPortalNotifications,
  markAllPortalNotificationsRead,
  markPortalNotificationRead,
  markPortalNotificationUnread,
  type PortalNotification,
  type PortalNotificationFilter,
  type PortalNotificationKind,
} from "@/fetchers/portal-notifications";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { portalNotificationQueryKey } from "@/lib/portal-notification-query-keys";

const eventTranslation: Record<PortalNotificationKind, string> = {
  "work_item.commented": "notifications.events.comment",
  "work_item.mentioned": "notifications.events.mention",
  "work_item.transitioned": "notifications.events.transition",
  "submission.replied": "notifications.events.requestReply",
  "submission.declined": "notifications.events.requestDeclined",
  "approval.requested": "notifications.events.approvalRequested",
  "approval.expiring": "notifications.events.approvalExpiring",
  "approval.withdrawn": "notifications.events.approvalWithdrawn",
};

const linkClassName =
  "hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring";

export function PortalNotificationInbox({
  filter: controlledFilter,
  onFilterChange,
}: {
  filter?: PortalNotificationFilter;
  onFilterChange?(filter: PortalNotificationFilter): void;
} = {}) {
  const { t } = usePortalTranslation("portal");
  const queryClient = useQueryClient();
  const [localFilter, setLocalFilter] =
    useState<PortalNotificationFilter>("all");
  const filter = controlledFilter ?? localFilter;
  const setFilter = (value: PortalNotificationFilter) => {
    if (onFilterChange) onFilterChange(value);
    else setLocalFilter(value);
  };
  const inbox = useInfiniteQuery({
    queryKey: [...portalNotificationQueryKey, filter],
    queryFn: ({ pageParam }) =>
      getPortalNotifications({ filter, limit: 25, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: portalNotificationQueryKey });
  const updateOne = useMutation({
    mutationFn: ({ id, unread }: { id: string; unread: boolean }) =>
      unread
        ? markPortalNotificationUnread(id)
        : markPortalNotificationRead(id),
    onSuccess: invalidate,
  });
  const updateAll = useMutation({
    mutationFn: markAllPortalNotificationsRead,
    onSuccess: invalidate,
  });
  const rows = inbox.data?.pages.flatMap((page) => page.data) ?? [];
  const unreadCount = inbox.data?.pages[0]?.unreadCount ?? 0;

  return (
    <section
      aria-labelledby="portal-notifications-title"
      className="flex min-w-0 flex-col gap-4 p-4 md:p-6"
    >
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1
            id="portal-notifications-title"
            className="text-2xl font-semibold"
          >
            {t("notifications.title")}
          </h1>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t("notifications.unreadCount", { count: unreadCount })}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={unreadCount === 0 || updateAll.isPending}
          onClick={() => updateAll.mutate()}
        >
          {t("notifications.markAllRead")}
        </Button>
      </header>

      <Tabs
        value={filter}
        onValueChange={(value) => setFilter(value as PortalNotificationFilter)}
      >
        <TabsList className="bg-sidebar w-max max-w-full gap-2 overflow-x-auto">
          <TabsTrigger value="all">{t("notifications.filterAll")}</TabsTrigger>
          <TabsTrigger value="unread">
            {t("notifications.filterUnread")}
          </TabsTrigger>
          <TabsTrigger value="mentions">
            {t("notifications.filterMentions")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {updateOne.isError || updateAll.isError ? (
        <Alert variant="error">
          <AlertDescription>{t("notifications.actionFailed")}</AlertDescription>
        </Alert>
      ) : null}
      {inbox.isError ? (
        <Alert variant="error">
          <AlertDescription>{t("notifications.loadFailed")}</AlertDescription>
        </Alert>
      ) : null}
      {inbox.isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("common:empty.loading")}
        </p>
      ) : null}
      {!inbox.isLoading && !inbox.isError && rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyDescription>{t("notifications.empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      <ol className="flex min-w-0 flex-col gap-3">
        {rows.map((notification) => (
          <PortalNotificationCard
            key={notification.id}
            notification={notification}
            pending={
              updateOne.isPending && updateOne.variables?.id === notification.id
            }
            onToggleRead={(id) =>
              updateOne.mutate({ id, unread: notification.isRead })
            }
          />
        ))}
      </ol>

      {inbox.hasNextPage ? (
        <Button
          variant="outline"
          className="self-start"
          disabled={inbox.isFetchingNextPage}
          onClick={() => void inbox.fetchNextPage()}
        >
          {t("notifications.loadMore")}
        </Button>
      ) : null}
    </section>
  );
}

function PortalNotificationCard({
  notification,
  pending,
  onToggleRead,
}: {
  notification: PortalNotification;
  pending: boolean;
  onToggleRead(id: string): void;
}) {
  const { t } = usePortalTranslation("portal");
  return (
    <li>
      <Card
        className={notification.isRead ? "opacity-85" : "border-primary/40"}
      >
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="text-base">
              {notification.requestRef ? (
                <Link
                  to="/submissions/$ref"
                  params={{ ref: notification.requestRef }}
                  hash={
                    notification.commentId
                      ? `comment-${notification.commentId}`
                      : undefined
                  }
                  className={linkClassName}
                >
                  {t(eventTranslation[notification.kind])}
                </Link>
              ) : (
                // AP-21: an approval event opens the Approvals screen (AP-19).
                <Link to="/approvals" className={linkClassName}>
                  {t(eventTranslation[notification.kind])}
                </Link>
              )}
            </CardTitle>
            <CardDescription>
              {new Date(notification.createdAt).toLocaleString()}
            </CardDescription>
          </div>
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => onToggleRead(notification.id)}
            >
              {notification.isRead
                ? t("notifications.markUnread")
                : t("notifications.markRead")}
            </Button>
          </CardAction>
        </CardHeader>
        {notification.requestRef ? (
          <CardPanel>
            <p className="text-sm text-muted-foreground">
              {t("notifications.requestReference", {
                ref: notification.requestRef,
              })}
            </p>
          </CardPanel>
        ) : null}
      </Card>
    </li>
  );
}
