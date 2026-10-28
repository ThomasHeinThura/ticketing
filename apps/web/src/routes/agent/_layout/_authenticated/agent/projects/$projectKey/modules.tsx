import { createFileRoute } from "@tanstack/react-router";
import { ModulesList } from "@/components/agile/modules-list";

/** `docs/screens.md` "Project — modules" (P5, `feature.modules`). */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/modules",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectKey } = Route.useParams();
  return <ModulesList projectKey={projectKey} />;
}
