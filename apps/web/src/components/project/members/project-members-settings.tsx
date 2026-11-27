import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Label,
  LoadingStatus,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useDelayedPending,
} from "@taskdesk/ui";
import { EllipsisIcon, TrashIcon, TriangleAlert, UserPlus } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@/components/avatar";
import {
  useAddProjectMember,
  useRemoveProjectMember,
  useUpdateProjectMemberRole,
} from "@/hooks/mutations/project-member/use-project-member-mutations";
import useGetProjectMemberCandidates from "@/hooks/queries/project-member/use-get-project-member-candidates";
import useGetProjectMembers from "@/hooks/queries/project-member/use-get-project-members";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";
import { CustomerProjectAccess } from "./customer-project-access";
import {
  assignableRoles,
  groupRosterRoles,
  isAuthorityReplacingWorkspaceRole,
  projectMemberErrorKey,
  type RosterMemberView,
  type RosterRoleView,
  roleDescriptionText,
  rosterRoleItems,
} from "./project-members-model";

const SettingsHistory = lazy(() =>
  import("@/components/settings/settings-history").then((m) => ({
    default: m.SettingsHistory,
  })),
);

function validHistoryId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.trim().length > 0 &&
    id.length <= 200 &&
    !id.includes("\0")
  );
}

type Props = { projectId: string };

/**
 * Project settings, Members (`PR-2`..`PR-4`): the project roster in Kaneo's members table
 * pattern. Direct rows can be re-roled and removed; rows inherited from an ancestor project
 * are shown read-only with the ancestor named, a role change on one writes the explicit child
 * row that overrides it (`PR-3`), and removing one explains it is removed at the parent
 * (`PR-4`). The server decides every refusal; roster and customer-access controls follow
 * project-scoped `canManageMembers` (respecting RL-3 custom role decoupling), falling back to
 * the workspace project-update capability when absent, while `callerRank` bounds assignable roles.
 */
function ProjectMembersSettings({ projectId }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: activeWorkspace } = useActiveWorkspace();
  const [history, setHistory] = useState<{
    id: string;
    personId: string;
  } | null>(null);
  const { canUpdateProjects } = useWorkspacePermission();
  const { data, isLoading, isError, error, refetch } =
    useGetProjectMembers(projectId);
  const { mutateAsync: updateRole, isPending: isChangingRole } =
    useUpdateProjectMemberRole();
  const { mutateAsync: removeMember, isPending: isRemoving } =
    useRemoveProjectMember();

  const [addOpen, setAddOpen] = useState(false);
  const [toRemove, setToRemove] = useState<RosterMemberView | null>(null);
  const [inheritedNotice, setInheritedNotice] =
    useState<RosterMemberView | null>(null);

  const historyOpen = Boolean(
    history &&
      data?.members.some(
        (member) =>
          member.personId === history.personId &&
          member.membershipId === history.id &&
          member.source === "direct" &&
          !member.managedExternally,
      ),
  );
  useEffect(() => {
    if (history && !historyOpen) setHistory(null);
  }, [history, historyOpen]);

  const placeholderVisible = useDelayedPending(isLoading, {
    releaseNow: !isLoading && !isError && data?.members.length === 0,
  });
  if (!isError && (isLoading || (placeholderVisible && data))) {
    return (
      <LoadingStatus
        visible={placeholderVisible}
        label={t("common:empty.loading")}
      >
        <section
          aria-busy="true"
          style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
          aria-label={t("settings:projectMembers.title")}
          className="space-y-3"
        >
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </section>
      </LoadingStatus>
    );
  }

  if (isError || !data) {
    return (
      <Alert variant="error" role="alert">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          {error instanceof Error && error.message
            ? error.message
            : t("settings:projectMembers.loadError")}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
          >
            {t("common:actions.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const roles: RosterRoleView[] = data.roles;
  // Project-scoped canManageMembers governs roster and customer-access controls (respecting
  // RL-3 custom role rank/capability decoupling); workspace capability remains the fallback
  // when the response omits canManageMembers. callerRank bounds assignableRoles only.
  const callerRank = data.callerRank;
  const canManage =
    typeof data.canManageMembers === "boolean"
      ? data.canManageMembers
      : Boolean(canUpdateProjects());
  const grantableRoles = assignableRoles(roles, callerRank);

  const handleChangeRole = async (
    member: RosterMemberView,
    roleKey: unknown,
  ) => {
    if (typeof roleKey !== "string" || roleKey === member.roleKey) return;
    try {
      await updateRole({
        workspaceId: activeWorkspace?.id ?? "",
        projectId,
        personId: member.personId,
        roleKey,
        membershipId:
          member.source === "direct" &&
          !member.managedExternally &&
          validHistoryId(member.membershipId)
            ? member.membershipId
            : null,
      });
      toast.success(t("settings:projectMembers.roleUpdated"));
    } catch (failure) {
      toast.error(
        t(
          projectMemberErrorKey(
            failure,
            "settings:projectMembers.roleUpdateError",
          ),
        ),
      );
    }
  };

  const handleRemove = async () => {
    if (!toRemove) return;
    try {
      await removeMember({
        workspaceId: activeWorkspace?.id ?? "",
        projectId,
        personId: toRemove.personId,
        membershipId: toRemove.membershipId,
      });
      toast.success(t("settings:projectMembers.removed"));
    } catch (failure) {
      toast.error(
        t(
          projectMemberErrorKey(failure, "settings:projectMembers.removeError"),
        ),
      );
    } finally {
      setToRemove(null);
    }
  };

  return (
    <section className="space-y-4" data-testid="project-members">
      {canManage ? <CustomerProjectAccess projectId={projectId} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-md font-medium">
            {t("settings:projectMembers.sectionTitle")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("settings:projectMembers.sectionSubtitle")}
          </p>
        </div>
        {canManage ? (
          <Button
            variant="outline"
            size="xs"
            className="gap-1"
            onClick={() => setAddOpen(true)}
          >
            <UserPlus className="w-3 h-3" />
            {t("settings:projectMembers.addMember")}
          </Button>
        ) : null}
      </div>

      {data.members.length === 0 ? (
        <Alert variant="warning" data-testid="project-members-empty-warning">
          <TriangleAlert />
          <AlertDescription>
            {t("settings:projectMembers.emptyWarning")}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="border border-border rounded-md bg-sidebar">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="ps-6 text-foreground font-medium">
                {t("settings:projectMembers.columns.member")}
              </TableHead>
              <TableHead className="text-foreground font-medium">
                {t("settings:projectMembers.columns.role")}
              </TableHead>
              <TableHead className="text-foreground font-medium">
                {t("settings:projectMembers.columns.source")}
              </TableHead>
              <TableHead className="w-px pe-6" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.members.map((member, index) => {
              const inherited = member.source === "inherited";
              const membershipId = member.membershipId;
              return (
                <TableRow key={member.personId}>
                  <TableCell className="ps-6 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarFallback className="text-[11px] font-medium">
                          {getInitials(member.displayName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {member.displayName ?? member.personId}
                          </span>
                          {member.active ? null : (
                            <Badge variant="outline" size="sm">
                              {t("settings:projectMembers.inactive")}
                            </Badge>
                          )}
                        </div>
                        {member.jobTitle ? (
                          <div className="truncate text-xs text-muted-foreground">
                            {member.jobTitle}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    {canManage && !member.managedExternally ? (
                      <Select
                        items={rosterRoleItems(roles)}
                        value={member.roleKey}
                        disabled={isChangingRole}
                        onValueChange={(value) =>
                          typeof value === "string" &&
                          void handleChangeRole(member, value)
                        }
                      >
                        <SelectTrigger
                          className="h-8 w-40"
                          aria-label={t(
                            "settings:projectMembers.changeRoleFor",
                            {
                              name: member.displayName ?? member.personId,
                            },
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <RoleSelectOptions
                            roles={assignableRoles(
                              roles,
                              callerRank,
                              member.roleKey,
                            )}
                          />
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary">{member.roleName}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex flex-col items-start gap-1">
                      {inherited && member.inheritedFrom ? (
                        <Badge variant="outline">
                          {t("settings:projectMembers.inheritedFrom", {
                            project: member.inheritedFrom.projectName,
                          })}
                        </Badge>
                      ) : member.managedExternally ? (
                        <Badge variant="outline">
                          {t("settings:projectMembers.managedExternally")}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          {t("settings:projectMembers.direct")}
                        </Badge>
                      )}
                      {!inherited && member.overridesInherited ? (
                        <span className="text-xs text-muted-foreground">
                          {t("settings:projectMembers.overrides", {
                            role: member.overridesInherited.roleName,
                            project: member.inheritedFrom?.projectName ?? "",
                          })}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="pe-6 py-3 text-right">
                    {validHistoryId(membershipId) &&
                    member.source === "direct" &&
                    !member.managedExternally ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("settings:history.memberHistory", {
                          name:
                            member.displayName ||
                            t("settings:history.personUnavailable"),
                          number: index + 1,
                        })}
                        onClick={() =>
                          setHistory({
                            id: membershipId,
                            personId: member.personId,
                          })
                        }
                      >
                        {t("settings:history.title")}
                      </Button>
                    ) : null}
                    {canManage ? (
                      <Menu>
                        <MenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground"
                              aria-label={t(
                                "settings:projectMembers.actionsFor",
                                {
                                  name: member.displayName ?? member.personId,
                                },
                              )}
                            />
                          }
                        >
                          <EllipsisIcon className="size-4" />
                        </MenuTrigger>
                        <MenuPopup align="end">
                          <MenuItem
                            disabled={member.managedExternally}
                            onClick={() =>
                              inherited
                                ? setInheritedNotice(member)
                                : setToRemove(member)
                            }
                          >
                            <TrashIcon className="size-4" />
                            {t("settings:projectMembers.removeMember")}
                          </MenuItem>
                        </MenuPopup>
                      </Menu>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
            {data.members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <p className="text-sm font-medium text-foreground">
                      {t("settings:projectMembers.emptyTitle")}
                    </p>
                    <p className="text-xs">
                      {t("settings:projectMembers.emptyDescription")}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={historyOpen}
        onOpenChange={(open) => !open && setHistory(null)}
      >
        <DialogPopup closeLabel={t("common:actions.close")}>
          <DialogHeader>
            <DialogTitle>{t("settings:history.title")}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            {history && historyOpen && activeWorkspace?.id ? (
              <Suspense fallback={null}>
                <SettingsHistory
                  key={`${history.id}:${projectId}`}
                  target={{
                    kind: "entity",
                    type: "project_membership",
                    id: history.id,
                    scope: {
                      kind: "project",
                      workspaceId: activeWorkspace.id,
                      projectId,
                    },
                  }}
                />
              </Suspense>
            ) : null}
          </DialogPanel>
        </DialogPopup>
      </Dialog>
      <AddMemberDialog
        projectId={projectId}
        open={addOpen}
        roles={grantableRoles}
        onClose={() => setAddOpen(false)}
      />

      <AlertDialog
        open={toRemove !== null}
        onOpenChange={(open) => !open && setToRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:projectMembers.removeDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:projectMembers.removeDialogDescription", {
                name: toRemove?.displayName ?? toRemove?.personId ?? "",
              })}
              {toRemove?.overridesInherited && toRemove.inheritedFrom
                ? ` ${t("settings:projectMembers.removeOverrideNote", {
                    role: toRemove.overridesInherited.roleName,
                    project: toRemove.inheritedFrom.projectName,
                  })}`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" size="sm" disabled={isRemoving} />
              }
            >
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isRemoving}
                  onClick={() => void handleRemove()}
                />
              }
            >
              <TrashIcon className="mr-2 size-4" />
              {t("settings:projectMembers.removeMember")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={inheritedNotice !== null}
        onOpenChange={(open) => !open && setInheritedNotice(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:projectMembers.inheritedDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:projectMembers.inheritedDialogDescription", {
                name:
                  inheritedNotice?.displayName ??
                  inheritedNotice?.personId ??
                  "",
                project: inheritedNotice?.inheritedFrom?.projectName ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.close")}
            </AlertDialogClose>
            {inheritedNotice?.inheritedFrom ? (
              <AlertDialogClose
                render={
                  <Button
                    size="sm"
                    onClick={() =>
                      void navigate({
                        to: "/dashboard/settings/projects/$projectId/members",
                        params: {
                          projectId:
                            inheritedNotice.inheritedFrom?.projectId ?? "",
                        },
                      })
                    }
                  />
                }
              >
                {t("settings:projectMembers.openParentRoster", {
                  project: inheritedNotice.inheritedFrom.projectName,
                })}
              </AlertDialogClose>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** Built-in roles, then custom roles; each option shows its description under the name. */
function RoleSelectOptions({ roles }: { roles: readonly RosterRoleView[] }) {
  const { t } = useTranslation();
  const { builtIn, custom } = groupRosterRoles(roles);
  const groups = [
    {
      key: "builtIn",
      label: t("settings:projectMembers.roleGroupBuiltIn"),
      roles: builtIn,
    },
    {
      key: "custom",
      label: t("settings:projectMembers.roleGroupCustom"),
      roles: custom,
    },
  ];
  return groups
    .filter((group) => group.roles.length > 0)
    .map((group) => (
      <SelectGroup key={group.key}>
        <SelectGroupLabel>{group.label}</SelectGroupLabel>
        {group.roles.map((role) => {
          const description = roleDescriptionText(role, t);
          return (
            <SelectItem key={role.roleKey} value={role.roleKey}>
              <span className="block">{role.roleName}</span>
              {description ? (
                <span className="line-clamp-2 block text-muted-foreground text-xs">
                  {description}
                </span>
              ) : null}
            </SelectItem>
          );
        })}
      </SelectGroup>
    ));
}

function AddMemberDialog({
  projectId,
  open,
  roles,
  onClose,
}: {
  projectId: string;
  open: boolean;
  roles: RosterRoleView[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [personId, setPersonId] = useState<string | null>(null);
  const [roleKey, setRoleKey] = useState<string>("project-member");
  const candidates = useGetProjectMemberCandidates(projectId, open);
  const { mutateAsync: addMember, isPending } = useAddProjectMember();
  const { data: workspace } = useActiveWorkspace();

  const roleItems = rosterRoleItems(roles);
  const personItems = (candidates.data ?? []).map((candidate) => ({
    value: candidate.personId,
    label: candidate.email
      ? `${candidate.displayName ?? candidate.email} (${candidate.email})`
      : (candidate.displayName ?? candidate.personId),
  }));
  const selected = (candidates.data ?? []).find(
    (candidate) => candidate.personId === personId,
  );

  const close = () => {
    setPersonId(null);
    setRoleKey("project-member");
    onClose();
  };

  const submit = async () => {
    if (!personId) return;
    try {
      await addMember({
        workspaceId: workspace?.id ?? "",
        projectId,
        personId,
        roleKey,
      });
      toast.success(t("settings:projectMembers.added"));
      close();
    } catch (failure) {
      toast.error(
        t(projectMemberErrorKey(failure, "settings:projectMembers.addError")),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogPopup
        className="w-full max-w-md"
        closeLabel={t("common:actions.close")}
      >
        <DialogHeader>
          <DialogTitle>
            {t("settings:projectMembers.addDialogTitle")}
          </DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {candidates.isError ? (
            <Alert variant="error" role="alert">
              <AlertDescription>
                {candidates.error instanceof Error && candidates.error.message
                  ? candidates.error.message
                  : t("settings:projectMembers.candidatesError")}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="project-member-person" className="font-medium">
              {t("settings:projectMembers.person")}
            </Label>
            <Select
              items={personItems}
              value={personId}
              disabled={candidates.isLoading}
              onValueChange={(value) =>
                setPersonId(typeof value === "string" ? value : null)
              }
            >
              <SelectTrigger id="project-member-person" className="w-full">
                <SelectValue
                  placeholder={t("settings:projectMembers.personPlaceholder")}
                />
              </SelectTrigger>
              <SelectContent>
                {personItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!candidates.isLoading &&
            !candidates.isError &&
            personItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("settings:projectMembers.noCandidates")}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-member-role" className="font-medium">
              {t("settings:projectMembers.role")}
            </Label>
            <Select
              items={roleItems}
              value={roleKey}
              onValueChange={(value) =>
                typeof value === "string" && setRoleKey(value)
              }
            >
              <SelectTrigger id="project-member-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <RoleSelectOptions roles={roles} />
              </SelectContent>
            </Select>
          </div>
          {selected &&
          isAuthorityReplacingWorkspaceRole(selected.workspaceRole) ? (
            <Alert
              variant="warning"
              data-testid="project-member-authority-note"
            >
              <TriangleAlert />
              <AlertDescription>
                {t("settings:projectMembers.authorityNote", {
                  role: selected.workspaceRole,
                })}
              </AlertDescription>
            </Alert>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <DialogClose
            render={<Button variant="outline" size="sm" type="button" />}
          >
            {t("common:actions.cancel")}
          </DialogClose>
          <Button
            type="button"
            size="sm"
            disabled={!personId || isPending}
            onClick={() => void submit()}
          >
            {t("settings:projectMembers.addMember")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export default ProjectMembersSettings;
