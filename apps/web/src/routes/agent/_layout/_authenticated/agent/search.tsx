import { createFileRoute } from "@tanstack/react-router";
import { AgentGlobalSearchScreen } from "@/components/agent/p1-core-and-settings";
import { type AgentGlobalSearch, parseAgentGlobalSearch } from "@/lib/routes";

export const Route = createFileRoute("/_layout/_authenticated/agent/search")({
  validateSearch: parseAgentGlobalSearch,
  component: GlobalSearchRouteComponent,
});

function GlobalSearchRouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AgentGlobalSearchScreen
      search={search}
      onUpdateSearch={(patch) =>
        void navigate({
          search: (prev: AgentGlobalSearch) =>
            parseAgentGlobalSearch({ ...prev, ...patch }),
          replace: true,
        })
      }
    />
  );
}
