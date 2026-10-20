import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceSearchRedirect } from "@/components/agent/kaneo-redirects";
import { parseAgentGlobalSearch } from "@/lib/routes";

// The real search screen is kaneo's /dashboard/workspace/{id}/search.
export const Route = createFileRoute("/_layout/_authenticated/agent/search")({
  validateSearch: parseAgentGlobalSearch,
  component: WorkspaceSearchRedirect,
});
