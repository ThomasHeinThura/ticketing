import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Alert, AlertDescription, SidebarTrigger } from "@taskdesk/ui";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import { TaskPageFrame } from "@/components/common/task-layout";
import PageTitle from "@/components/page-title";
import loadWorkItemDetail from "@/components/work-item/load-work-item-detail";
import WorkItemActions from "@/components/work-item/work-item-actions";
import type { ActivityFilter } from "@/components/work-item/work-item-activity";
import WorkItemCrumbSelect from "@/components/work-item/work-item-crumb-select";
import WorkItemDetailLoading from "@/components/work-item/work-item-detail-loading";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItem from "@/hooks/queries/work-item/use-get-work-item";
import { HttpError } from "@/lib/http-error";
import {
  parseWorkItemDetailSearch,
  routes,
  type WorkItemDetailSearch,
} from "@/lib/routes";
import type { WorkItemDetailRow } from "@/types/work-item";

const WorkItemDetail = lazy(loadWorkItemDetail);

/**
 * `docs/02-design/screen-inventory.md` "Work item — full page" (P1),
 * `/agent/work-items/{key}` -- decision log "2026-09-23 · P1's UI path: new v2 work-item
 * screens on the new API". Read-only first slice: the header (state, assignee, priority,
 * due date), the description, and a details section, on `GET /api/work-items/{key}`.
 * The spec's other sections (activity and comments, relations, attachments, approvals,
 * SLA, time entries), edit/delete actions and the `?item=` side pane are separate
 * `screen-inventory.md` rows and separate slices.
 *
 * The route has existed as a registered stub since #306 (the list's row links resolve
 * here); this replaces the stub, so the URL contract does not change.
 */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/work-items/$key",
)({
  validateSearch: parseWorkItemDetailSearch,
  component: WorkItemDetailRouteComponent,
  pendingComponent: WorkItemDetailLoading,
  pendingMs: 0,
  pendingMinMs: 0,
});

function WorkItemDetailRouteComponent() {
  const { key } = Route.useParams();
  const { activity: activityFilter, comment: focusedComment } =
    Route.useSearch();
  const navigate = Route.useNavigate();
  const setActivityFilter = (filter: ActivityFilter) => {
    void navigate({
      search: (previous: WorkItemDetailSearch) => ({
        ...previous,
        activity: filter === "everything" ? undefined : filter,
        comment: undefined,
      }),
      replace: true,
    });
  };
  const { t } = useTranslation();
  // Set when a mutation answers 404 (access loss). Scoped to the key it happened on.
  const [accessLostKey, setAccessLostKey] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const onAccessLost = useCallback(() => {
    setAccessLostKey(key);
    // Drop everything cached for this item: returning to the same key must not show the
    // old row while the refetch is in flight.
    for (const scope of ["detail", "transitions", "activity", "hierarchy"]) {
      queryClient.removeQueries({ queryKey: ["work-items", scope, key] });
    }
  }, [key, queryClient]);
  useEffect(() => {
    setAccessLostKey((current) => (current === key ? current : null));
  }, [key]);

  const {
    data: cachedItem,
    isLoading,
    isError,
    error,
    refetch,
    isRealtimeUnavailable,
  } = useGetWorkItem({ key });

  // `require-work-item-reach.ts` makes "not yours" and "not there" indistinguishable on
  // purpose (a guessable `{slug}-{number}` key), so a 404 is shown as one not-found
  // state, not split into "missing" vs "no access".
  //
  // Decision log 2026-10-13: a 404 from any work-item MUTATION shows the same state, so
  // access loss mid-session is not left on a stale page. React Query keeps the last good
  // `data` next to a later `error`, so everything below reads `item`, which is withheld
  // once the item is known to be gone: the title, the project lookup and the detail view
  // must never keep rendering cached data for an item the caller can no longer see.
  const isNotFound =
    accessLostKey === key ||
    (error instanceof HttpError && error.status === 404);
  const item = isNotFound ? undefined : cachedItem;
  return (
    <>
      <PageTitle title={item?.title ? `${item.title} · ${key}` : key} />
      <div className="flex h-full min-w-0 w-full flex-1 flex-col overflow-hidden bg-background">
        <Suspense fallback={<WorkItemDetailLoading />}>
          {item ? (
            <WorkItemDetailWithProject
              item={item}
              workItemKey={key}
              activityFilter={
                focusedComment ? "everything" : (activityFilter ?? "everything")
              }
              focusedComment={focusedComment}
              onActivityFilterChange={setActivityFilter}
              isError={isError}
              onRetry={refetch}
              onAccessLost={onAccessLost}
              realtimeNotice={
                isRealtimeUnavailable ? (
                  <Alert
                    variant="warning"
                    role="status"
                    data-testid="realtime-unavailable"
                    className="m-3 w-auto"
                  >
                    <AlertDescription>
                      {t("workItems:detail.realtimeUnavailable")}
                    </AlertDescription>
                  </Alert>
                ) : undefined
              }
            />
          ) : !isNotFound && !isError ? (
            // The data query is the only reason this screen is waiting. Render
            // its light loading shape directly instead of loading/evaluating
            // the full detail module just to have it return that same shape.
            <TaskPageFrame
              header={
                <CanonicalWorkItemHeader
                  workItemKey={key}
                  onAccessLost={onAccessLost}
                />
              }
            >
              <WorkItemDetailLoading />
            </TaskPageFrame>
          ) : (
            <TaskPageFrame
              header={
                <CanonicalWorkItemHeader
                  workItemKey={key}
                  onAccessLost={onAccessLost}
                />
              }
            >
              <WorkItemDetail
                item={undefined}
                workItemKey={key}
                activityFilter={
                  focusedComment
                    ? "everything"
                    : (activityFilter ?? "everything")
                }
                focusedComment={focusedComment}
                onActivityFilterChange={setActivityFilter}
                project={undefined}
                isLoading={isLoading}
                isNotFound={isNotFound}
                isError={isError && !isNotFound}
                onRetry={refetch}
                onAccessLost={onAccessLost}
              />
            </TaskPageFrame>
          )}
        </Suspense>
      </div>
    </>
  );
}

function WorkItemDetailWithProject({
  item,
  workItemKey,
  activityFilter,
  focusedComment,
  onActivityFilterChange,
  isError,
  onRetry,
  onAccessLost,
  realtimeNotice,
}: {
  realtimeNotice?: React.ReactNode;
  item: NonNullable<ReturnType<typeof useGetWorkItem>["data"]>;
  workItemKey: string;
  activityFilter: ActivityFilter;
  focusedComment?: string;
  onActivityFilterChange: (filter: ActivityFilter) => void;
  isError: boolean;
  onRetry: () => void;
  onAccessLost: () => void;
}) {
  const { data: projects } = useGetProjects({ workspaceId: item.workspaceId });
  const project = projects?.find(
    (candidate) => candidate.id === item.projectId,
  );

  return (
    <WorkItemDetail
      item={item}
      workItemKey={workItemKey}
      activityFilter={activityFilter}
      focusedComment={focusedComment}
      onActivityFilterChange={onActivityFilterChange}
      project={project ? { name: project.name, slug: project.slug } : undefined}
      pageHeader={
        <CanonicalWorkItemHeader
          workItemKey={workItemKey}
          item={item}
          project={project}
          onAccessLost={onAccessLost}
        />
      }
      pageNotice={realtimeNotice}
      isLoading={false}
      // A known-gone item never reaches here (the route withholds it), so this view is
      // only ever the ready or the error state.
      isNotFound={false}
      isError={isError}
      onRetry={onRetry}
      onAccessLost={onAccessLost}
    />
  );
}

function CanonicalWorkItemHeader({
  workItemKey,
  item,
  project,
  onAccessLost,
}: {
  workItemKey: string;
  item?: WorkItemDetailRow;
  project?: { name: string; slug: string };
  onAccessLost: () => void;
}) {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <Layout.Header className="h-11 border-border/80 px-2">
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <SidebarTrigger
            className="-ml-1 h-7 w-7 cursor-pointer text-foreground hover:text-foreground"
            toggleLabel={t("common:a11y.toggleSidebar")}
          />
          <div className="h-4 w-px shrink-0 bg-border/80" />
          <div className="flex min-w-0 items-center gap-1.5">
            {project ? (
              <Link
                to={routes.workItemList.path}
                params={{ projectKey: project.slug }}
                className="max-w-40 truncate text-left text-xs text-foreground hover:underline"
              >
                {project.name}
              </Link>
            ) : (
              <span className="text-xs text-foreground">
                {t("navigation:sidebar.projects")}
              </span>
            )}
            <span className="text-xs text-foreground">/</span>
            {item ? (
              <WorkItemCrumbSelect
                itemKey={workItemKey}
                workspaceId={item.workspaceId}
                projectId={item.projectId}
                onSelect={(key) => {
                  void navigate({
                    to: routes.workItemDetail.path,
                    params: { key },
                    search: parseWorkItemDetailSearch({
                      activity: search.activity,
                    }),
                  });
                }}
              />
            ) : (
              <span className="truncate text-xs font-medium text-foreground">
                {workItemKey}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {item ? (
            <WorkItemActions
              item={item}
              onAccessLost={onAccessLost}
              variant="delete"
            />
          ) : null}
        </div>
      </div>
    </Layout.Header>
  );
}
