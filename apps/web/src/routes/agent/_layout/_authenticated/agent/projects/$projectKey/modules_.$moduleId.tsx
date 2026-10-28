import { createFileRoute } from "@tanstack/react-router";
import { ModuleDetailScreen } from "@/components/agile/module-detail";
import { parseAgileDetailSearch } from "@/lib/routes";

/** `docs/screens.md` "Project — module detail" (P5). */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/modules_/$moduleId",
)({
  validateSearch: parseAgileDetailSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const { projectKey, moduleId } = Route.useParams();
  const search = Route.useSearch();
  return (
    <ModuleDetailScreen
      projectKey={projectKey}
      moduleId={moduleId}
      search={search}
    />
  );
}
