import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription } from "@taskdesk/ui";
import { lazy, Suspense, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import loadWorkItemDetail from "@/components/work-item/load-work-item-detail";
import FullWorkItemDetail from "@/components/work-item/work-item-detail";
import WorkItemDetailLoading from "@/components/work-item/work-item-detail-loading";
import WorkItemJourney from "@/components/work-item/work-item-journey";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItem from "@/hooks/queries/work-item/use-get-work-item";
import { HttpError } from "@/lib/http-error";
import {
  parseWorkItemDetailSearch,
  type WorkItemActivityFilter,
} from "@/lib/routes";

const WorkItemDetail = lazy(loadWorkItemDetail);

/**
 * `docs/02-design/screen-inventory.md` "Work item — full page" (P1),
 * `/agent/work-items/{key}` -- decision log "2026-09-23 · P1's UI path: new v2 work-item
 * screens on the new API". The detail view reads `GET /api/work-items/{key}` and the
 * supported P1 journey adds capability-gated edits, assignment, and the staff activity
 * stream.
 *
 * The route has existed as a registered stub since #306 (the list's row links resolve
 * here); this replaces the stub, so the URL contract does not change.
 */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/work-items/$key",
)({
  validateSearch: (search) => parseWorkItemDetailSearch(search),
  component: WorkItemDetailRouteComponent,
  pendingComponent: WorkItemDetailLoading,
  pendingMs: 0,
  pendingMinMs: 0,
});

function WorkItemDetailRouteComponent() {
  const { key } = Route.useParams();
  const { activity: searchActivity, previewAttachment } = Route.useSearch();
  const activity: WorkItemActivityFilter = searchActivity ?? "all";
  const navigate = Route.useNavigate();
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
  // Hide every cached projection only after the authoritative reach/missing 404.
  // A transient network or server error keeps still-authorized cached content visible
  // with a retry notice in WorkItemDetail.
  const visibleItem = isNotFound ? undefined : item;

  useLayoutEffect(() => {
    if (!visibleItem && !isError && !isNotFound) {
      performance.clearMarks("taskdesk:work-item-detail:skeleton-mounted");
      performance.clearMarks("taskdesk:work-item-detail:content-mounted");
      performance.mark("taskdesk:work-item-detail:skeleton-mounted");
    } else if (visibleItem) {
      performance.mark("taskdesk:work-item-detail:content-mounted");
    }
  }, [isError, isNotFound, visibleItem]);

  const projectDetails = useGetProject({
    id: visibleItem?.projectId ?? "",
    workspaceId: visibleItem?.workspaceId ?? "",
  });

  return (
    <>
      <PageTitle
        title={visibleItem?.title ? `${visibleItem.title} · ${key}` : key}
      />
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
        {visibleItem && isRealtimeUnavailable && (
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
          {visibleItem ? (
            <WorkItemDetailWithProject
              item={visibleItem}
              workItemKey={key}
              isNotFound={false}
              isError={isError && !isNotFound}
              onRetry={refetch}
              previewAttachmentId={previewAttachment}
              onPreviewAttachment={(id) => {
                void navigate({
                  search: {
                    activity: searchActivity,
                    previewAttachment: id ?? undefined,
                  },
                });
              }}
            />
          ) : !isNotFound && !isError ? (
            <WorkItemDetailLoading />
          ) : (
            <FullWorkItemDetail
              item={undefined}
              workItemKey={key}
              project={undefined}
              isLoading={isLoading}
              isNotFound={isNotFound}
              isError={isError && !isNotFound}
              onRetry={refetch}
            />
          )}
        </Suspense>
        {visibleItem && (
          <WorkItemJourney
            key={visibleItem.key}
            item={visibleItem}
            activityFilter={activity}
            defaultCommentVisibility={
              projectDetails.data?.defaultCommentVisibility ?? "internal"
            }
            commentVisibilityReady={projectDetails.data !== undefined}
            onActivityFilterChange={(nextFilter) => {
              void navigate({
                search: {
                  activity: nextFilter === "all" ? undefined : nextFilter,
                  previewAttachment,
                },
              });
            }}
            onSaved={() => {
              void refetch();
            }}
          />
        )}
      </div>
    </>
  );
}

function WorkItemDetailWithProject({
  item,
  workItemKey,
  isNotFound,
  isError,
  onRetry,
  previewAttachmentId,
  onPreviewAttachment,
}: {
  item: NonNullable<ReturnType<typeof useGetWorkItem>["data"]>;
  workItemKey: string;
  isNotFound: boolean;
  isError: boolean;
  onRetry: () => void;
  previewAttachmentId?: string;
  onPreviewAttachment: (id: string | null) => void;
}) {
  const { data: projects } = useGetProjects({ workspaceId: item.workspaceId });
  const project = projects?.find(
    (candidate) => candidate.id === item.projectId,
  );

  return (
    <WorkItemDetail
      item={item}
      workItemKey={workItemKey}
      project={project ? { name: project.name, slug: project.slug } : undefined}
      isLoading={false}
      isNotFound={isNotFound}
      isError={isError}
      onRetry={onRetry}
      previewAttachmentId={previewAttachmentId}
      onPreviewAttachment={onPreviewAttachment}
    />
  );
}
