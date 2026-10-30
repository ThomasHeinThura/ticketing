import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
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
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { ChevronLeft, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { CabTemplatePanel } from "@/components/workflow/cab-template-panel";
import {
  type NamedOption,
  WorkflowAddTransitionDialog,
} from "@/components/workflow/workflow-add-transition-dialog";
import { WorkflowValidationDialog } from "@/components/workflow/workflow-validation-dialog";
import {
  createWorkflow,
  createWorkflowVersion,
  getWorkflow,
  getWorkflows,
  previewWorkflowPublication,
  publishWorkflowVersion,
  toTransitionInput,
  type WorkflowDetail,
  type WorkflowTransitionInput,
  type WorkflowValidation,
} from "@/fetchers/workflow";
import useGetProjectStateTemplates from "@/hooks/queries/project/use-get-project-state-templates";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useWorkspaceRoles from "@/hooks/queries/workspace/use-workspace-roles";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import { parseWorkflowSettingsSearch, routes } from "@/lib/routes";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/workflows",
)({
  validateSearch: parseWorkflowSettingsSearch,
  component: WorkflowSettingsRoute,
});

function versionStatus(
  workflow: WorkflowDetail,
  version: WorkflowDetail["versions"][number],
): "active" | "draft" | "superseded" {
  if (version.id === workflow.activeVersionId) return "active";
  return version.publishedAt ? "superseded" : "draft";
}

const STATUS_VARIANT = {
  active: "success",
  draft: "warning",
  superseded: "secondary",
} as const;

function WorkflowSettingsRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const { workflowId } = Route.useSearch();
  const { data: workspace } = useActiveWorkspace();
  const projects = useGetProjects({ workspaceId: workspace?.id ?? "" });
  // State templates are workspace-wide; any project can list them for their names.
  const templates = useGetProjectStateTemplates(projects.data?.[0]?.id);
  const roles = useWorkspaceRoles(workspace?.id);
  const { canManageWorkspaceSettings, isCheckingPermissions } =
    useWorkspacePermission();
  const canManage = canManageWorkspaceSettings() && !isCheckingPermissions;
  const states: NamedOption[] = (templates.data ?? []).map((template) => ({
    id: template.id,
    name: template.name,
  }));
  const projectOptions: NamedOption[] = (projects.data ?? []).map(
    (project) => ({ id: project.id, name: project.name }),
  );
  const roleOptions: NamedOption[] = (roles.data ?? []).map((role) => ({
    id: role.id,
    name: role.role,
  }));
  return (
    <>
      <PageTitle title={t("settings:workflows.title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        {workflowId ? (
          <WorkflowDetailView
            workflowId={workflowId}
            canManage={canManage}
            states={states}
            roles={roleOptions}
            projects={projectOptions}
            onBack={() =>
              void navigate({
                to: routes.workflowSettings.path,
                search: { workflowId: undefined },
              })
            }
          />
        ) : (
          <WorkflowListView
            workspaceId={workspace?.id}
            canManage={canManage}
            projects={projectOptions}
            onOpen={(id) =>
              void navigate({
                to: routes.workflowSettings.path,
                search: { workflowId: id },
              })
            }
          />
        )}
      </div>
    </>
  );
}

function WorkflowListView({
  workspaceId,
  canManage,
  projects,
  onOpen,
}: {
  workspaceId: string | undefined;
  canManage: boolean;
  projects: NamedOption[];
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const list = useQuery({
    queryKey: ["workflows", workspaceId],
    queryFn: () => getWorkflows(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
  });
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-semibold text-2xl">
            {t("settings:workflows.title")}
          </h1>
          <p className="max-w-2xl text-muted-foreground text-sm">
            {t("settings:workflows.description")}
          </p>
        </div>
        {canManage ? (
          <Button disabled={!workspaceId} onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t("settings:workflows.new")}
          </Button>
        ) : null}
      </div>
      <CabTemplatePanel
        workspaceId={workspaceId}
        canManage={canManage}
        projects={projects}
      />
      {!canManage ? (
        <Alert variant="info">
          <AlertTitle>{t("settings:workflows.readOnlyTitle")}</AlertTitle>
          <AlertDescription>
            {t("settings:workflows.readOnlyDescription")}
          </AlertDescription>
        </Alert>
      ) : null}
      {list.isLoading || !workspaceId ? (
        <div
          className="space-y-3"
          role="status"
          aria-label={t("settings:workflows.loading")}
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : list.isError ? (
        <Alert variant="error">
          <AlertTitle>{t("settings:workflows.loadErrorTitle")}</AlertTitle>
          <AlertDescription>
            {t("settings:workflows.loadErrorDescription")}
            <Button className="w-fit" onClick={() => void list.refetch()}>
              <RefreshCw aria-hidden="true" />
              {t("common:actions.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : list.data?.length ? (
        <Card>
          <CardContent className="p-0">
            <Table aria-label={t("settings:workflows.title")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("settings:workflows.list.name")}</TableHead>
                  <TableHead>{t("settings:workflows.list.key")}</TableHead>
                  <TableHead>{t("settings:workflows.list.active")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.map((workflow) => (
                  <TableRow key={workflow.id}>
                    <TableCell>
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() => onOpen(workflow.id)}
                      >
                        {workflow.name}
                      </Button>
                    </TableCell>
                    <TableCell className="font-mono">{workflow.key}</TableCell>
                    <TableCell>
                      {workflow.activeVersionId ? (
                        <Badge variant="success">
                          {t("settings:workflows.status.active")}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          {t("settings:workflows.list.notPublished")}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("settings:workflows.emptyTitle")}</EmptyTitle>
                <EmptyDescription>
                  {t("settings:workflows.emptyDescription")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      )}
      {workspaceId ? (
        <CreateWorkflowDialog
          workspaceId={workspaceId}
          open={creating}
          onOpenChange={setCreating}
          onCreated={onOpen}
        />
      ) : null}
    </>
  );
}

function CreateWorkflowDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () =>
      createWorkflow({ workspaceId, key: key.trim(), name: name.trim() }),
    onSuccess: async (workflow) => {
      await cache.invalidateQueries({ queryKey: ["workflows"] });
      setKey("");
      setName("");
      onOpenChange(false);
      onCreated(workflow.id);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!create.isPending) {
          if (!next) create.reset();
          onOpenChange(next);
        }
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{t("settings:workflows.create.title")}</DialogTitle>
          <DialogDescription>
            {t("settings:workflows.create.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6">
          <div className="space-y-2">
            <Label htmlFor="workflow-name">
              {t("settings:workflows.create.name")}
            </Label>
            <Input
              id="workflow-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workflow-key">
              {t("settings:workflows.create.key")}
            </Label>
            <Input
              id="workflow-key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </div>
          {create.isError ? (
            <Alert variant="error" role="alert">
              <AlertDescription>
                {create.error instanceof HttpError &&
                create.error.status === 409
                  ? t("settings:workflows.create.keyTaken")
                  : t("settings:workflows.create.error")}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={create.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            disabled={!key.trim() || !name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {t("settings:workflows.create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkflowDetailView({
  workflowId,
  canManage,
  states,
  roles,
  projects,
  onBack,
}: {
  workflowId: string;
  canManage: boolean;
  states: NamedOption[];
  roles: NamedOption[];
  projects: NamedOption[];
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const detail = useQuery({
    queryKey: ["workflows", "detail", workflowId],
    queryFn: () => getWorkflow(workflowId),
  });
  // `null` until the first edit; then the full transition set a "Save draft" sends.
  const [working, setWorking] = useState<WorkflowTransitionInput[] | null>(
    null,
  );
  const [adding, setAdding] = useState(false);
  const [validating, setValidating] = useState<{
    number: number;
    report: WorkflowValidation | undefined;
  } | null>(null);
  const workflow = detail.data;
  const latest = workflow?.versions.reduce<
    WorkflowDetail["versions"][number] | undefined
  >(
    (best, version) => (!best || version.number > best.number ? version : best),
    undefined,
  );
  const baseTransitions = (latest?.transitions ?? []).map(toTransitionInput);
  const shown = working ?? baseTransitions;
  // A transition has no id of its own once edited; an identical twin gets "#2", "#3"...
  const seen = new Map<string, number>();
  const rowKeys = shown.map((transition) => {
    const base = `${transition.fromStateTemplateId}>${transition.toStateTemplateId}:${transition.roleId}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return `${base}#${count}`;
  });
  const stateName = (id: string | null) =>
    id === null
      ? t("settings:workflows.transitions.anyState")
      : (states.find((state) => state.id === id)?.name ?? id);
  const roleName = (id: string | null) =>
    id === null
      ? t("settings:workflows.transitions.anyRole")
      : (roles.find((role) => role.id === id)?.name ?? id);

  const validate = useMutation({
    mutationFn: (number: number) =>
      previewWorkflowPublication({ id: workflowId, number }),
    onSuccess: (report, number) => setValidating({ number, report }),
  });
  const saveDraft = useMutation({
    mutationFn: () =>
      createWorkflowVersion({ id: workflowId, transitions: working ?? [] }),
    onSuccess: async (version) => {
      await cache.invalidateQueries({ queryKey: ["workflows"] });
      setWorking(null);
      toast.success(
        t("settings:workflows.draftSaved", { number: version.number }),
      );
      validate.mutate(version.number);
    },
  });
  const publish = useMutation({
    mutationFn: (number: number) =>
      publishWorkflowVersion({ id: workflowId, number }),
    onSuccess: async (version) => {
      await cache.invalidateQueries({ queryKey: ["workflows"] });
      setValidating(null);
      toast.success(
        t("settings:workflows.published", { number: version.number }),
      );
    },
  });
  const failed = [detail, saveDraft, validate, publish].find(
    (operation) => operation.isError,
  );

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <Button variant="ghost" size="xs" onClick={onBack}>
            <ChevronLeft aria-hidden="true" />
            {t("settings:workflows.back")}
          </Button>
          <h1 className="font-semibold text-2xl">
            {workflow?.name ?? t("settings:workflows.title")}
          </h1>
          {workflow ? (
            <p className="font-mono text-muted-foreground text-sm">
              {workflow.key}
            </p>
          ) : null}
        </div>
      </div>
      {failed ? (
        <Alert variant="error" role="alert">
          <AlertTitle>{t("settings:workflows.errorTitle")}</AlertTitle>
          <AlertDescription>
            {failed.error instanceof HttpError
              ? failed.error.message
              : t("settings:workflows.errorDescription")}
            {detail.isError ? (
              <Button className="w-fit" onClick={() => void detail.refetch()}>
                <RefreshCw aria-hidden="true" />
                {t("common:actions.retry")}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {detail.isLoading || !workflow ? (
        detail.isError ? null : (
          <div
            className="space-y-3"
            role="status"
            aria-label={t("settings:workflows.loading")}
          >
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )
      ) : (
        <>
          <section
            className="space-y-3"
            aria-label={t("settings:workflows.versions.title")}
          >
            <h2 className="font-medium text-lg">
              {t("settings:workflows.versions.title")}
            </h2>
            <Card>
              <CardContent className="p-0">
                <Table aria-label={t("settings:workflows.versions.title")}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t("settings:workflows.versions.number")}
                      </TableHead>
                      <TableHead>
                        {t("settings:workflows.versions.status")}
                      </TableHead>
                      <TableHead>
                        {t("settings:workflows.versions.transitions")}
                      </TableHead>
                      <TableHead className="text-end">
                        <span className="sr-only">
                          {t("settings:workflows.versions.actions")}
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...workflow.versions]
                      .sort((a, b) => b.number - a.number)
                      .map((version) => {
                        const status = versionStatus(workflow, version);
                        return (
                          <TableRow key={version.id}>
                            <TableCell>v{version.number}</TableCell>
                            <TableCell>
                              <Badge variant={STATUS_VARIANT[status]}>
                                {t(`settings:workflows.status.${status}`)}
                              </Badge>
                            </TableCell>
                            <TableCell>{version.transitions.length}</TableCell>
                            <TableCell className="text-end">
                              {status === "draft" && canManage ? (
                                <Button
                                  variant="outline"
                                  size="xs"
                                  disabled={validate.isPending}
                                  onClick={() =>
                                    validate.mutate(version.number)
                                  }
                                >
                                  {t("settings:workflows.versions.validate")}
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>
          <section
            className="space-y-3"
            aria-label={t("settings:workflows.transitions.title")}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <h2 className="font-medium text-lg">
                  {t("settings:workflows.transitions.title")}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {latest
                    ? t("settings:workflows.transitions.basedOn", {
                        number: latest.number,
                      })
                    : t("settings:workflows.transitions.none")}
                </p>
              </div>
              {canManage ? (
                <div className="flex items-center gap-2">
                  {working ? (
                    <>
                      <Badge variant="warning">
                        {t("settings:workflows.transitions.unsaved")}
                      </Badge>
                      <Button
                        variant="outline"
                        disabled={saveDraft.isPending}
                        onClick={() => setWorking(null)}
                      >
                        {t("settings:workflows.transitions.discard")}
                      </Button>
                      <Button
                        disabled={saveDraft.isPending}
                        onClick={() => saveDraft.mutate()}
                      >
                        {t("settings:workflows.transitions.saveDraft")}
                      </Button>
                    </>
                  ) : null}
                  <Button variant="outline" onClick={() => setAdding(true)}>
                    <Plus aria-hidden="true" />
                    {t("settings:workflows.transitions.add")}
                  </Button>
                </div>
              ) : null}
            </div>
            {shown.length === 0 ? (
              <Card>
                <CardContent className="p-0">
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>
                        {t("settings:workflows.transitions.emptyTitle")}
                      </EmptyTitle>
                      <EmptyDescription>
                        {t("settings:workflows.transitions.emptyDescription")}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table aria-label={t("settings:workflows.transitions.title")}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {t("settings:workflows.transitions.from")}
                        </TableHead>
                        <TableHead>
                          {t("settings:workflows.transitions.to")}
                        </TableHead>
                        <TableHead>
                          {t("settings:workflows.transitions.role")}
                        </TableHead>
                        <TableHead>
                          {t("settings:workflows.transitions.rules")}
                        </TableHead>
                        <TableHead className="text-end">
                          <span className="sr-only">
                            {t("settings:workflows.versions.actions")}
                          </span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shown.map((transition, index) => (
                        <TableRow
                          // The set has no natural key: a transition is its own identity.
                          key={rowKeys[index]}
                        >
                          <TableCell>
                            {stateName(transition.fromStateTemplateId)}
                          </TableCell>
                          <TableCell>
                            {stateName(transition.toStateTemplateId)}
                          </TableCell>
                          <TableCell>{roleName(transition.roleId)}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {transition.requiresApproval ? (
                                <Badge variant="info">
                                  {t("settings:workflows.transitions.approval")}
                                </Badge>
                              ) : null}
                              {transition.requiresCab ? (
                                <Badge variant="info">
                                  {t("settings:workflows.transitions.cab")}
                                </Badge>
                              ) : null}
                              {transition.guards.length > 0 ? (
                                <Badge variant="outline">
                                  {t("settings:workflows.transitions.guards", {
                                    count: transition.guards.length,
                                  })}
                                </Badge>
                              ) : null}
                              {transition.notePolicy !== "none" ? (
                                <Badge variant="outline">
                                  {t(
                                    `settings:workflows.notePolicy.${transition.notePolicy}`,
                                  )}
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-end">
                            {canManage ? (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={t(
                                  "settings:workflows.transitions.remove",
                                  {
                                    from: stateName(
                                      transition.fromStateTemplateId,
                                    ),
                                    to: stateName(transition.toStateTemplateId),
                                  },
                                )}
                                onClick={() =>
                                  setWorking(
                                    shown.filter((_, other) => other !== index),
                                  )
                                }
                              >
                                <Trash2 aria-hidden="true" />
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </section>
          <WorkflowAddTransitionDialog
            open={adding}
            onOpenChange={setAdding}
            states={states}
            roles={roles}
            onAdd={(transition) => setWorking([...shown, transition])}
          />
          <WorkflowValidationDialog
            open={validating !== null}
            onOpenChange={(open) => {
              if (!open) setValidating(null);
            }}
            versionNumber={validating?.number ?? 0}
            report={validating?.report}
            states={states}
            roles={roles}
            projects={projects}
            canPublish={canManage}
            publishing={publish.isPending}
            onPublish={() => {
              if (validating) publish.mutate(validating.number);
            }}
          />
        </>
      )}
    </>
  );
}
