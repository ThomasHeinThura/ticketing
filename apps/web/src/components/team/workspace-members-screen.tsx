import {
  Button,
  Input,
  Skeleton,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@taskdesk/ui";
import { UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PickerPopover } from "@/components/common/picker-popover";
import { isPendingInvitation } from "@/components/team/invitation-status";
import InviteTeamMemberModal from "@/components/team/invite-team-member-modal";
import MembersTable from "@/components/team/members-table";
import useGetFullWorkspace from "@/hooks/queries/workspace/use-get-full-workspace";
import useWorkspaceRoles from "@/hooks/queries/workspace/use-workspace-roles";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

const ALL_ROLES = "__all__";

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

function matches(needle: string, ...values: Array<string | null | undefined>) {
  return values.some((value) => value?.toLocaleLowerCase().includes(needle));
}

/**
 * Kaneo's members table and invite dialog for one workspace, with a person search (`q`, kept in
 * the URL by the caller), a role filter and Members / Pending invitations tabs.
 */
export function WorkspaceMembersContent({
  workspaceId,
  query = "",
  onQueryChange,
  isInviteOpen,
  onInviteClose,
}: {
  workspaceId: string;
  /** The URL's `q`; without it (old workspace members link) the search stays local. */
  query?: string;
  onQueryChange?: (next: string) => void;
  isInviteOpen: boolean;
  onInviteClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: workspace, isLoading } = useGetFullWorkspace({ workspaceId });
  const { data: roles = [] } = useWorkspaceRoles(workspaceId);
  const [role, setRole] = useState(ALL_ROLES);
  const [tab, setTab] = useState<"members" | "invitations">("members");
  // The URL keeps a trimmed `q`, so the box keeps its own text (trailing spaces included while
  // typing a full name) and only follows the URL when it changes from elsewhere.
  const [text, setText] = useState(query);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow outside URL changes only
  useEffect(() => {
    if (query !== text.trim()) setText(query);
  }, [query]);
  const members = workspace?.members ?? [];
  const invitations = (workspace?.pendingInvitations ?? []).filter(
    isPendingInvitation,
  );
  const needle = text.trim().toLocaleLowerCase();
  const roleMatches = (value: string | null | undefined) =>
    role === ALL_ROLES || value === role;
  const visibleMembers = members.filter(
    (member) =>
      roleMatches(member.role) && matches(needle, member.name, member.email),
  );
  const visibleInvitations = invitations.filter(
    (invitation) =>
      roleMatches(invitation.role) && matches(needle, invitation.email),
  );
  const roleLabel = (value: string) =>
    roles.find((candidate) => candidate.role === value)?.name ||
    t(`team:roles.${value}`, {
      defaultValue: value.charAt(0).toUpperCase() + value.slice(1),
    });
  const presentRoles = [
    ...new Set(
      [
        ...members.map((member) => member.role),
        ...invitations.map((i) => i.role),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
  const filtering = needle !== "" || role !== ALL_ROLES;
  return (
    <>
      {isLoading ? (
        <div
          role="status"
          aria-label={t("common:empty.loading")}
          className="space-y-3"
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <Tabs
          value={tab}
          onValueChange={(value) =>
            setTab(value === "invitations" ? "invitations" : "members")
          }
          className="gap-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList>
              <TabsTab value="members">
                {t("team:members.tabMembers", { count: members.length })}
              </TabsTab>
              <TabsTab value="invitations">
                {t("team:members.tabInvitations", {
                  count: invitations.length,
                })}
              </TabsTab>
            </TabsList>
            <div className="flex min-w-0 gap-2">
              <Input
                type="search"
                aria-label={t("team:members.search")}
                placeholder={t("team:members.search")}
                className="min-w-0 flex-1 sm:w-64 sm:flex-none"
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  onQueryChange?.(event.target.value);
                }}
              />
              <PickerPopover
                ariaLabel={t("team:members.roleFilter")}
                className="h-9 shrink-0 sm:h-8"
                value={role}
                onChange={setRole}
                options={[
                  { value: ALL_ROLES, label: t("team:members.allRoles") },
                  ...presentRoles.map((value) => ({
                    value,
                    label: roleLabel(value),
                  })),
                ]}
              />
            </div>
          </div>
          <TabsPanel value="members">
            <MembersTable
              workspaceId={workspaceId}
              users={visibleMembers}
              invitations={[]}
              emptyTitle={filtering ? t("team:members.noMatches") : undefined}
            />
          </TabsPanel>
          <TabsPanel value="invitations">
            <MembersTable
              workspaceId={workspaceId}
              users={[]}
              invitations={visibleInvitations}
              emptyTitle={
                filtering
                  ? t("team:members.noMatches")
                  : t("team:members.noInvitations")
              }
            />
          </TabsPanel>
        </Tabs>
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
  query,
  onQueryChange,
}: {
  workspaceId: string;
  query: string;
  onQueryChange: (next: string) => void;
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
        query={query}
        onQueryChange={onQueryChange}
        isInviteOpen={isInviteOpen}
        onInviteClose={() => setIsInviteOpen(false)}
      />
    </div>
  );
}
