import { createFileRoute, redirect } from "@tanstack/react-router";
import { routes } from "@/lib/routes";

// The role editor moved to `/agent/settings/roles` (P4 RL). The old path keeps working for
// bookmarks and links.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/roles",
)({
  beforeLoad: () => {
    throw redirect({ to: routes.workspaceRoles.path, replace: true });
  },
});
