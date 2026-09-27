import { createFileRoute } from "@tanstack/react-router";
import PageTitle from "@/components/page-title";
import WorkItemDetail from "@/components/work-item/work-item-detail";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItem from "@/hooks/queries/work-item/use-get-work-item";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { HttpError } from "@/lib/http-error";

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
  const project = item
    ? projects?.find((candidate) => candidate.id === item.projectId)
    : undefined;

  return (
    <>
      <PageTitle title={item?.title ? `${item.title} · ${key}` : key} />
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
        <WorkItemDetail
          item={item}
          workItemKey={key}
          project={
            project ? { name: project.name, slug: project.slug } : undefined
          }
          isLoading={isLoading}
          isNotFound={isNotFound}
          isError={isError && !isNotFound}
          onRetry={refetch}
        />
      </div>
    </>
  );
}
