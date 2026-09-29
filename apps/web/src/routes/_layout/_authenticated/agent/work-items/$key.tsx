import { createFileRoute } from "@tanstack/react-router";
import PageTitle from "@/components/page-title";
import WorkItemDetail from "@/components/work-item/work-item-detail";
import WorkItemJourney from "@/components/work-item/work-item-journey";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItem from "@/hooks/queries/work-item/use-get-work-item";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { HttpError } from "@/lib/http-error";

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
  component: WorkItemDetailRouteComponent,
});

function WorkItemDetailRouteComponent() {
  const { key } = Route.useParams();

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

  // `require-work-item-reach.ts` makes "not yours" and "not there" indistinguishable on
  // purpose (a guessable `{slug}-{number}` key), so a 404 is shown as one not-found
  // state, not split into "missing" vs "no access".
  const isNotFound = error instanceof HttpError && error.status === 404;
  // TanStack Query retains cached data when a refetch fails. Once the server says
  // this key is missing or outside the caller's reach, stop rendering every cached
  // projection (including the journey's separately cached activity stream).
  const visibleItem = isError ? undefined : item;
  const project = visibleItem
    ? projects?.find((candidate) => candidate.id === visibleItem.projectId)
    : undefined;

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
            item={visibleItem}
            onSaved={() => {
              void refetch();
            }}
          />
        )}
      </div>
    </>
  );
}
