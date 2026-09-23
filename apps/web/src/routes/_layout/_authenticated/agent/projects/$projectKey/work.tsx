import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import WorkItemList from "@/components/work-item/work-item-list";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItems from "@/hooks/queries/work-item/use-get-work-items";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import {
  parseWorkItemListSearch,
  type WorkItemListSearch,
  type WorkItemSortDirection,
  type WorkItemSortField,
} from "@/lib/routes";
import { sortWorkItems } from "@/lib/sort-work-items";

/**
 * `docs/02-design/screen-inventory.md` "Work — list" (P1), the first v2 work-item
 * screen -- decision log "2026-09-23 · P1's UI path: new v2 work-item screens on the new
 * API" (PR #300). Read-only: create/edit/delete are separate, later slices.
 *
 * `{projectKey}` is the project's `slug` (`work_item.key`'s own prefix,
 * `docs/01-architecture/data-model.md`), not its id -- the API has no
 * "get project by slug" route, so this resolves it client-side from the workspace's
 * project list (the same list the sidebar/nav already fetches), matching how every
 * other v1 screen in this codebase resolves a project from its slug-shaped param.
 */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/work",
)({
  validateSearch: parseWorkItemListSearch,
  component: WorkItemsRouteComponent,
});

function WorkItemsRouteComponent() {
  const { t } = useTranslation();
  const { projectKey } = Route.useParams();
  const { sort, dir } = Route.useSearch();
  const navigate = Route.useNavigate();

  const {
    data: workspace,
    isLoading: isWorkspaceLoading,
    isError: isWorkspaceError,
  } = useActiveWorkspace();

  const {
    data: projects,
    isLoading: isProjectsLoading,
    isError: isProjectsError,
    refetch: refetchProjects,
  } = useGetProjects({ workspaceId: workspace?.id ?? "" });

  const project = projects?.find((candidate) => candidate.slug === projectKey);
  const projectNotFound =
    !isWorkspaceLoading && !isProjectsLoading && !!projects && !project;

  const {
    data: workItemsResult,
    isLoading: isWorkItemsLoading,
    isError: isWorkItemsError,
    refetch: refetchWorkItems,
  } = useGetWorkItems({ projectId: project?.id });
  const workItems = workItemsResult?.items;

  const isLoading =
    isWorkspaceLoading ||
    isProjectsLoading ||
    (!!project && isWorkItemsLoading);
  const isError =
    isWorkspaceError || isProjectsError || isWorkItemsError || projectNotFound;

  function handleSortChange(
    nextSort: WorkItemSortField,
    nextDir: WorkItemSortDirection,
  ) {
    navigate({
      search: (prev: WorkItemListSearch) => ({
        ...prev,
        sort: nextSort,
        dir: nextDir,
      }),
      replace: true,
    });
  }

  function handleRetry() {
    refetchProjects();
    if (project) refetchWorkItems();
  }

  const sorted = workItems ? sortWorkItems(workItems, sort, dir) : undefined;

  return (
    <>
      <PageTitle
        title={
          project
            ? t("workItems:list.pageTitleWithProject", {
                project: project.name,
              })
            : t("workItems:list.pageTitle")
        }
      />
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
        <h1 className="font-semibold text-lg">
          {project ? project.name : projectKey} · {t("workItems:list.heading")}
        </h1>
        <WorkItemList
          workItems={sorted}
          isLoading={isLoading}
          isError={isError}
          sort={sort}
          dir={dir}
          onSortChange={handleSortChange}
          onRetry={handleRetry}
        />
      </div>
    </>
  );
}
