import { createFileRoute } from "@tanstack/react-router";
import { PortalCanonicalPreferencesPage } from "@/components/account/portal-canonical-preferences";

export const Route = createFileRoute("/account")({
  component: PortalAccountRoute,
});

function PortalAccountRoute() {
  const { portalUserId } = Route.useRouteContext();
  return <PortalCanonicalPreferencesPage portalUserId={portalUserId} />;
}
