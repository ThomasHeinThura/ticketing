import { createFileRoute } from "@tanstack/react-router";
import { PageDetail } from "@/components/pages/page-detail";

/** `docs/screens.md` "Page view and editor" (P5, `PG-3`..`PG-5`). */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/pages_/$pageId",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectKey, pageId } = Route.useParams();
  return <PageDetail projectKey={projectKey} pageId={pageId} />;
}
