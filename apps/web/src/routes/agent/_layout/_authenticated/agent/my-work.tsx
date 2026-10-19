import { createFileRoute } from "@tanstack/react-router";
import { AgentMyWorkScreen } from "@/components/agent/p1-core-and-settings";
import { type AgentMyWorkSearch, parseAgentMyWorkSearch } from "@/lib/routes";

export const Route = createFileRoute("/_layout/_authenticated/agent/my-work")({
  validateSearch: parseAgentMyWorkSearch,
  component: MyWorkRouteComponent,
});

function MyWorkRouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AgentMyWorkScreen
      search={search}
      onUpdateSearch={(patch) =>
        void navigate({
          search: (prev: AgentMyWorkSearch) =>
            parseAgentMyWorkSearch({ ...prev, ...patch }),
          replace: true,
        })
      }
    />
  );
}
