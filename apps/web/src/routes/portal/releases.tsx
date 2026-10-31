import { createFileRoute } from "@tanstack/react-router";
import { PortalReleasesList } from "@/components/service-management/portal/portal-releases-list";
import {
  parsePortalReleasesSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/routes";

export const Route = createFileRoute("/releases")({
  validateSearch: parsePortalReleasesSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: Releases,
});

function Releases() {
  const { cursor } = Route.useSearch();
  const { portalUserId } = Route.useRouteContext();
  return <PortalReleasesList scope={portalUserId} cursor={cursor} />;
}
