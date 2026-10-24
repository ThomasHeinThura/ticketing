import { createFileRoute } from "@tanstack/react-router";
import { PortalKbBrowse } from "@/components/kb/portal/portal-kb-browse";
import { parsePortalKbSearch } from "@/lib/routes";

/** `docs/screens.md` portal "Knowledge base" (P5, `KB-*`): search and browse by category. */
export const Route = createFileRoute("/kb")({
  validateSearch: parsePortalKbSearch,
  component: PortalKb,
});

function PortalKb() {
  const search = Route.useSearch();
  const { portalUserId } = Route.useRouteContext();
  return <PortalKbBrowse search={search} scope={portalUserId} />;
}
