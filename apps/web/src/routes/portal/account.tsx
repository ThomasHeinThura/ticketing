import { createFileRoute } from "@tanstack/react-router";
import { PortalCanonicalPreferencesPage } from "@/components/account/portal-canonical-preferences";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
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
  const { t } = usePortalTranslation("portal");
  const { portalUserId } = Route.useRouteContext();
  return (
    <>
      <PortalPageTitle title={t("navigation.settings")} />
      <PortalCanonicalPreferencesPage portalUserId={portalUserId} />
    </>
  );
}
