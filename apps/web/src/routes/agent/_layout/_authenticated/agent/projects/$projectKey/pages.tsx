import { createFileRoute } from "@tanstack/react-router";
import { PagesFeatureGate } from "@/components/pages/pages-feature-gate";
import { PagesList } from "@/components/pages/pages-list";

/** `docs/screens.md` "Pages" (P5, `PG-1`): the project's staff-only page tree. */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/pages",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectKey } = Route.useParams();
  return (
    <PagesFeatureGate projectKey={projectKey}>
      <PagesList projectKey={projectKey} />
    </PagesFeatureGate>
  );
}
