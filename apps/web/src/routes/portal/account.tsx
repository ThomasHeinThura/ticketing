import { createFileRoute } from "@tanstack/react-router";
import { PortalCanonicalPreferencesPage } from "@/components/account/portal-canonical-preferences";
import {
  parsePortalProjectSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/routes";

export const Route = createFileRoute("/account")({
  validateSearch: parsePortalProjectSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalAccountRoute,
});

function PortalAccountRoute() {
  const { portalUserId } = Route.useRouteContext();
  return <PortalCanonicalPreferencesPage portalUserId={portalUserId} />;
}
