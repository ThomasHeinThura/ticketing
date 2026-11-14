import { createFileRoute } from "@tanstack/react-router";
import { Skeleton, useDelayedPending } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { WorkspaceMembersSettings } from "@/components/team/workspace-members-screen";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { parseSettingsTextFilterSearch } from "@/lib/routes";

// L-03 (Thomas, 30 Oct 2026): workspace members live in the workspace settings frame at this
// canonical URL (docs/screens.md). The old /agent/settings/members and
// /dashboard/workspace/{id}/members links land here. `q` (person search) stays in the URL.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/members",
)({
  validateSearch: parseSettingsTextFilterSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { data: workspace, isLoading, isError } = useActiveWorkspace();
  const placeholderVisible = useDelayedPending(isLoading);
  return (
    <>
      <PageTitle title={t("team:members.pageTitle")} />
      {!isError && (isLoading || (placeholderVisible && workspace)) ? (
        <div
          role="status"
          style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
          aria-label={t("common:empty.loading")}
          className="space-y-3 p-6"
        >
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : workspace ? (
        <WorkspaceMembersSettings workspaceId={workspace.id} />
      ) : null}
    </>
  );
}
