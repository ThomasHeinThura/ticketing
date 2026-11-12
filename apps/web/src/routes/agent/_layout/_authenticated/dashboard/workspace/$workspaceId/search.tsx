import { createFileRoute, redirect } from "@tanstack/react-router";
import { parseAgentGlobalSearch } from "@/lib/routes";

// Kaneo's workspace search address, kept so old links and bookmarks still work. The canonical
// screen is `/agent/search` (docs/screens.md); `q` and `scope` carry over.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/search",
)({
  validateSearch: parseAgentGlobalSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/agent/search", search, replace: true });
  },
});
