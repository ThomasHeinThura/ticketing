import { createFileRoute } from "@tanstack/react-router";
import { PortalKbBrowse } from "@/components/kb/portal/portal-kb-browse";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import {
  parsePortalKbSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/portal-route-search";

/** `docs/screens.md` portal "Knowledge base" (P5, `KB-*`): search and browse by category. */
export const Route = createFileRoute("/kb")({
  validateSearch: parsePortalKbSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalKb,
});

function PortalKb() {
  const { t } = usePortalTranslation("portal");
  const search = Route.useSearch();
  const { portalUserId } = Route.useRouteContext();
  return (
    <>
      <PortalPageTitle title={t("navigation.knowledgeBase")} />
      <PortalKbBrowse search={search} scope={portalUserId} />
    </>
  );
}
