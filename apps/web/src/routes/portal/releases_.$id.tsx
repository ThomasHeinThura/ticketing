import { createFileRoute } from "@tanstack/react-router";
import { PortalReleaseDetail } from "@/components/service-management/portal/portal-release-detail";
import {
  parsePortalProjectSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/routes";

export const Route = createFileRoute("/releases_/$id")({
  validateSearch: parsePortalProjectSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: Release,
});

function Release() {
  const { id } = Route.useParams();
  const { portalUserId } = Route.useRouteContext();
  return <PortalReleaseDetail id={id} scope={portalUserId} />;
}
