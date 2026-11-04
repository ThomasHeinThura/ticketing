import { createFileRoute } from "@tanstack/react-router";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
import { PortalReleaseDetail } from "@/components/service-management/portal/portal-release-detail";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
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
  const { t } = usePortalTranslation("portal");
  const { id } = Route.useParams();
  const { portalUserId } = Route.useRouteContext();
  return (
    <>
      <PortalPageTitle title={t("releases.title")} />
      <PortalReleaseDetail id={id} scope={portalUserId} />
    </>
  );
}
