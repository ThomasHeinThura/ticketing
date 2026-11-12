import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Frame,
  FramePanel,
  LoadingStatus,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useDelayedPending,
} from "@taskdesk/ui";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  type PortalCaseFilterPatch,
  PortalCaseFilters,
} from "@/components/portal/cases/portal-case-filters";
import { PortalCaseTable } from "@/components/portal/cases/portal-case-table";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
import {
  type PortalCaseQuery,
  portalCaseExportUrl,
} from "@/fetchers/portal/cases";
import {
  getPortalBacklog,
  type PortalBacklogItem,
  rankPortalBacklogItem,
} from "@/fetchers/portal-backlog";
import { usePortalCases } from "@/hooks/queries/portal/use-portal-cases";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import {
  type PortalRequestsSearch,
  parsePortalRequestsSearch,
  portalProjectSearchMiddlewares,
  routes,
} from "@/lib/routes";

/** Cases per page on the full list. */
const PAGE_SIZE = 25;
/** The server's CSV row cap (`PORTAL_CASE_EXPORT_CAP`); a larger result is cut short. */
const PORTAL_EXPORT_CAP = 5000;

export const Route = createFileRoute("/requests")({
  validateSearch: parsePortalRequestsSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalRequestsPage,
});

function PortalRequestsPage() {
  const { t } = usePortalTranslation("portal");
  const { portalUserId } = Route.useRouteContext();
  const search = Route.useSearch();
  const { cursor, view } = search;
  const backlogMode = view === "backlog";
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const caseQuery: PortalCaseQuery = {
    scope: search.scope ?? "mine",
    ...(search.status ? { status: search.status } : {}),
    ...(search.priority ? { priority: search.priority } : {}),
    ...(search.project ? { project: search.project } : {}),
    ...(search.q ? { q: search.q } : {}),
    ...(search.from ? { from: search.from } : {}),
    ...(search.to ? { to: search.to } : {}),
    ...(search.sort ? { sort: search.sort } : {}),
    ...(cursor ? { cursor } : {}),
    limit: PAGE_SIZE,
  };
  const query = usePortalCases(portalUserId, caseQuery, {
    enabled: !backlogMode,
  });
  // A filter change starts again at the first page.
  const updateFilters = (patch: PortalCaseFilterPatch) =>
    void navigate({
      search: (previous: PortalRequestsSearch) => ({
        ...previous,
        ...patch,
        cursor: undefined,
      }),
      replace: true,
    });
  const backlogQuery = useInfiniteQuery({
    queryKey: ["portal", portalUserId, "backlog", search.project],
    queryFn: ({ pageParam }) => getPortalBacklog(pageParam, search.project),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
    enabled: backlogMode,
  });
  const casesPlaceholder = useDelayedPending(!backlogMode && query.isLoading, {
    releaseNow:
      !backlogMode && query.isSuccess && query.data.cases.length === 0,
  });
  const backlogPlaceholder = useDelayedPending(
    backlogMode && backlogQuery.isLoading,
    {
      releaseNow:
        backlogMode &&
        backlogQuery.isSuccess &&
        backlogQuery.data.pages.every((page) => page.items.length === 0),
    },
  );
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [pendingFocusDirection, setPendingFocusDirection] = useState<
    -1 | 1 | null
  >(null);
  const [focusAfterDataUpdatedAt, setFocusAfterDataUpdatedAt] = useState<
    number | null
  >(null);
  const [rankFailed, setRankFailed] = useState(false);
  const requestRefs = useRef(new Map<string, HTMLAnchorElement>());
  const rankMutation = useMutation({
    mutationFn: rankPortalBacklogItem,
    onSuccess: async () => {
      setRankFailed(false);
      await queryClient.invalidateQueries({
        queryKey: ["portal", portalUserId, "backlog"],
      });
      setFocusAfterDataUpdatedAt(0);
    },
  });
  useEffect(() => {
    if (
      !backlogQuery.isFetching &&
      !rankMutation.isPending &&
      pendingFocusId &&
      focusAfterDataUpdatedAt !== null &&
      backlogQuery.dataUpdatedAt > focusAfterDataUpdatedAt
    ) {
      const actionButtons = requestRefs.current
        .get(pendingFocusId)
        ?.closest("tr")
        ?.querySelectorAll<HTMLButtonElement>("button");
      const candidates =
        pendingFocusDirection === -1
          ? [actionButtons?.item(0), actionButtons?.item(1)]
          : [actionButtons?.item(1), actionButtons?.item(0)];
      const enabledAction = candidates.find(
        (button): button is HTMLButtonElement =>
          Boolean(button && !button.disabled),
      );
      (enabledAction ?? requestRefs.current.get(pendingFocusId))?.focus();
      setPendingFocusId(null);
      setPendingFocusDirection(null);
      setFocusAfterDataUpdatedAt(null);
    }
  }, [
    backlogQuery.dataUpdatedAt,
    backlogQuery.isFetching,
    focusAfterDataUpdatedAt,
    pendingFocusId,
    pendingFocusDirection,
    rankMutation.isPending,
  ]);

  const cases = query.data?.cases ?? [];
  const filtered = Boolean(
    search.status ||
      search.priority ||
      search.q ||
      search.from ||
      search.to ||
      search.scope,
  );
  const backlogItems =
    backlogQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const backlogGroups = useMemo(() => {
    const groups = new Map<
      string,
      { label: string; items: PortalBacklogItem[] }
    >();
    for (const item of backlogItems) {
      const key = JSON.stringify([item.projectId, item.stateId]);
      const group = groups.get(key) ?? {
        label: `${item.projectName} · ${item.stateName}`,
        items: [],
      };
      group.items.push(item);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [backlogItems]);

  const moveBacklogItem = async (
    groupItems: PortalBacklogItem[],
    index: number,
    direction: -1 | 1,
  ) => {
    const item = groupItems[index];
    if (!item) return;
    const destination = index + direction;
    if (destination < 0 || destination >= groupItems.length) return;
    const target = groupItems[destination];
    if (!target) return;
    const before =
      direction < 0 ? groupItems[index - 2] : groupItems[index + 1];
    const after = direction < 0 ? groupItems[index - 1] : groupItems[index + 2];
    setPendingFocusId(item.id);
    setPendingFocusDirection(direction);
    setFocusAfterDataUpdatedAt(backlogQuery.dataUpdatedAt);
    try {
      await rankMutation.mutateAsync({
        key: item.key,
        ...(before ? { beforeId: before.id } : {}),
        ...(after ? { afterId: after.id } : {}),
      });
    } catch {
      setRankFailed(true);
      setPendingFocusId(null);
      setPendingFocusDirection(null);
      setFocusAfterDataUpdatedAt(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <PortalPageTitle
        title={backlogMode ? t("requests.backlog") : t("cases.listTitle")}
      />
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="font-semibold text-xl">
            {backlogMode ? t("requests.backlog") : t("cases.listTitle")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {backlogMode
              ? t("requests.backlogDescription")
              : t("cases.listDescription")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={backlogMode ? "outline" : "secondary"}
            onClick={() =>
              void navigate({
                search: (previous: PortalRequestsSearch) => ({
                  project: previous.project,
                }),
              })
            }
          >
            {t("cases.listTitle")}
          </Button>
          <Button
            variant={backlogMode ? "secondary" : "outline"}
            onClick={() =>
              void navigate({
                search: (previous: PortalRequestsSearch) => ({
                  project: previous.project,
                  view: "backlog",
                }),
              })
            }
          >
            {t("requests.backlog")}
          </Button>
          {backlogMode ? null : (
            <Button
              variant="outline"
              render={<a href={portalCaseExportUrl(caseQuery)} download />}
            >
              <Download className="size-4" aria-hidden="true" />
              {t("cases.export")}
            </Button>
          )}
          <Button render={<Link to={routes.portalCatalogue.path} />}>
            {t("requests.newRequest")}
          </Button>
        </div>
      </header>
      {backlogMode ? null : (
        <PortalCaseFilters filters={search} onChange={updateFilters} full />
      )}

      {(backlogMode ? backlogQuery.isError : query.isError) ? (
        <Alert variant="error">
          <AlertTitle>
            {t("error.title", { defaultValue: "Unable to load requests" })}
          </AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              {t(
                backlogMode
                  ? "requests.backlogLoadFailed"
                  : "requests.loadFailed",
              )}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void (backlogMode ? backlogQuery.refetch() : query.refetch())
              }
            >
              {t("common:actions.tryAgain", { defaultValue: "Try again" })}
            </Button>
          </AlertDescription>
        </Alert>
      ) : backlogMode ? (
        backlogQuery.isLoading || backlogPlaceholder ? (
          <LoadingStatus
            visible={backlogPlaceholder}
            label={t("common:empty.loading")}
          >
            <Card>
              <CardContent className="flex flex-col gap-3 p-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          </LoadingStatus>
        ) : backlogItems.length === 0 ? (
          <Card>
            <CardContent className="p-8">
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    {t("requests.backlogEmptyTitle", {
                      defaultValue: "No accepted requests in the backlog",
                    })}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t("requests.backlogEmptyDescription", {
                      defaultValue:
                        "Accepted requests appear here while they are in a backlog state.",
                    })}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </CardContent>
          </Card>
        ) : (
          <>
            {rankFailed ? (
              <Alert variant="error">
                <AlertDescription>
                  {t("requests.rankFailed", {
                    defaultValue:
                      "Could not reorder this request. Refresh and try again.",
                  })}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="overflow-x-auto rounded-md border border-border">
              <Table className="table-fixed w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">
                      {t("requests.reference")}
                    </TableHead>
                    <TableHead>
                      {t("requests.backlogItem", { defaultValue: "Work item" })}
                    </TableHead>
                    <TableHead className="w-24 text-right">
                      {t("requests.reorder", { defaultValue: "Reorder" })}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backlogGroups.map((group) => (
                    <Fragment
                      key={JSON.stringify([
                        group.items[0]?.projectId,
                        group.items[0]?.stateId,
                      ])}
                    >
                      <TableRow>
                        <TableCell
                          colSpan={3}
                          className="whitespace-normal break-words bg-muted/40 font-medium"
                        >
                          {group.label}
                        </TableCell>
                      </TableRow>
                      {group.items.map((item, index) => (
                        <TableRow key={item.id}>
                          <TableCell className="w-20 whitespace-normal break-words font-medium">
                            <Link
                              to={routes.portalSubmission.path}
                              params={{ ref: item.sourceRef }}
                              className="text-primary hover:underline"
                              ref={(node) => {
                                if (node)
                                  requestRefs.current.set(item.id, node);
                                else requestRefs.current.delete(item.id);
                              }}
                            >
                              {item.sourceRef}
                            </Link>
                          </TableCell>
                          <TableCell className="min-w-0 whitespace-normal break-words">
                            <span className="text-xs text-muted-foreground">
                              {item.key}
                            </span>
                            <span className="ml-2">{item.title}</span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right">
                            <div className="inline-flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={t("requests.rankEarlier", {
                                  defaultValue: `Move ${item.sourceRef} earlier`,
                                })}
                                disabled={rankMutation.isPending || index === 0}
                                onClick={() =>
                                  void moveBacklogItem(group.items, index, -1)
                                }
                              >
                                <ArrowUp
                                  aria-hidden="true"
                                  className="size-4"
                                />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={t("requests.rankLater", {
                                  defaultValue: `Move ${item.sourceRef} later`,
                                })}
                                disabled={
                                  rankMutation.isPending ||
                                  index === group.items.length - 1
                                }
                                onClick={() =>
                                  void moveBacklogItem(group.items, index, 1)
                                }
                              >
                                <ArrowDown
                                  aria-hidden="true"
                                  className="size-4"
                                />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )
      ) : !query.data || casesPlaceholder ? (
        <LoadingStatus
          visible={casesPlaceholder}
          label={t("common:empty.loading")}
        >
          <Skeleton
            className="h-64 w-full rounded-xl"
            style={{ visibility: casesPlaceholder ? "visible" : "hidden" }}
          />
        </LoadingStatus>
      ) : cases.length === 0 ? (
        <Frame>
          <FramePanel className="p-8">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {filtered ? t("cases.emptyTitle") : t("cases.emptyNoneTitle")}
                </EmptyTitle>
                <EmptyDescription>
                  {filtered
                    ? t("cases.emptyDescription")
                    : t("cases.emptyNoneDescription")}
                </EmptyDescription>
              </EmptyHeader>
              {filtered ? null : (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="outline"
                    render={<Link to={routes.portalCatalogue.path} />}
                  >
                    {t("requests.browseCatalogue")}
                  </Button>
                </div>
              )}
            </Empty>
          </FramePanel>
        </Frame>
      ) : (
        <PortalCaseTable
          cases={cases}
          columns={["project", "created"]}
          caption={t("cases.listTitle")}
        />
      )}
      {!backlogMode ? (
        <nav
          aria-label={t("cases.pagination")}
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <span className="text-muted-foreground text-xs" aria-live="polite">
            {query.data
              ? t("cases.summary", {
                  shown: cases.length,
                  total: query.data.meta.total,
                })
              : null}
            {query.data && query.data.meta.total > PORTAL_EXPORT_CAP
              ? ` · ${t("cases.exportHint")}`
              : null}
          </span>
          <div className="flex items-center gap-2">
            {cursor ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigate({
                    search: (previous: PortalRequestsSearch) => ({
                      ...previous,
                      cursor: undefined,
                    }),
                  })
                }
              >
                {t("cases.firstPage")}
              </Button>
            ) : null}
            {query.data?.page.hasMore && query.data.page.nextCursor ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigate({
                    search: (previous: PortalRequestsSearch) => ({
                      ...previous,
                      cursor: query.data?.page.nextCursor ?? undefined,
                    }),
                  })
                }
              >
                {t("cases.nextPage")}
              </Button>
            ) : null}
          </div>
        </nav>
      ) : backlogQuery.hasNextPage ? (
        <nav
          aria-label={t("requests.backlogPagination", {
            defaultValue: "Backlog pagination",
          })}
          className="flex justify-end"
        >
          <Button
            variant="outline"
            disabled={backlogQuery.isFetchingNextPage}
            onClick={() => void backlogQuery.fetchNextPage()}
          >
            {t("requests.backlogMore", { defaultValue: "Load more" })}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
