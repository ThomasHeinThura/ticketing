import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { Skeleton } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import WorkspaceSearch from "@/components/search/workspace-search";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { parseAgentGlobalSearch } from "@/lib/routes";

// /agent/search is the canonical search address (docs/screens.md). It shows Kaneo's workspace
// search body for the active workspace inside the agent shell, which already supplies the
// WorkspaceLayout and its "Search" title. `q` and `scope` stay in this URL.
export const Route = createFileRoute("/_layout/_authenticated/agent/search")({
  validateSearch: parseAgentGlobalSearch,
  component: AgentSearchRoute,
});

function AgentSearchRoute() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { data: workspace, isLoading } = useActiveWorkspace();
  if (!workspace)
    return isLoading ? (
      <div className="p-4">
        <Skeleton className="h-10 w-full" />
      </div>
    ) : (
      // /agent home resolves the first workspace or sends the user to onboarding.
      <Navigate to="/agent" replace />
    );
  return (
    <>
      <PageTitle title={t("workspace:search.pageTitle")} />
      <WorkspaceSearch
        key={workspace.id}
        workspaceId={workspace.id}
        search={search}
        onSearchChange={(next) =>
          void navigate({ to: "/agent/search", search: next, replace: true })
        }
      />
    </>
  );
}
