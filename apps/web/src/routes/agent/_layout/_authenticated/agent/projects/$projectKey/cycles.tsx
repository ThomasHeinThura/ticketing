import { createFileRoute } from "@tanstack/react-router";
import { CyclesList } from "@/components/agile/cycles-list";

/** `docs/screens.md` "Project — cycles" (P5, `feature.cycles`). */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/cycles",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectKey } = Route.useParams();
  return <CyclesList projectKey={projectKey} />;
}
