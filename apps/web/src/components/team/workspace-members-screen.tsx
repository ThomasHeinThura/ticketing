import { Button, Skeleton, useDelayedPending } from "@taskdesk/ui";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import InviteTeamMemberModal from "@/components/team/invite-team-member-modal";
import MembersTable from "@/components/team/members-table";
import useGetFullWorkspace from "@/hooks/queries/workspace/use-get-full-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

/** The invite action, shown only to people the server lets invite (`canInviteUsers`). */
export function WorkspaceMembersInviteButton({
  onInvite,
}: {
  onInvite: () => void;
}) {
  const { t } = useTranslation();
  const { canInviteUsers } = useWorkspacePermission();
  if (!canInviteUsers()) return null;
  return (
    <Button variant="outline" size="xs" onClick={onInvite} className="gap-1">
      <UserPlus className="w-3 h-3" />
      {t("team:members.inviteMember")}
    </Button>
  );
}

/** Kaneo's members table and invite dialog for one workspace. */
export function WorkspaceMembersContent({
  workspaceId,
  isInviteOpen,
  onInviteClose,
}: {
  workspaceId: string;
  isInviteOpen: boolean;
  onInviteClose: () => void;
}) {
  const { t } = useTranslation();
  const {
    data: workspace,
    isLoading,
    isError,
  } = useGetFullWorkspace({ workspaceId });
  const placeholderVisible = useDelayedPending(isLoading, {
    releaseNow:
      !isLoading &&
      !isError &&
      workspace?.members.length === 0 &&
      workspace?.pendingInvitations.length === 0,
  });
  return (
    <>
      {!isError && (isLoading || (placeholderVisible && workspace)) ? (
        <div
          role="status"
          style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
          aria-label={t("common:empty.loading")}
          className="space-y-3"
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <MembersTable
          workspaceId={workspaceId}
          users={workspace?.members ?? []}
          invitations={workspace?.pendingInvitations ?? []}
        />
      )}
      <InviteTeamMemberModal open={isInviteOpen} onClose={onInviteClose} />
    </>
  );
}

/**
 * Workspace members inside the workspace settings frame
 * (`/dashboard/settings/workspace/members`, L-03), laid out like the other settings pages.
 */
export function WorkspaceMembersSettings({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">
          {t("team:members.pageTitle")}
        </h1>
        <WorkspaceMembersInviteButton onInvite={() => setIsInviteOpen(true)} />
      </div>
      <WorkspaceMembersContent
        workspaceId={workspaceId}
        isInviteOpen={isInviteOpen}
        onInviteClose={() => setIsInviteOpen(false)}
      />
    </div>
  );
}
