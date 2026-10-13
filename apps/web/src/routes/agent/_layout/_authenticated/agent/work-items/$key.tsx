import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription } from "@taskdesk/ui";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import loadWorkItemDetail from "@/components/work-item/load-work-item-detail";
import type { ActivityFilter } from "@/components/work-item/work-item-activity";
import WorkItemDetailLoading from "@/components/work-item/work-item-detail-loading";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItem from "@/hooks/queries/work-item/use-get-work-item";
import { HttpError } from "@/lib/http-error";
import {
  parseWorkItemDetailSearch,
  type WorkItemDetailSearch,
} from "@/lib/routes";

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
  const { activity: activityFilter } = Route.useSearch();
  const navigate = Route.useNavigate();
  const setActivityFilter = (filter: ActivityFilter) => {
    void navigate({
      search: (previous: WorkItemDetailSearch) => ({
        ...previous,
        activity: filter === "everything" ? undefined : filter,
      }),
      replace: true,
    });
  };
  const { t } = useTranslation();
  // Set when a mutation answers 404 (access loss). Scoped to the key it happened on.
  const [accessLostKey, setAccessLostKey] = useState<string | null>(null);
  const onAccessLost = useCallback(() => setAccessLostKey(key), [key]);
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
      <div className="flex h-full flex-col gap-4 overflow-y-auto bg-background p-6">
        {item && isRealtimeUnavailable && (
          <Alert
            variant="warning"
            role="status"
            data-testid="realtime-unavailable"
          >
            <AlertDescription>
              {t("workItems:detail.realtimeUnavailable")}
            </AlertDescription>
          </Alert>
        )}
        <Suspense fallback={<WorkItemDetailLoading />}>
          {item ? (
            <WorkItemDetailWithProject
              item={item}
              workItemKey={key}
              activityFilter={activityFilter ?? "everything"}
              onActivityFilterChange={setActivityFilter}
              isError={isError}
              onRetry={refetch}
              onAccessLost={onAccessLost}
            />
          ) : !isNotFound && !isError ? (
            // The data query is the only reason this screen is waiting. Render
            // its light loading shape directly instead of loading/evaluating
            // the full detail module just to have it return that same shape.
            <WorkItemDetailLoading />
          ) : (
            <WorkItemDetail
              item={undefined}
              workItemKey={key}
              activityFilter={activityFilter ?? "everything"}
              onActivityFilterChange={setActivityFilter}
              project={undefined}
              isLoading={isLoading}
              isNotFound={isNotFound}
              isError={isError && !isNotFound}
              onRetry={refetch}
              onAccessLost={onAccessLost}
            />
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
  onActivityFilterChange,
  isError,
  onRetry,
  onAccessLost,
}: {
  item: NonNullable<ReturnType<typeof useGetWorkItem>["data"]>;
  workItemKey: string;
  activityFilter: ActivityFilter;
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
      onActivityFilterChange={onActivityFilterChange}
      project={project ? { name: project.name, slug: project.slug } : undefined}
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
