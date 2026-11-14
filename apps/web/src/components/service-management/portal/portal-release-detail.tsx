import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  LoadingStatus,
  PageContainer,
  Skeleton,
  useDelayedPending,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { getPortalRelease } from "@/fetchers/portal/releases";
import { formatDateMedium } from "@/lib/format";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";

/** Plain-text rendering keeps customer publication independent of trusted HTML. */
export function PortalReleaseDetail({
  id,
  scope,
}: {
  id: string;
  scope: string;
}) {
  const { t } = useTranslation();
  const release = useQuery({
    queryKey: ["portal", scope, "release", id],
    queryFn: () => getPortalRelease(id),
    retry: false,
  });

  const placeholderVisible = useDelayedPending(release.isPending);
  if (
    !release.isError &&
    (release.isPending || (placeholderVisible && release.data))
  )
    return (
      <LoadingStatus
        visible={placeholderVisible}
        label={t("common:empty.loading")}
      >
        <PageContainer scroll={false} gutter="default" width="3xl">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
        </PageContainer>
      </LoadingStatus>
    );
  if (release.isError) {
    const unavailable =
      release.error instanceof HttpError && release.error.status === 404;
    return (
      <PageContainer scroll={false} gutter="default" width="3xl">
        {/* The page keeps one h1 while it shows only the error. */}
        <h1 className="sr-only">{t("portal:releases.title")}</h1>
        <Button
          variant="ghost"
          className="w-fit"
          render={<Link to={routes.portalReleases.path} />}
        >
          {t("portal:releases.backToList")}
        </Button>
        <Alert variant={unavailable ? "default" : "error"}>
          <AlertDescription>
            {unavailable
              ? t("portal:releases.unavailable")
              : t("portal:releases.loadFailed")}
          </AlertDescription>
        </Alert>
      </PageContainer>
    );
  }

  const entry = release.data;
  return (
    <PageContainer scroll={false} gutter="default" width="3xl">
      <Button
        variant="ghost"
        className="w-fit"
        render={<Link to={routes.portalReleases.path} />}
      >
        {t("portal:releases.backToList")}
      </Button>
      <header className="space-y-2">
        <h1 className="font-semibold text-2xl">{entry.name}</h1>
        <p className="text-sm text-muted-foreground">
          {entry.serviceName} · {t("portal:releases.released")}{" "}
          {formatDateMedium(entry.publishedAt)}
        </p>
        {entry.plannedDate ? (
          <p className="text-sm text-muted-foreground">
            {t("serviceManagement:releases.fields.plannedDate")}:{" "}
            {formatDateMedium(entry.plannedDate)}
          </p>
        ) : null}
      </header>
      <Card>
        <CardHeader>
          <CardTitle>{t("portal:releases.notes")}</CardTitle>
          <CardDescription>
            {t("portal:releases.service")}: {entry.serviceName}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entry.notes ? (
            <p className="whitespace-pre-wrap text-sm leading-6">
              {entry.notes}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("portal:releases.noNotes")}
            </p>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
