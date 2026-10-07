import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription } from "@taskdesk/ui";
import { lazy, Suspense } from "react";
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
 * `/agent/work-items/{key}` -- the header/details use `GET /api/work-items/{key}`;
 * the combined activity/comment section uses its native cursor-paginated endpoint.
 * Relations, attachments, SLA, time entries, and the `?item=` side pane remain separate
 * slices. Comment editing is server-authorized through the native comment route.
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

  const {
    data: item,
    isLoading,
    isError,
    error,
    refetch,
    isRealtimeUnavailable,
  } = useGetWorkItem({ key });

  // `require-work-item-reach.ts` makes "not yours" and "not there" indistinguishable on
  // purpose (a guessable `{slug}-{number}` key), so a 404 is shown as one not-found
  // state, not split into "missing" vs "no access".
  const isNotFound = error instanceof HttpError && error.status === 404;
  return (
    <>
      <PageTitle title={item?.title ? `${item.title} · ${key}` : key} />
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
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
              isNotFound={isNotFound}
              isError={isError && !isNotFound}
              onRetry={refetch}
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
  isNotFound,
  isError,
  onRetry,
}: {
  item: NonNullable<ReturnType<typeof useGetWorkItem>["data"]>;
  workItemKey: string;
  activityFilter: ActivityFilter;
  onActivityFilterChange: (filter: ActivityFilter) => void;
  isNotFound: boolean;
  isError: boolean;
  onRetry: () => void;
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
      isNotFound={isNotFound}
      isError={isError}
      onRetry={onRetry}
    />
  );
}
