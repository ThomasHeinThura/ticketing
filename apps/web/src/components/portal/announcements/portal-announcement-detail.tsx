import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Skeleton,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { AnnouncementSeverityBadge } from "@/components/announcements/announcement-severity-badge";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
import { getPortalAnnouncement } from "@/fetchers/portal/announcements";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/portal-route-builders";

import { useAnnouncementWindow } from "./portal-announcements-list";

/** Plain text only: announcement bodies never render as HTML or markdown. */
export function PortalAnnouncementDetail({
  id,
  scope,
}: {
  id: string;
  scope: string;
}) {
  const { t } = useTranslation();
  const windowOf = useAnnouncementWindow();
  const announcement = useQuery({
    queryKey: ["portal", scope, "announcement", id],
    queryFn: () => getPortalAnnouncement(id),
    retry: false,
  });
  const back = (
    <Button
      variant="ghost"
      className="w-fit"
      render={<Link to={routes.portalAnnouncements.path} />}
    >
      {t("portal:announcements.backToList")}
    </Button>
  );

  if (announcement.isPending)
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
        <PortalPageTitle title={t("portal:announcements.title")} />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  if (announcement.isError) {
    const unavailable =
      announcement.error instanceof HttpError &&
      announcement.error.status === 404;
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
        <PortalPageTitle title={t("portal:announcements.title")} />
        {/* The page keeps one h1 while it shows only the error. */}
        <h1 className="sr-only">{t("portal:announcements.title")}</h1>
        {back}
        <Alert variant={unavailable ? "default" : "error"}>
          <AlertDescription>
            {unavailable
              ? t("portal:announcements.unavailable")
              : t("portal:announcements.loadFailed")}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const entry = announcement.data;
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <PortalPageTitle title={entry.title} />
      {back}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-semibold text-2xl">{entry.title}</h1>
          <AnnouncementSeverityBadge
            severity={entry.severity}
            label={t(`portal:announcements.severity.${entry.severity}`)}
          />
        </div>
        <p className="text-sm text-muted-foreground">{windowOf(entry)}</p>
      </header>
      <Card>
        <CardContent>
          {entry.body ? (
            <p className="whitespace-pre-wrap text-sm leading-6">
              {entry.body}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("portal:announcements.noBody")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
