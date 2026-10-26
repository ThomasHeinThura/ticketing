import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { getPortalReleases } from "@/fetchers/portal/releases";
import { formatDateMedium } from "@/lib/format";
import { routes } from "@/lib/routes";

/** Customer release notes, sourced only from persisted published snapshots. */
export function PortalReleasesList({
  scope,
  cursor,
}: {
  scope: string;
  cursor?: string;
}) {
  const { t } = useTranslation();
  const releases = useInfiniteQuery({
    queryKey: ["portal", scope, "releases", cursor],
    initialPageParam: cursor,
    queryFn: ({ pageParam }) =>
      getPortalReleases({ limit: 20, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const entries = releases.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="font-semibold text-2xl">{t("portal:releases.title")}</h1>
        <p className="text-muted-foreground">
          {t("portal:releases.description")}
        </p>
      </header>
      {releases.isPending ? (
        <div
          role="status"
          aria-label={t("portal:releases.loading")}
          className="space-y-3"
        >
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : releases.isError ? (
        <Alert variant="error">
          <AlertDescription>
            {t("portal:releases.loadFailed")}
            <Button
              className="mt-2 w-fit"
              onClick={() => void releases.refetch()}
            >
              {t("common:actions.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : entries.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("portal:releases.emptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("portal:releases.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((release) => (
            <Card key={release.id}>
              <CardHeader>
                <CardTitle>
                  <Link
                    className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    to={routes.portalRelease.path}
                    params={{ id: release.id }}
                  >
                    {release.name}
                  </Link>
                </CardTitle>
                <CardDescription>
                  {release.serviceName} · {t("portal:releases.released")}{" "}
                  {formatDateMedium(release.publishedAt)}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
          {releases.hasNextPage ? (
            <Button
              variant="outline"
              className="self-start"
              disabled={releases.isFetchingNextPage}
              onClick={() => void releases.fetchNextPage()}
            >
              {t("portal:releases.loadMore")}
            </Button>
          ) : null}
        </div>
      )}
    </main>
  );
}
