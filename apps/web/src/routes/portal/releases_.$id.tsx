import { createFileRoute } from "@tanstack/react-router";
import { PortalReleaseDetail } from "@/components/service-management/portal/portal-release-detail";

export const Route = createFileRoute("/releases_/$id")({
  component: Release,
});

function Release() {
  const { id } = Route.useParams();
  const { portalUserId } = Route.useRouteContext();
  return <PortalReleaseDetail id={id} scope={portalUserId} />;
}
