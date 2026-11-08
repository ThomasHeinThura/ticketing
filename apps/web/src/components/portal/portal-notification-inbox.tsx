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
  cn,
  Empty,
  EmptyDescription,
  EmptyHeader,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@taskdesk/ui";
import { Check, CircleDot } from "lucide-react";
import { useState } from "react";
import { ActionTooltip } from "@/components/common/action-tooltip";
import { formatPortalDateTime } from "@/components/portal/portal-format";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
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
import { routes } from "@/lib/routes";

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

/**
 * The row's link: its `after` overlay covers the whole row, so the row is the click target while
 * the read toggle sits above it (`relative z-10`). The focus ring is drawn on the row.
 */
const linkClassName =
  "min-w-0 break-words outline-none after:absolute after:inset-0 after:rounded-[inherit] hover:underline";

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
  // Opening a notification reads it (the agent dropdown does the same); never toggles back.
  // Hook-level callbacks still run after the link navigates away, so the bell refreshes.
  const markOpened = useMutation({
    mutationFn: (id: string) => markPortalNotificationRead(id),
    onSettled: invalidate,
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
      className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-4 p-4 sm:p-6"
    >
      <PortalPageTitle title={t("notifications.title")} />
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

      {rows.length > 0 ? (
        <Card className="overflow-hidden">
          <ol className="flex min-w-0 flex-col divide-y divide-border">
            {rows.map((notification) => (
              <PortalNotificationRow
                key={notification.id}
                notification={notification}
                pending={
                  updateOne.isPending &&
                  updateOne.variables?.id === notification.id
                }
                onToggleRead={(id) =>
                  updateOne.mutate({ id, unread: notification.isRead })
                }
                onOpen={(id) => {
                  if (!notification.isRead) markOpened.mutate(id);
                }}
              />
            ))}
          </ol>
        </Card>
      ) : null}

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

/**
 * One compact inbox row (CP-8, P7): an unread dot, the event as the row's link (bold while
 * unread), the request reference and time on one muted line, and the read toggle as a named
 * icon button. The API carries no request title (it withholds staff-written text), so the
 * reference identifies the request.
 */
function PortalNotificationRow({
  notification,
  pending,
  onToggleRead,
  onOpen,
}: {
  notification: PortalNotification;
  pending: boolean;
  onToggleRead(id: string): void;
  onOpen(id: string): void;
}) {
  const { t, i18n } = usePortalTranslation("portal");
  const locale = i18n?.resolvedLanguage || i18n?.language || undefined;
  const unread = !notification.isRead;
  const linkClass = cn(linkClassName, unread ? "font-semibold" : "font-normal");
  const toggleLabel = notification.isRead
    ? t("notifications.markUnread")
    : t("notifications.markRead");
  return (
    <li className="relative flex min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring has-[a:focus-visible]:ring-inset">
      <span
        aria-hidden="true"
        data-slot="portal-notification-dot"
        className={cn(
          "size-2 shrink-0 rounded-full",
          unread ? "bg-primary" : "bg-transparent",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm">
          {notification.requestRef ? (
            <Link
              to={
                notification.targetKind === "request"
                  ? routes.portalRequest.path
                  : routes.portalSubmission.path
              }
              params={{ ref: notification.requestRef }}
              hash={
                notification.commentId
                  ? `comment-${notification.commentId}`
                  : undefined
              }
              className={linkClass}
              onClick={() => onOpen(notification.id)}
            >
              {t(eventTranslation[notification.kind])}
            </Link>
          ) : (
            // AP-21: an approval event opens the Approvals screen (AP-19).
            <Link
              to="/approvals"
              className={linkClass}
              onClick={() => onOpen(notification.id)}
            >
              {t(eventTranslation[notification.kind])}
            </Link>
          )}
        </span>
        <span
          data-slot="portal-notification-meta"
          className="truncate text-muted-foreground text-xs"
        >
          {notification.requestRef ? (
            <>
              {t("notifications.requestReference", {
                ref: notification.requestRef,
              })}
              {" · "}
            </>
          ) : null}
          <time dateTime={notification.createdAt}>
            {formatPortalDateTime(notification.createdAt, locale)}
          </time>
        </span>
      </div>
      <ActionTooltip label={toggleLabel}>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative z-10 shrink-0"
          aria-label={toggleLabel}
          disabled={pending}
          onClick={() => onToggleRead(notification.id)}
        >
          {notification.isRead ? (
            <CircleDot aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
        </Button>
      </ActionTooltip>
    </li>
  );
}
