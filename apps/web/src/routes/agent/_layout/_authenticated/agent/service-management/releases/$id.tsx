import { createFileRoute } from "@tanstack/react-router";
import { ReleaseDetailView } from "@/components/service-management/release-detail";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/service-management/releases/$id",
)({
  component: ReleaseDetailRoute,
});

function ReleaseDetailRoute() {
  const { id } = Route.useParams();
  return <ReleaseDetailView releaseId={id} />;
}
