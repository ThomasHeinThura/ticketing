import { createFileRoute } from "@tanstack/react-router";
import { useLayoutEffect } from "react";
import PageTitle from "@/components/page-title";
import WorkItemDetail from "@/components/work-item/work-item-detail";
import WorkItemJourney from "@/components/work-item/work-item-journey";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItem from "@/hooks/queries/work-item/use-get-work-item";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { HttpError } from "@/lib/http-error";
import {
  parseWorkItemActivityFilter,
  type WorkItemActivityFilter,
} from "@/lib/routes";

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
  validateSearch: (search) => ({
    activity:
      search.activity === undefined
        ? undefined
        : parseWorkItemActivityFilter(search.activity),
  }),
  component: WorkItemDetailRouteComponent,
});

function WorkItemDetailRouteComponent() {
  const { key } = Route.useParams();
  const { activity: searchActivity } = Route.useSearch();
  const activity: WorkItemActivityFilter = searchActivity ?? "all";
  const navigate = Route.useNavigate();

  const { data: workspace } = useActiveWorkspace();
  const { data: projects } = useGetProjects({
    workspaceId: workspace?.id ?? "",
  });
  const {
    data: item,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetWorkItem({ key });

  useLayoutEffect(() => {
    if (isLoading && !item) {
      performance.clearMarks("taskdesk:work-item-detail:skeleton-mounted");
      performance.clearMarks("taskdesk:work-item-detail:content-mounted");
      performance.mark("taskdesk:work-item-detail:skeleton-mounted");
    } else if (item) {
      performance.mark("taskdesk:work-item-detail:content-mounted");
    }
  }, [isLoading, item]);

  // `require-work-item-reach.ts` makes "not yours" and "not there" indistinguishable on
  // purpose (a guessable `{slug}-{number}` key), so a 404 is shown as one not-found
  // state, not split into "missing" vs "no access".
  const isNotFound = error instanceof HttpError && error.status === 404;
  // Hide every cached projection only after the authoritative reach/missing 404.
  // A transient network or server error keeps still-authorized cached content visible
  // with a retry notice in WorkItemDetail.
  const visibleItem = isNotFound ? undefined : item;
  const project = visibleItem
    ? projects?.find((candidate) => candidate.id === visibleItem.projectId)
    : undefined;
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
        <WorkItemDetail
          item={visibleItem}
          workItemKey={key}
          project={
            project ? { name: project.name, slug: project.slug } : undefined
          }
          isLoading={isLoading}
          isNotFound={isNotFound}
          isError={isError && !isNotFound}
          onRetry={refetch}
        />
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
