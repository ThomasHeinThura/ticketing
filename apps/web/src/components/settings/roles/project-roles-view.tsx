import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Label,
  SaveButton,
  Skeleton,
  Textarea,
  useDelayedPending,
} from "@taskdesk/ui";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorReference } from "@/components/errors/error-reference";
import {
  FailureAlert,
  StepUpFields,
} from "@/components/god-mode/step-up-fields";
import {
  RoleApiError,
  requestRoleDeletion,
  updateRole,
} from "@/fetchers/workspace-roles";
import {
  projectRolesKey,
  useProjectRoles,
  type WorkspaceRole,
} from "@/hooks/queries/workspace/use-workspace-roles";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useStepUpAction } from "@/hooks/use-step-up-action";
import { localizedErrorMessage } from "@/lib/http-error";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import { auditEntity } from "@/query-client/audit-invalidation";

type ProjectRef = { id: string; name: string };

/** Project rosters show roles by name, so they refetch with the role list. */
async function refreshProjectRoles(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: projectRolesKey(workspaceId) }),
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === "projects" && queryKey[2] === "members",
    }),
  ]);
}

function EditDetailsDialog({
  workspaceId,
  role,
  onClose,
  onReload,
}: {
  workspaceId: string;
  role: WorkspaceRole;
  onClose: () => void;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const stepUp = useStepUpAction();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const changed =
    name.trim() !== role.name ||
    (description.trim() || null) !== (role.description ?? null);
  const save = useMutation({
    mutationFn: async () => {
      const input = {
        name: name.trim(),
        description: description.trim() || null,
        expectedVersion: role.version,
      };
      const outcome = await stepUp.run(
        {
          operation: "workspace_role_update",
          workspaceId,
          roleId: role.id,
          ...input,
        },
        (token) => updateRole(workspaceId, role.id, input, token),
        { writeErrors: "rethrow" },
      );
      if (!outcome.ok)
        throw new Error(t("roles:stepUp.failedTitle"), { cause: "step_up" });
      return { workspaceId, roleId: role.id };
    },
    meta: {
      audits: {
        targets: (_: unknown, r: { workspaceId: string; roleId: string }) =>
          auditEntity("role", r.roleId, {
            kind: "workspace",
            workspaceId: r.workspaceId,
          }),
      },
    },
    onSuccess: async () => {
      await refreshProjectRoles(queryClient, workspaceId);
      toast.success(t("roles:projectRoles.saved"));
      onClose();
    },
  });
  const error = save.error instanceof RoleApiError ? save.error : null;
  const fallback = localizedErrorMessage(
    save.error,
    t,
    t("roles:clientErrors.save"),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{t("roles:projectRoles.editTitle")}</DialogTitle>
          <DialogDescription>
            {t("roles:projectRoles.editDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6">
          <div className="space-y-2">
            <Label htmlFor="project-role-name">{t("roles:fields.name")}</Label>
            <Input
              id="project-role-name"
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-role-description">
              {t("roles:fields.description")}
            </Label>
            <Textarea
              id="project-role-description"
              maxLength={500}
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <StepUpFields action={stepUp} idPrefix="project-role" />
          <FailureAlert
            failure={stepUp.failure}
            title={t("roles:stepUp.failedTitle")}
          />
          {error?.code === "role_changed" ? (
            <Alert variant="info">
              <AlertTitle>{t("roles:errors.role_changed")}</AlertTitle>
              <AlertDescription>
                {t("roles:projectRoles.conflictDescription")}
                <Button
                  className="w-fit"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onReload();
                    onClose();
                  }}
                >
                  <RefreshCw aria-hidden="true" />
                  {t("roles:projectRoles.reload")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : save.error && save.error.cause !== "step_up" ? (
            <Alert variant="error">
              <AlertDescription>
                {error?.code
                  ? t(`roles:errors.${error.code}`, { defaultValue: fallback })
                  : fallback}
                <ErrorReference error={save.error} />
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={save.isPending} onClick={onClose}>
            {t("common:actions.cancel")}
          </Button>
          <SaveButton
            disabled={
              !save.isPending && (!changed || !name.trim() || !stepUp.canRun)
            }
            pending={save.isPending}
            success={save.isSuccess}
            savedLabel={t("common:actions.saved")}
            workingLabel={t("common:actions.saving")}
            announceSuccess={false}
            onClick={() => save.mutate()}
          >
            {t("roles:save.action")}
          </SaveButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Plain-words reasons a project role cannot be deleted, written for the workspace owner. */
function DeleteBlockedDialog({
  role,
  error,
  onClose,
}: {
  role: WorkspaceRole;
  error: RoleApiError;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const body = error.body ?? {};
  const holderCount = Number(body.holderCount ?? role.holderCount);
  const projectCount = Number(body.projectCount ?? role.projectCount ?? 0);
  const projects = Array.isArray(body.projects)
    ? (body.projects as ProjectRef[])
    : [];
  let title = t("roles:projectRoles.blockedBuiltInTitle");
  let content = <p>{t("roles:projectRoles.blockedBuiltInDescription")}</p>;
  if (error.code === "role_in_use") {
    title = t("roles:projectRoles.blockedInUseTitle");
    content = (
      <>
        <p>
          {t("roles:projectRoles.blockedInUseDescription", {
            count: holderCount,
          })}
        </p>
        <p className="font-medium">
          {t("roles:projectRoles.blockedInUseProjects", {
            count: projectCount,
          })}
        </p>
        <ul className="space-y-1">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                className="rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                to={routes.projectSettingsMembers.path}
                params={{ projectId: project.id }}
                onClick={onClose}
                aria-label={t("roles:projectRoles.openMembers", {
                  name: project.name,
                })}
              >
                {project.name}
              </Link>
            </li>
          ))}
        </ul>
        {projectCount > projects.length ? (
          <p className="text-muted-foreground">
            {t("roles:projectRoles.blockedInUseMore", {
              count: projectCount - projects.length,
            })}
          </p>
        ) : null}
      </>
    );
  } else if (error.code === "role_has_revoked_grants") {
    title = t("roles:projectRoles.blockedHistoryTitle");
    content = (
      <p>
        {t("roles:projectRoles.blockedHistoryDescription", {
          count: Number(body.revokedGrantCount ?? 0),
        })}
      </p>
    );
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{role.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-6 text-sm">{content}</div>
        <DialogFooter>
          <Button onClick={onClose}>{t("common:actions.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Project-scope roles: read-only built-ins, rename and delete for custom ones. */
export function ProjectRolesView({
  workspaceId,
  canManage,
}: {
  workspaceId: string | undefined;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const roles = useProjectRoles(workspaceId);
  const openPendingAction = useOpenPendingAction();
  const [editing, setEditing] = useState<WorkspaceRole | null>(null);
  const [blocked, setBlocked] = useState<{
    role: WorkspaceRole;
    error: RoleApiError;
  } | null>(null);
  const placeholderVisible = useDelayedPending(roles.isLoading);
  const remove = useMutation({
    mutationFn: (role: WorkspaceRole) =>
      requestRoleDeletion(workspaceId ?? "", role.id),
    onSuccess: (pending) => openPendingAction(pending),
    onError: (error, role) => {
      if (error instanceof RoleApiError && error.code) {
        setBlocked({ role, error });
        return;
      }
      toast.error(localizedErrorMessage(error, t, t("roles:delete.failed")), {
        error,
      });
    },
  });
  const reload = () => {
    if (workspaceId) void refreshProjectRoles(queryClient, workspaceId);
  };

  if (roles.isLoading)
    return (
      <div
        role="status"
        aria-label={t("roles:projectRoles.loading")}
        style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
        className="space-y-3"
      >
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  if (roles.isError)
    return (
      <Alert variant="error">
        <AlertTitle>{t("roles:projectRoles.loadErrorTitle")}</AlertTitle>
        <AlertDescription>
          {t("roles:projectRoles.loadErrorDescription")}
          <Button className="w-fit" onClick={() => void roles.refetch()}>
            <RefreshCw aria-hidden="true" />
            {t("common:actions.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (!roles.data?.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t("roles:projectRoles.emptyTitle")}</EmptyTitle>
          <EmptyDescription>
            {t("roles:projectRoles.emptyDescription")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <>
      <p className="mb-2 max-w-2xl text-sm text-muted-foreground">
        {t("roles:projectRoles.description")}
      </p>
      <ul className="divide-y">
        {roles.data.map((role) => (
          <li
            key={role.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
          >
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-words font-medium">
                  {role.name}
                </span>
                {role.isSystem ? (
                  <Badge variant="info">{t("roles:badges.system")}</Badge>
                ) : (
                  <Badge variant="secondary">{t("roles:badges.custom")}</Badge>
                )}
              </div>
              <p className="break-words text-sm text-muted-foreground">
                {role.description ? `${role.description} · ` : ""}
                {role.holderCount > 0
                  ? `${t("roles:list.holders", { count: role.holderCount })} · ${t("roles:projectRoles.projectsUsed", { count: role.projectCount ?? 0 })}`
                  : t("roles:projectRoles.notUsed")}
              </p>
            </div>
            {canManage && !role.isSystem ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("roles:projectRoles.editNamed", {
                    name: role.name,
                  })}
                  onClick={() => setEditing(role)}
                >
                  {t("roles:projectRoles.edit")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("roles:projectRoles.deleteNamed", {
                    name: role.name,
                  })}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(role)}
                >
                  {t("roles:delete.action")}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {editing && workspaceId ? (
        <EditDetailsDialog
          key={`${editing.id}:${editing.version}`}
          workspaceId={workspaceId}
          role={editing}
          onClose={() => setEditing(null)}
          onReload={reload}
        />
      ) : null}
      {blocked ? (
        <DeleteBlockedDialog
          role={blocked.role}
          error={blocked.error}
          onClose={() => setBlocked(null)}
        />
      ) : null}
    </>
  );
}
