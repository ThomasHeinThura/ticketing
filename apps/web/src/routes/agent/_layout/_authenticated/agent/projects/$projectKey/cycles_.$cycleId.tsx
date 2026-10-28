import { createFileRoute } from "@tanstack/react-router";
import { CycleDetailScreen } from "@/components/agile/cycle-detail";
import { parseAgileDetailSearch } from "@/lib/routes";

/** `docs/screens.md` "Project — cycle detail" (P5): burndown above the project's board or list. */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/cycles_/$cycleId",
)({
  validateSearch: parseAgileDetailSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const { projectKey, cycleId } = Route.useParams();
  const search = Route.useSearch();
  return (
    <CycleDetailScreen
      projectKey={projectKey}
      cycleId={cycleId}
      search={search}
    />
  );
}
