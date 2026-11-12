import {
  createFileRoute,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import { ErrorDisplay } from "@/components/errors/error-display";
import PageTitle from "@/components/page-title";
import WorkspaceSearch from "@/components/search/workspace-search";
import useGetWorkspaces from "@/hooks/queries/workspace/use-get-workspaces";
import { authClient } from "@/lib/auth-client";
import { withLocationSuffix } from "@/lib/legacy-project-view";
import { parseAgentGlobalSearch } from "@/lib/routes";
import { getActiveOrganizationId } from "@/lib/session-active-organization-id";

// Kaneo's workspace search address, kept so old links and bookmarks still work. `/agent/search`
// searches only the session's active workspace, so we redirect there (with query and hash intact)
// only when the URL names an accessible workspace that is currently active. Another accessible
// workspace stays scoped to its own results here; a missing or inaccessible workspace shows an
// explicit unavailable state instead of silently switching workspaces.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/search",
)({
  validateSearch: parseAgentGlobalSearch,
  component: LegacyWorkspaceSearchRoute,
});

function LegacyWorkspaceSearchRoute() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();
  const search = Route.useSearch();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const {
    data: workspaces,
    isLoading: isWorkspacesLoading,
    isError: isWorkspacesError,
    error: workspacesError,
    refetch,
  } = useGetWorkspaces();

  const targetWorkspace = workspaces?.find(
    (candidate) => candidate.id === workspaceId,
  );
  const activeWorkspaceId = getActiveOrganizationId(session);
  const redirectHref =
    !isSessionPending &&
    !isWorkspacesLoading &&
    !isWorkspacesError &&
    targetWorkspace &&
    activeWorkspaceId === workspaceId
      ? withLocationSuffix("/agent/search", location)
      : undefined;

  useEffect(() => {
    if (redirectHref) void navigate({ href: redirectHref, replace: true });
  }, [navigate, redirectHref]);

  if (isSessionPending || isWorkspacesLoading || redirectHref) {
    return (
      <WorkspaceLayout title={t("workspace:search.pageTitle")}>
        <div
          aria-label={t("common:empty.loading")}
          className="p-4"
          data-testid="workspace-search-loading"
          role="status"
        >
          <Skeleton className="h-10 w-full" />
        </div>
      </WorkspaceLayout>
    );
  }

  if (isWorkspacesError) {
    return (
      <WorkspaceLayout title={t("workspace:search.pageTitle")}>
        <ErrorDisplay error={workspacesError} onRetry={() => void refetch()} />
      </WorkspaceLayout>
    );
  }

  if (!targetWorkspace) {
    return (
      <WorkspaceLayout title={t("workspace:search.pageTitle")}>
        <PageTitle title={t("workspace:search.pageTitle")} />
        <Empty data-testid="workspace-search-unavailable">
          <EmptyHeader>
            <EmptyTitle>{t("workspace:search.unavailableTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("workspace:search.unavailableDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </WorkspaceLayout>
    );
  }

  return (
    <WorkspaceLayout title={t("workspace:search.pageTitle")}>
      <PageTitle title={t("workspace:search.pageTitle")} />
      <WorkspaceSearch
        key={targetWorkspace.id}
        workspaceId={targetWorkspace.id}
        search={search}
        onSearchChange={(next) =>
          void navigate({
            to: "/dashboard/workspace/$workspaceId/search",
            params: { workspaceId: targetWorkspace.id },
            search: next,
            replace: true,
          })
        }
      />
    </WorkspaceLayout>
  );
}
