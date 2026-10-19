import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { WorkspaceCannedResponsesSettingsScreen } from "@/components/agent/p1-core-and-settings";
import { parseSettingsTextFilterSearch } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/canned-responses",
)({
  validateSearch: parseSettingsTextFilterSearch,
  component: WorkspaceCannedResponsesRoute,
});

function WorkspaceCannedResponsesRoute() {
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <WorkspaceCannedResponsesSettingsScreen
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
