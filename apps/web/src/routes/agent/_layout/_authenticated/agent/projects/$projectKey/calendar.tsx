import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Skeleton } from "@taskdesk/ui";
import { useCallback } from "react";
import ProjectCalendarView from "@/components/calendar/project-calendar-view";
import ProjectViewFeatureGate from "@/components/common/project-view-feature-gate";
import WorkspaceLayout from "@/components/common/workspace-layout";
import ProjectNotFound from "@/components/project/project-not-found";
import useProjectByKey from "@/hooks/queries/agile/use-project-by-key";
import {
  type ProjectCalendarSearch,
  parseProjectCalendarSearch,
} from "@/lib/project-board-search";

/**
 * The project's Calendar tab (Kaneo's calendar) at its canonical `/agent` address. It renders only
 * while `feature.calendar` is on for the project (P4R1-M2). The screen keeps its own project
 * header, because the search field sits in it, so the agent shell hands this path no frame.
 * Kaneo's `/dashboard/workspace/{id}/project/{id}/calendar` link redirects here when the project
 * belongs to the active workspace and resolves to the same canonical key.
 */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/calendar",
)({
  component: GatedRouteComponent,
  validateSearch: parseProjectCalendarSearch,
});

/** P4R1-M2: the view renders only while its feature flag is on for the project. */
function GatedRouteComponent() {
  const { projectKey } = Route.useParams();
  const { project, isLoading } = useProjectByKey(projectKey);
  if (!project)
    return (
      <WorkspaceLayout title={projectKey}>
        {isLoading ? (
          <div className="p-4">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <ProjectNotFound />
        )}
      </WorkspaceLayout>
    );
  return (
    <ProjectViewFeatureGate
      projectId={project.id}
      projectKey={projectKey}
      workspaceId={project.workspaceId}
      view="calendar"
    >
      <RouteComponent
        projectKey={projectKey}
        projectId={project.id}
        workspaceId={project.workspaceId}
      />
    </ProjectViewFeatureGate>
  );
}

function RouteComponent({
  projectKey,
  projectId,
  workspaceId,
}: {
  projectKey: string;
  projectId: string;
  workspaceId: string;
}) {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const handleSearchChange = useCallback(
    (
      update: (previous: ProjectCalendarSearch) => ProjectCalendarSearch,
      options?: { replace?: boolean },
    ) => {
      void navigate({
        to: "/agent/projects/$projectKey/calendar",
        params: { projectKey },
        search: update,
        replace: options?.replace,
      });
    },
    [navigate, projectKey],
  );
  return (
    <ProjectCalendarView
      projectKey={projectKey}
      projectId={projectId}
      workspaceId={workspaceId}
      search={search}
      onSearchChange={handleSearchChange}
    />
  );
}
