import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AgentInboxScreen } from "@/components/agent/p1-core-and-settings";
import { parseAgentInboxSearch } from "@/lib/routes";

export const Route = createFileRoute("/_layout/_authenticated/agent/inbox")({
  validateSearch: parseAgentInboxSearch,
  component: AgentInboxRoute,
});

function AgentInboxRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <AgentInboxScreen
      filter={search.filter ?? "all"}
      onFilterChange={(next) =>
        void navigate({
          search: next === "unread" ? { filter: "unread" } : {},
          replace: true,
        })
      }
    />
  );
}
