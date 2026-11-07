import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import ProjectLayout from "@/components/common/project-layout";
import ProjectViewFeatureGate from "@/components/common/project-view-feature-gate";
import ProjectTimeline, {
  type ProjectTimelineSearch,
} from "@/components/project/project-timeline";
import { parseProjectBoardSearch } from "@/lib/project-board-search";
import { PROJECT_GANTT_PATH } from "@/lib/routes";

/**
 * Kaneo's Gantt URL, kept so old links and bookmarks still open the project Timeline. The
 * canonical screen is `/agent/projects/{key}/timeline`; both render the same view.
 */
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/gantt",
)({
  component: GatedRouteComponent,
  validateSearch: parseProjectBoardSearch,
});

/** P4R1-M2: the view renders only while its feature flag is on for the project. */
function GatedRouteComponent() {
  const { projectId, workspaceId } = Route.useParams();
  return (
    <ProjectViewFeatureGate
      projectId={projectId}
      workspaceId={workspaceId}
      view="gantt"
    >
      <RouteComponent />
    </ProjectViewFeatureGate>
  );
}

function RouteComponent() {
  const { projectId, workspaceId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const handleSearchChange = useCallback(
    (update: (previous: ProjectTimelineSearch) => ProjectTimelineSearch) => {
      void navigate({
        to: PROJECT_GANTT_PATH,
        params: { workspaceId, projectId },
        search: update,
        replace: true,
      });
    },
    [navigate, projectId, workspaceId],
  );
  return (
    <ProjectLayout
      realtimeMode="canonical"
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="gantt"
    >
      <ProjectTimeline
        workspaceId={workspaceId}
        projectId={projectId}
        search={search}
        onSearchChange={handleSearchChange}
      />
    </ProjectLayout>
  );
}
