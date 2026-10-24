import { createFileRoute } from "@tanstack/react-router";
import { PortalKbArticleView } from "@/components/kb/portal/portal-kb-article";

/** `docs/screens.md` portal "Article" (P5): the published version and a helpfulness prompt. */
export const Route = createFileRoute("/kb_/$id")({
  component: PortalKbArticle,
});

function PortalKbArticle() {
  const { id } = Route.useParams();
  const { portalUserId } = Route.useRouteContext();
  return <PortalKbArticleView id={id} scope={portalUserId} />;
}
