import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceSearchRedirect } from "@/components/agent/kaneo-redirects";
import { parseAgentGlobalSearch } from "@/lib/routes";

// The real search screen is kaneo's /dashboard/workspace/{id}/search; `q` and `scope` ride along
// so an old or shared /agent/search?q=... link lands on the same search.
export const Route = createFileRoute("/_layout/_authenticated/agent/search")({
  validateSearch: parseAgentGlobalSearch,
  component: AgentSearchRoute,
});

function AgentSearchRoute() {
  return <WorkspaceSearchRedirect search={Route.useSearch()} />;
}
