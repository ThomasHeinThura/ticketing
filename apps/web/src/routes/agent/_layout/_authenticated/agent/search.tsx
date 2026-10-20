import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceSearchRedirect } from "@/components/agent/kaneo-redirects";

// The real search screen is kaneo's /dashboard/workspace/{id}/search.
export const Route = createFileRoute("/_layout/_authenticated/agent/search")({
  component: WorkspaceSearchRedirect,
});
