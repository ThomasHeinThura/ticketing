import { createFileRoute } from "@tanstack/react-router";
import LegacyProjectView from "@/components/common/legacy-project-view";
import { parseLegacyProjectViewSearch } from "@/lib/parse-legacy-project-view-search";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/board",
)({
  validateSearch: parseLegacyProjectViewSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const { projectId, workspaceId } = Route.useParams();
  return (
    <LegacyProjectView
      projectId={projectId}
      workspaceId={workspaceId}
      view="board"
    />
  );
}
