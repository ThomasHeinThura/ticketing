import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceMembersRedirect } from "@/components/agent/kaneo-redirects";

// The real members screen is kaneo's /dashboard/workspace/{id}/members.
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/members",
)({
  component: WorkspaceMembersRedirect,
});
