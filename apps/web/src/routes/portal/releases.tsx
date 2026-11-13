import { createFileRoute } from "@tanstack/react-router";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
import { PortalReleasesList } from "@/components/service-management/portal/portal-releases-list";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import {
  parsePortalReleasesSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/portal-route-search";

export const Route = createFileRoute("/releases")({
  validateSearch: parsePortalReleasesSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: Releases,
});

function Releases() {
  const { t } = usePortalTranslation("portal");
  const { cursor } = Route.useSearch();
  const { portalUserId } = Route.useRouteContext();
  return (
    <>
      <PortalPageTitle title={t("releases.title")} />
      <PortalReleasesList scope={portalUserId} cursor={cursor} />
    </>
  );
}
