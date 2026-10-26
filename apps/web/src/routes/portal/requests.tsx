import {
  useInfiniteQuery,
  useMutation,
  useQuery,
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
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { PortalRequestState } from "@/components/portal/portal-request-state";
import { PortalSlaStatus } from "@/components/portal/portal-sla-status";
import { getPortalSubmissions } from "@/fetchers/intake";
import {
  getPortalBacklog,
  type PortalBacklogItem,
  rankPortalBacklogItem,
} from "@/fetchers/portal-backlog";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { readPortalSla } from "@/lib/portal-request";
import { parsePortalRequestsSearch, routes } from "@/lib/routes";

export const Route = createFileRoute("/requests")({
  validateSearch: parsePortalRequestsSearch,
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
  const query = useQuery({
    queryKey: ["portal", portalUserId, "submissions", cursor],
    queryFn: () => getPortalSubmissions({ cursor }),
    enabled: !backlogMode,
  });
  const backlogQuery = useInfiniteQuery({
    queryKey: ["portal", portalUserId, "backlog"],
    queryFn: ({ pageParam }) => getPortalBacklog(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
    enabled: backlogMode,
  });
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

  const submissions = query.data?.submissions ?? [];
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
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {backlogMode
              ? t("requests.backlog", { defaultValue: "Backlog" })
              : t("requests.title", { defaultValue: "My requests" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {backlogMode
              ? t("requests.backlogDescription", {
                  defaultValue:
                    "Accepted requests in your organisation’s backlog. Use the arrow controls to change their order.",
                })
              : t("requests.description", {
                  defaultValue:
                    "Track requests you submitted or can view across your organisation.",
                })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={backlogMode ? "outline" : "secondary"}
            onClick={() => void navigate({ search: {} })}
          >
            {t("requests.showRequests", { defaultValue: "My requests" })}
          </Button>
          <Button
            variant={backlogMode ? "secondary" : "outline"}
            onClick={() => void navigate({ search: { view: "backlog" } })}
          >
            {t("requests.backlog", { defaultValue: "Backlog" })}
          </Button>
          <Button render={<Link to={routes.portalCatalogue.path} />}>
            {t("requests.newRequest", { defaultValue: "New request" })}
          </Button>
        </div>
      </header>

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
        backlogQuery.isLoading ? (
          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
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
      ) : query.isLoading ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      ) : submissions.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {t("requests.emptyTitle", {
                    defaultValue: "No requests found",
                  })}
                </EmptyTitle>
                <EmptyDescription>
                  {t("requests.emptyDescription", {
                    defaultValue:
                      "You haven't submitted any service requests yet.",
                  })}
                </EmptyDescription>
              </EmptyHeader>
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  render={<Link to={routes.portalCatalogue.path} />}
                >
                  {t("requests.browseCatalogue", {
                    defaultValue: "Browse request catalogue",
                  })}
                </Button>
              </div>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("requests.reference")}</TableHead>
                <TableHead>{t("requests.type")}</TableHead>
                <TableHead>{t("requests.status")}</TableHead>
                <TableHead>{t("requests.due")}</TableHead>
                <TableHead>{t("requests.visibility")}</TableHead>
                <TableHead>{t("requests.submitted")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {submissions.map((sub) => (
                <TableRow key={sub.ref}>
                  <TableCell className="font-medium">
                    <Link
                      to={routes.portalSubmission.path}
                      params={{ ref: sub.ref }}
                      className="text-primary hover:underline"
                    >
                      {sub.ref}
                    </Link>
                  </TableCell>
                  <TableCell>{sub.requestTypeName}</TableCell>
                  <TableCell>
                    <PortalRequestState
                      state={sub.state}
                      customerStatus={
                        (sub as { customerStatus?: string }).customerStatus
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <PortalSlaStatus
                      sla={readPortalSla((sub as { sla?: unknown }).sla)}
                    />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {sub.customerVisibility === "organisation"
                      ? t("intake.visibilityOrganisation", {
                          defaultValue: "Organisation",
                        })
                      : t("intake.visibilityPrivate", {
                          defaultValue: "Private",
                        })}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(sub.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {!backlogMode ? (
        <nav
          aria-label={t("requests.pagination")}
          className="flex items-center justify-between gap-2"
        >
          {cursor ? (
            <Button
              variant="outline"
              onClick={() => void navigate({ search: {} })}
            >
              {t("requests.latest")}
            </Button>
          ) : (
            <span />
          )}
          {query.data?.page.hasMore && query.data.page.nextCursor ? (
            <Button
              variant="outline"
              onClick={() =>
                void navigate({
                  search: { cursor: query.data?.page.nextCursor ?? undefined },
                })
              }
            >
              {t("requests.older")}
            </Button>
          ) : null}
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
    </main>
  );
}
