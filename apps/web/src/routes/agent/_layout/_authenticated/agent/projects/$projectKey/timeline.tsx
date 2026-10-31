import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Skeleton } from "@taskdesk/ui";
import useProjectByKey from "@/hooks/queries/agile/use-project-by-key";

/**
 * S3: the project's Timeline tab is the existing Kaneo Gantt (gated there by
 * `feature.timeline`). This canonical link resolves the project and opens it.
 */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/timeline",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectKey } = Route.useParams();
  const { project, isLoading } = useProjectByKey(projectKey);
  if (!project)
    return isLoading ? (
      <div className="p-4">
        <Skeleton className="h-10 w-full" />
      </div>
    ) : (
      <Navigate to="/agent" replace />
    );
  return (
    <Navigate
      to="/dashboard/workspace/$workspaceId/project/$projectId/gantt"
      params={{ workspaceId: project.workspaceId, projectId: project.id }}
      replace
    />
  );
}
