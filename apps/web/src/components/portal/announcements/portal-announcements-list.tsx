import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  useDelayedPending,
} from "@taskdesk/ui";
import { Megaphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnnouncementSeverityBadge } from "@/components/announcements/announcement-severity-badge";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
import {
  getPortalAnnouncements,
  type PortalAnnouncement,
} from "@/fetchers/portal/announcements";
import { formatDateTime } from "@/lib/format";
import { routes } from "@/lib/portal-route-builders";

import { PortalAnnouncementsTabs } from "./portal-announcements-tabs";

/** "From … until …" or "Since …" for an announcement's window. */
export function useAnnouncementWindow() {
  const { t } = useTranslation();
  return (announcement: PortalAnnouncement) =>
    announcement.endsAt
      ? t("portal:announcements.window", {
          start: formatDateTime(announcement.startsAt),
          end: formatDateTime(announcement.endsAt),
        })
      : t("portal:announcements.since", {
          start: formatDateTime(announcement.startsAt),
        });
}

/** D7: the announcements currently addressed to the customer's organisation. */
export function PortalAnnouncementsList({
  scope,
  cursor,
}: {
  scope: string;
  cursor?: string;
}) {
  const { t } = useTranslation();
  const windowOf = useAnnouncementWindow();
  const announcements = useInfiniteQuery({
    queryKey: ["portal", scope, "announcements", cursor],
    initialPageParam: cursor,
    queryFn: ({ pageParam }) =>
      getPortalAnnouncements({ limit: 20, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const placeholderVisible = useDelayedPending(announcements.isPending, {
    releaseNow:
      announcements.isSuccess &&
      announcements.data.pages.every((page) => page.data.length === 0),
  });
  const entries = announcements.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <PortalPageTitle title={t("portal:announcements.title")} />
      <header className="space-y-1">
        <h1 className="font-semibold text-2xl">
          {t("portal:announcements.title")}
        </h1>
        <p className="text-muted-foreground">
          {t("portal:announcements.description")}
        </p>
      </header>
      <PortalAnnouncementsTabs />
      {!announcements.isError &&
      (announcements.isPending || placeholderVisible) ? (
        <div
          role="status"
          aria-label={t("portal:announcements.loading")}
          className="space-y-3"
          style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
        >
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : announcements.isError ? (
        <Alert variant="error">
          <AlertDescription>
            {t("portal:announcements.loadFailed")}
            <Button
              className="mt-2 w-fit"
              onClick={() => void announcements.refetch()}
            >
              {t("common:actions.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : entries.length === 0 ? (
        // UX-1a (CP-10): the shared empty look.
        <EmptyState
          icon={<Megaphone />}
          title={t("portal:announcements.emptyTitle")}
          description={t("portal:announcements.emptyDescription")}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((announcement) => (
            <Card key={announcement.id}>
              <CardHeader>
                <CardTitle>
                  <Link
                    className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    to={routes.portalAnnouncement.path}
                    params={{ id: announcement.id }}
                  >
                    {announcement.title}
                  </Link>
                </CardTitle>
                <CardDescription>{windowOf(announcement)}</CardDescription>
                <CardAction>
                  <AnnouncementSeverityBadge
                    severity={announcement.severity}
                    label={t(
                      `portal:announcements.severity.${announcement.severity}`,
                    )}
                  />
                </CardAction>
              </CardHeader>
            </Card>
          ))}
          {announcements.hasNextPage ? (
            <Button
              variant="outline"
              className="self-start"
              disabled={announcements.isFetchingNextPage}
              onClick={() => void announcements.fetchNextPage()}
            >
              {t("portal:announcements.loadMore")}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
