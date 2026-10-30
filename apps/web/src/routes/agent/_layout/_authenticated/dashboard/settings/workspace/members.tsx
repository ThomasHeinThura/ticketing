import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceMembersRedirect } from "@/components/agent/kaneo-redirects";

// Workspace members stay on Kaneo's /dashboard/workspace/{id}/members, which needs the active
// workspace; this settings URL (and the old /agent/settings/members) sends the user there.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/members",
)({
  component: WorkspaceMembersRedirect,
});
