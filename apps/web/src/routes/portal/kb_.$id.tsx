import { createFileRoute } from "@tanstack/react-router";
import { PortalKbArticleView } from "@/components/kb/portal/portal-kb-article";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import {
  parsePortalProjectSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/portal-route-search";

/** `docs/screens.md` portal "Article" (P5): the published version and a helpfulness prompt. */
export const Route = createFileRoute("/kb_/$id")({
  validateSearch: parsePortalProjectSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalKbArticle,
});

function PortalKbArticle() {
  const { t } = usePortalTranslation("portal");
  const { id } = Route.useParams();
  const { portalUserId } = Route.useRouteContext();
  return (
    <>
      <PortalPageTitle title={t("navigation.knowledgeBase")} />
      <PortalKbArticleView id={id} scope={portalUserId} />
    </>
  );
}
