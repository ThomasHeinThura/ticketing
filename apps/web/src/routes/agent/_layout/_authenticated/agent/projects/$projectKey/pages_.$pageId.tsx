import { createFileRoute } from "@tanstack/react-router";
import { PageDetail } from "@/components/pages/page-detail";
import { PagesFeatureGate } from "@/components/pages/pages-feature-gate";

/** `docs/screens.md` "Page view and editor" (P5, `PG-3`..`PG-5`). */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/pages_/$pageId",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectKey, pageId } = Route.useParams();
  return (
    <PagesFeatureGate projectKey={projectKey}>
      <PageDetail projectKey={projectKey} pageId={pageId} />
    </PagesFeatureGate>
  );
}
