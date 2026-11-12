import { createFileRoute, useNavigate } from "@tanstack/react-router";
import NotificationInbox from "@/components/notification/notification-inbox";
import { notificationInboxOptions } from "@/hooks/queries/notification/use-get-notifications";
import { type AgentInboxFilter, parseAgentInboxSearch } from "@/lib/routes";

export const Route = createFileRoute("/_layout/_authenticated/agent/inbox")({
  validateSearch: parseAgentInboxSearch,
  loaderDeps: ({ search }): { filter: AgentInboxFilter } => ({
    filter: search.filter ?? "all",
  }),
  loader: ({ context, deps, cause }) => {
    if (cause === "enter")
      void context.queryClient.prefetchInfiniteQuery(
        notificationInboxOptions(deps.filter),
      );
  },
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
