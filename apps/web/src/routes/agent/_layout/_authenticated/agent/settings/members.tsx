import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { WorkspaceMembersSettingsScreen } from "@/components/agent/p1-core-and-settings";
import { parseSettingsTextFilterSearch } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/members",
)({
  validateSearch: parseSettingsTextFilterSearch,
  component: WorkspaceMembersRoute,
});

function WorkspaceMembersRoute() {
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <WorkspaceMembersSettingsScreen
      query={q}
      onQueryChange={(next) =>
        void navigate({
          search: next ? { q: next } : {},
          replace: true,
        })
      }
    />
  );
}
