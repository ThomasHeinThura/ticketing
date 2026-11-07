import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import {
  WorkspaceMembersContent,
  WorkspaceMembersInviteButton,
} from "@/components/team/workspace-members-screen";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { routes } from "@/lib/routes";

// Old link (L-03): members moved to /dashboard/settings/workspace/members. That page shows the
// active workspace, so only a link to the active workspace redirects there; a link naming
// another workspace still shows that workspace's members here rather than the wrong list.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/members",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();
  const { data: activeWorkspace, isLoading } = useActiveWorkspace();
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  if (isLoading && !activeWorkspace) return null;
  if (activeWorkspace?.id === workspaceId)
    return <Navigate to={routes.workspaceMembers.path} replace />;

  return (
    <>
      <PageTitle title={t("team:members.pageTitle")} />
      <WorkspaceLayout
        title={t("team:members.pageTitle")}
        headerActions={
          <WorkspaceMembersInviteButton
            onInvite={() => setIsInviteOpen(true)}
          />
        }
      >
        <h1 className="sr-only">{t("team:members.pageTitle")}</h1>
        <WorkspaceMembersContent
          workspaceId={workspaceId}
          isInviteOpen={isInviteOpen}
          onInviteClose={() => setIsInviteOpen(false)}
        />
      </WorkspaceLayout>
    </>
  );
}
