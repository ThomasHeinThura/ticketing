import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Skeleton } from "@taskdesk/ui";
import { useCallback } from "react";
import { ProjectFeatureOff } from "@/components/agile/feature-off";
import ProjectNotFound from "@/components/project/project-not-found";
import ProjectTimeline, {
  type ProjectTimelineSearch,
} from "@/components/project/project-timeline";
import useProjectByKey from "@/hooks/queries/agile/use-project-by-key";
import { useProjectFeatureState } from "@/hooks/queries/feature-flag/use-project-pages-feature";
import { parseProjectBoardSearch } from "@/lib/project-board-search";

/**
 * S3: the project's Timeline tab (Kaneo's Gantt) inside the canonical project frame, which
 * supplies the project header and tab strip. It renders only while `feature.timeline` is on
 * for the project (P4R1-M2); the old `/dashboard/.../gantt` link renders the same view.
 */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/timeline",
)({
  component: RouteComponent,
  validateSearch: parseProjectBoardSearch,
});

function LoadingState() {
  return (
    <div className="p-4">
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function RouteComponent() {
  const { projectKey } = Route.useParams();
  const { project, isLoading } = useProjectByKey(projectKey);
  const timelineOn = useProjectFeatureState(project?.id, "feature.timeline");
  if (!project) return isLoading ? <LoadingState /> : <ProjectNotFound />;
  if (timelineOn === undefined) return <LoadingState />;
  if (!timelineOn)
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <ProjectFeatureOff
          feature="timeline"
          headingLevel={1}
          projectKey={projectKey}
        />
      </div>
    );
  return (
    <CanonicalProjectTimeline
      projectKey={projectKey}
      workspaceId={project.workspaceId}
      projectId={project.id}
    />
  );
}

function CanonicalProjectTimeline({
  projectKey,
  workspaceId,
  projectId,
}: {
  projectKey: string;
  workspaceId: string;
  projectId: string;
}) {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const handleSearchChange = useCallback(
    (update: (previous: ProjectTimelineSearch) => ProjectTimelineSearch) => {
      void navigate({
        to: "/agent/projects/$projectKey/timeline",
        params: { projectKey },
        search: update,
        replace: true,
      });
    },
    [navigate, projectKey],
  );
  return (
    <ProjectTimeline
      workspaceId={workspaceId}
      projectId={projectId}
      search={search}
      onSearchChange={handleSearchChange}
    />
  );
}
