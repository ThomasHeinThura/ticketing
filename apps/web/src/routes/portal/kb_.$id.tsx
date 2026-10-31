import { createFileRoute } from "@tanstack/react-router";
import { PortalKbArticleView } from "@/components/kb/portal/portal-kb-article";
import {
  parsePortalProjectSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/routes";

/** `docs/screens.md` portal "Article" (P5): the published version and a helpfulness prompt. */
export const Route = createFileRoute("/kb_/$id")({
  validateSearch: parsePortalProjectSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalKbArticle,
});

function PortalKbArticle() {
  const { id } = Route.useParams();
  const { portalUserId } = Route.useRouteContext();
  return <PortalKbArticleView id={id} scope={portalUserId} />;
}
