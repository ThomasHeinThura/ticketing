import { createFileRoute, useNavigate } from "@tanstack/react-router";
import NotificationInbox from "@/components/notification/notification-inbox";
import { parseAgentInboxSearch } from "@/lib/routes";

export const Route = createFileRoute("/_layout/_authenticated/agent/inbox")({
  validateSearch: parseAgentInboxSearch,
  component: AgentInboxRoute,
});

function AgentInboxRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <NotificationInbox
      filter={search.filter ?? "all"}
      onFilterChange={(next) =>
        void navigate({
          search: next === "all" ? {} : { filter: next },
          replace: true,
        })
      }
    />
  );
}
