import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createImportRun, type ImportRun } from "@/fetchers/god-mode/imports";
import getProjects from "@/fetchers/project/get-projects";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";

type WorkspaceOption = { id: string; name: string };

export function ImportRunCreateDialog({
  workspaces,
  onClose,
  onCreated,
}: {
  workspaces: WorkspaceOption[];
  onClose: () => void;
  onCreated: (run: ImportRun) => void;
}) {
  const { t } = useTranslation("godModeImports");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [projectId, setProjectId] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const projects = useQuery({
    queryKey: ["god-mode", "imports", "projects", workspaceId],
    queryFn: () => getProjects({ workspaceId }),
    enabled: Boolean(workspaceId),
    retry: false,
  });
  const permission = useWorkspacePermission(
    workspaceId || undefined,
    projectId || undefined,
  );
  const create = useMutation({
    mutationFn: (key: string) =>
      createImportRun(
        {
          workspaceId,
          projectId,
          pluginId: "import.mcp",
          sourceRef: sourceRef.trim(),
        },
        key,
      ),
    onSuccess: onCreated,
  });
  const canCreate =
    Boolean(projectId) &&
    !permission.isCheckingPermissions &&
    permission.canCreateTasks();
  const busy = create.isPending;

  function changeWorkspace(value: string | null) {
    setWorkspaceId(value ?? "");
    setProjectId("");
    setIdempotencyKey("");
  }

  function changeProject(value: string | null) {
    setProjectId(value ?? "");
    setIdempotencyKey("");
  }

  function changeSourceRef(value: string) {
    setSourceRef(value);
    setIdempotencyKey("");
  }

  function submit() {
    if (!workspaceId || !projectId || !sourceRef.trim() || !canCreate || busy)
      return;
    const key = idempotencyKey || globalThis.crypto.randomUUID();
    setIdempotencyKey(key);
    create.mutate(key);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent closeLabel={t("createCancel")}>
        <DialogHeader>
          <DialogTitle>{t("createTitle")}</DialogTitle>
          <DialogDescription>{t("createDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6">
          <div className="space-y-2">
            <Label htmlFor="import-run-workspace">{t("workspace")}</Label>
            <Select
              value={workspaceId}
              disabled={busy}
              onValueChange={changeWorkspace}
            >
              <SelectTrigger id="import-run-workspace">
                <SelectValue placeholder={t("selectWorkspace")} />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((workspace) => (
                  <SelectItem key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="import-run-project">{t("project")}</Label>
            {projects.isPending ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select
                value={projectId}
                disabled={busy || projects.isError}
                onValueChange={changeProject}
              >
                <SelectTrigger id="import-run-project">
                  <SelectValue placeholder={t("selectProject")} />
                </SelectTrigger>
                <SelectContent>
                  {(projects.data ?? []).map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="import-run-source-ref">{t("sourceRef")}</Label>
            <Input
              id="import-run-source-ref"
              autoComplete="off"
              value={sourceRef}
              disabled={busy}
              onChange={(event) => changeSourceRef(event.currentTarget.value)}
              aria-describedby="import-run-source-ref-hint"
            />
            <p
              id="import-run-source-ref-hint"
              className="text-muted-foreground text-xs"
            >
              {t("sourceRefHint")}
            </p>
          </div>

          {permission.isCheckingPermissions && projectId ? (
            <p className="text-muted-foreground text-sm">
              {t("checkingPermission")}
            </p>
          ) : projectId && !canCreate ? (
            <Alert variant="warning">
              <AlertDescription>{t("permissionDenied")}</AlertDescription>
            </Alert>
          ) : null}
          {projects.isError ? (
            <Alert variant="error">
              <AlertTitle>{t("loadErrorTitle")}</AlertTitle>
              <AlertDescription className="flex items-center justify-between gap-3">
                <span>{t("projectsLoadError")}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={projects.isFetching}
                  onClick={() => void projects.refetch()}
                >
                  {t("retry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {create.isError ? (
            <Alert variant="error">
              <AlertTitle>
                {create.error instanceof HttpError &&
                create.error.status === 403
                  ? t("forbiddenTitle")
                  : t("createErrorTitle")}
              </AlertTitle>
              <AlertDescription>{t("createErrorDescription")}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("createCancel")}
          </Button>
          <Button
            disabled={
              busy ||
              !workspaceId ||
              !projectId ||
              !sourceRef.trim() ||
              !canCreate
            }
            onClick={submit}
          >
            {t("createSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
