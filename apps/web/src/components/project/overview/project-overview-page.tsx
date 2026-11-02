import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertTitle,
  Badge,
  Button,
  Card,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  Progress,
  ProgressIndicator,
  ProgressTrack,
  Skeleton,
} from "@taskdesk/ui";
import {
  AlertTriangle,
  Archive,
  Ellipsis,
  Info,
  Pencil,
  Plus,
} from "lucide-react";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import archiveProject from "@/fetchers/project/archive-project";
import type getProject from "@/fetchers/project/get-project";
import {
  getProjectOverview,
  type ProjectOverview,
  projectOverviewKeys,
} from "@/fetchers/project/overview";
import useProjectByKey from "@/hooks/queries/agile/use-project-by-key";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import { ContractPanel } from "./contract-panel";
import { EditSummaryDialog } from "./edit-summary-dialog";
import { MilestonesPanel } from "./milestones-panel";
import {
  formatDate,
  HealthBadge,
  Panel,
  StatusBadge,
  useFailureMessage,
} from "./overview-shared";

// The existing create-work-item modal; loaded on first open so its editor stays out of this chunk.
const CreateTaskModal = lazy(
  () => import("@/components/shared/modals/create-task-modal"),
);

type ProjectDetail = Awaited<ReturnType<typeof getProject>>;

function Kpi({
  label,
  children,
  hint,
  testId,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  testId?: string;
}) {
  return (
    <Card className="min-w-0 px-4 py-3" data-testid={testId}>
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="mt-1 flex min-h-7 items-center gap-2 font-semibold text-lg tabular-nums">
        {children}
      </div>
      {hint ? (
        <div className="mt-1 text-muted-foreground text-xs">{hint}</div>
      ) : null}
    </Card>
  );
}

function SummaryField({
  label,
  value,
  emptyLabel,
  className,
}: {
  label: string;
  value: string | null;
  emptyLabel: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="font-medium text-muted-foreground text-xs">{label}</dt>
      <dd
        className={
          value
            ? "whitespace-pre-wrap break-words text-sm"
            : "text-muted-foreground text-sm italic"
        }
      >
        {value ?? emptyLabel}
      </dd>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-muted-foreground text-xs">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm">{value}</dd>
    </div>
  );
}

function SummaryPanel({ project }: { project: ProjectDetail }) {
  const { t, i18n } = useTranslation("projectOverview");
  const empty = t("summary.empty");
  return (
    <Panel title={t("summary.title")} testId="project-summary-panel">
      {/* Each dt/dd pair is a direct child of the dl (axe definition-list / dlitem). */}
      <dl className="grid gap-3 sm:grid-cols-2">
        <SummaryField
          label={t("summary.objective")}
          value={project.objective}
          emptyLabel={empty}
          className="sm:col-span-2"
        />
        <SummaryField
          label={t("summary.inScope")}
          value={project.inScope}
          emptyLabel={empty}
        />
        <SummaryField
          label={t("summary.outOfScope")}
          value={project.outOfScope}
          emptyLabel={empty}
        />
        <SummaryField
          label={t("summary.successCriteria")}
          value={project.successCriteria}
          emptyLabel={empty}
          className="sm:col-span-2"
        />
        <div className="flex flex-col gap-0.5 rounded-lg border px-3 py-2 sm:col-span-2">
          <dt className="flex flex-wrap items-baseline justify-between gap-2 font-medium text-muted-foreground text-xs">
            {t("summary.statusNote")}
            {project.statusNoteAt ? (
              <span className="font-normal">
                {t("summary.updated", {
                  date: new Intl.DateTimeFormat(i18n.language, {
                    dateStyle: "medium",
                  }).format(new Date(project.statusNoteAt)),
                })}
              </span>
            ) : null}
          </dt>
          <dd
            className={
              project.statusNote
                ? "whitespace-pre-wrap break-words text-sm"
                : "text-muted-foreground text-sm italic"
            }
          >
            {project.statusNote ?? empty}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

function FactsPanel({ overview }: { overview: ProjectOverview }) {
  const { t, i18n } = useTranslation("projectOverview");
  const notSet = (
    <span className="text-muted-foreground">{t("facts.notSet")}</span>
  );
  const { facts } = overview;
  return (
    <Panel title={t("facts.title")} testId="project-facts-panel">
      <dl className="flex flex-col divide-y">
        <FactRow
          label={t("facts.customer")}
          value={facts.customerName ?? t("facts.internal")}
        />
        <FactRow
          label={t("facts.start")}
          value={
            facts.startDate
              ? formatDate(facts.startDate, i18n.language)
              : notSet
          }
        />
        <FactRow
          label={t("facts.end")}
          value={
            facts.endDate ? formatDate(facts.endDate, i18n.language) : notSet
          }
        />
        <FactRow
          label={t("facts.manager")}
          value={facts.managerName ?? notSet}
        />
        <FactRow
          label={t("facts.defaultAssignee")}
          value={facts.defaultAssigneeName ?? notSet}
        />
        {overview.kind === "managed_service" ? (
          <FactRow
            label={t("facts.supportLevel")}
            value={facts.supportLevel ?? notSet}
          />
        ) : null}
        <FactRow
          label={t("facts.calendar")}
          value={facts.serviceCalendarName ?? notSet}
        />
      </dl>
    </Panel>
  );
}

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;

function ServiceLevelsPanel({ overview }: { overview: ProjectOverview }) {
  const { t } = useTranslation("projectOverview");
  const { serviceLevels } = overview;
  const formatTarget = (minutes: number) =>
    minutes % 1440 === 0
      ? t("serviceLevels.days", { count: minutes / 1440 })
      : minutes % 60 === 0
        ? t("serviceLevels.hours", { count: minutes / 60 })
        : t("serviceLevels.minutes", { count: minutes });
  const types = [
    ...new Set(serviceLevels.goals.map((goal) => goal.workItemTypeName)),
  ];
  const target = (type: string, priority: string, metric: string) =>
    serviceLevels.goals.find(
      (goal) =>
        goal.workItemTypeName === type &&
        goal.priority === priority &&
        goal.metric === metric,
    )?.targetMinutes;
  return (
    <Panel
      title={t("serviceLevels.title")}
      testId="project-service-levels-panel"
    >
      <p className="text-muted-foreground text-xs">
        {serviceLevels.policyName
          ? t(`serviceLevels.source.${serviceLevels.source}`, {
              name: serviceLevels.policyName,
            })
          : t("serviceLevels.none")}
      </p>
      {types.length === 0 ? (
        serviceLevels.policyName ? (
          <p className="text-muted-foreground text-sm">
            {t("serviceLevels.noTargets")}
          </p>
        ) : null
      ) : (
        <div className="flex flex-col gap-4">
          {types.map((type) => (
            <div
              key={type}
              data-testid="project-service-level-type"
              className="flex flex-col gap-1.5"
            >
              <span className="font-medium text-xs">{type}</span>
              {/* Column labels for sighted users; each value carries its own label for
                  assistive technology, so the dl stays one dt/dd group per priority. */}
              <div
                aria-hidden="true"
                className="grid grid-cols-3 gap-x-3 border-b pb-1.5 text-muted-foreground text-xs"
              >
                <span>{t("serviceLevels.priority")}</span>
                <span>{t("serviceLevels.firstResponse")}</span>
                <span>{t("serviceLevels.resolution")}</span>
              </div>
              <dl className="flex flex-col divide-y text-sm">
                {PRIORITIES.map((priority) => {
                  const response = target(type, priority, "first_response");
                  const resolution = target(type, priority, "resolution");
                  if (response === undefined && resolution === undefined)
                    return null;
                  return (
                    <div
                      key={priority}
                      className="grid grid-cols-3 gap-x-3 py-1.5"
                      data-testid="project-service-level-row"
                    >
                      <dt>{t(`serviceLevels.priorities.${priority}`)}</dt>
                      <dd className="tabular-nums">
                        <span className="sr-only">
                          {t("serviceLevels.firstResponse")}{" "}
                        </span>
                        {response === undefined ? "—" : formatTarget(response)}
                      </dd>
                      <dd className="tabular-nums">
                        <span className="sr-only">
                          {t("serviceLevels.resolution")}{" "}
                        </span>
                        {resolution === undefined
                          ? "—"
                          : formatTarget(resolution)}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/**
 * `/agent/projects/{key}`: the project Overview (S3/S3b), modelled on v1's engagement summary
 * inside the Kaneo project shell. Reads need `project:read`; edit controls appear only with
 * `project:update` (summary, milestones) or `project:manage_settings` (contract).
 */
export function ProjectOverviewPage({ projectKey }: { projectKey: string }) {
  const { t } = useTranslation("projectOverview");
  const {
    project: listed,
    workspaceId,
    isLoading,
  } = useProjectByKey(projectKey);
  const { data: detail } = useGetProject({
    id: listed?.id ?? "",
    workspaceId,
  });
  const project = (detail ?? listed) as ProjectDetail | undefined;
  const projectId = project?.id ?? "";
  const { canUpdateProjects, canManageProjectSettings, canCreateTasks } =
    useWorkspacePermission();
  const canUpdate = canUpdateProjects();
  const canManage = canManageProjectSettings();
  const canCreate = canCreateTasks();
  const [editingSummary, setEditingSummary] = useState(false);
  const [creating, setCreating] = useState(false);
  const [hasOpenedCreate, setHasOpenedCreate] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const failure = useFailureMessage();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const archive = useMutation({
    mutationFn: () => archiveProject({ id: projectId }),
    onSuccess: async () => {
      setConfirmingArchive(false);
      toast.success(t("header.archivedToast", { name: project?.name ?? "" }));
      // The default project list leaves archived projects out, so this page cannot stay.
      await navigate({ to: routes.agentHome.path });
      await cache.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) =>
      toast.error(
        error instanceof HttpError && error.status === 409
          ? t("header.archiveHasChildren")
          : failure(error),
      ),
  });
  const overview = useQuery({
    queryKey: projectOverviewKeys.overview(projectId),
    queryFn: () => getProjectOverview(projectId),
    enabled: Boolean(projectId),
    // Counts derive from work items, which change on other tabs; the app-wide default
    // (refetchOnMount: false) would keep showing the numbers from the first visit.
    refetchOnMount: "always",
  });

  if (isLoading || (project && overview.isLoading))
    return (
      <div
        className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6"
        role="status"
        aria-label={t("loading")}
      >
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (!project || overview.isError || !overview.data)
    return (
      <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
        <Alert variant="error">
          <AlertDescription>
            {project ? t("loadFailed") : t("notFound")}
          </AlertDescription>
          {project ? (
            <AlertAction>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void overview.refetch()}
              >
                {t("common.retry")}
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      </div>
    );

  const data = overview.data;
  const { counts } = data;
  const donePct =
    counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;

  return (
    <div
      className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6"
      data-testid="project-overview-page"
    >
      <PageTitle title={t("pageTitle", { name: project.name })} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="flex min-w-0 items-center gap-2 font-semibold text-lg">
            <span className="truncate">{project.name}</span>
            {data.archived ? (
              <Badge variant="secondary">{t("header.archived")}</Badge>
            ) : null}
          </h1>
          <div
            className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground text-xs"
            data-testid="project-overview-header-line"
          >
            <span>{data.facts.customerName ?? t("facts.internal")}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{project.slug}</span>
            <span aria-hidden="true">·</span>
            <Badge variant="outline">{t(`kind.${data.kind}`)}</Badge>
            <StatusBadge status={data.status} />
            <HealthBadge health={data.health} />
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {t("header.open", { count: counts.open })}
            </span>
            <span aria-hidden="true">·</span>
            <span
              className={
                counts.breached > 0
                  ? "text-destructive-foreground tabular-nums"
                  : "tabular-nums"
              }
            >
              {t("header.breached", { count: counts.breached })}
            </span>
          </div>
        </div>
        {canUpdate || canCreate ? (
          <div
            className="flex flex-wrap items-center gap-2"
            data-testid="project-overview-actions"
          >
            {canUpdate ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditingSummary(true)}
                data-testid="project-overview-edit-summary"
              >
                <Pencil aria-hidden="true" />
                {t("summary.edit")}
              </Button>
            ) : null}
            {canCreate && !data.archived ? (
              <Button
                size="sm"
                onClick={() => {
                  setHasOpenedCreate(true);
                  setCreating(true);
                }}
                data-testid="project-overview-new-item"
              >
                <Plus aria-hidden="true" />
                {t("header.newItem")}
              </Button>
            ) : null}
            {canUpdate && !data.archived ? (
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("header.moreActions")}
                      data-testid="project-overview-more"
                    />
                  }
                >
                  <Ellipsis aria-hidden="true" />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuItem
                    variant="destructive"
                    onClick={() => setConfirmingArchive(true)}
                    data-testid="project-overview-archive"
                  >
                    <Archive className="size-4" aria-hidden="true" />
                    {t("header.archive")}
                  </MenuItem>
                </MenuPopup>
              </Menu>
            ) : null}
          </div>
        ) : null}
      </header>

      {counts.blockingPrerequisitesOutstanding > 0 ? (
        <Alert variant="warning" data-testid="project-overview-attention">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>
            {t("attention.blocking", {
              count: counts.blockingPrerequisitesOutstanding,
            })}
          </AlertDescription>
          <AlertAction>
            <Button
              size="sm"
              variant="outline"
              render={
                <Link
                  to={routes.projectPrerequisites.path}
                  params={{ projectKey }}
                />
              }
            >
              {t("attention.seeWaiting")}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      {data.compositionWarnings.length > 0 ? (
        <Alert variant="info" data-testid="project-overview-composition">
          <Info aria-hidden="true" />
          <AlertTitle>{t("composition.title")}</AlertTitle>
          <AlertDescription>
            {data.compositionWarnings
              .map((code) => t(`composition.${code}`))
              .join(" ")}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("kpi.health")} testId="project-kpi-health">
          <HealthBadge health={data.health} />
        </Kpi>
        <Kpi
          label={t("kpi.status")}
          testId="project-kpi-status"
          hint={t(`kind.${data.kind}`)}
        >
          <StatusBadge status={data.status} />
        </Kpi>
        <Kpi
          label={t("kpi.workComplete")}
          testId="project-kpi-work"
          hint={t("kpi.workBreakdown", {
            inProgress: counts.inProgress,
            waiting: counts.waiting,
          })}
        >
          <span>
            {counts.done}
            <span className="text-muted-foreground text-sm">
              /{counts.total}
            </span>
          </span>
          <Progress
            value={donePct}
            aria-label={t("kpi.workComplete")}
            className="ms-auto w-16"
          >
            <ProgressTrack>
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>
        </Kpi>
        <Kpi
          label={t("kpi.blocking")}
          testId="project-kpi-blocking"
          hint={t("kpi.blockingOf", { count: counts.prerequisites })}
        >
          <span
            className={
              counts.blockingPrerequisitesOutstanding > 0
                ? "text-warning-foreground"
                : undefined
            }
          >
            {counts.blockingPrerequisitesOutstanding}
          </span>
        </Kpi>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <SummaryPanel project={project} />
          <MilestonesPanel projectId={project.id} canUpdate={canUpdate} />
          {data.kind === "managed_service" ? (
            <ServiceLevelsPanel overview={data} />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <FactsPanel overview={data} />
          <ContractPanel projectId={project.id} canManage={canManage} />
        </div>
      </div>

      {editingSummary ? (
        <EditSummaryDialog
          projectId={project.id}
          initial={{
            objective: project.objective,
            inScope: project.inScope,
            outOfScope: project.outOfScope,
            successCriteria: project.successCriteria,
            statusNote: project.statusNote,
            status: project.status,
          }}
          onClose={() => setEditingSummary(false)}
        />
      ) : null}
      {hasOpenedCreate ? (
        <Suspense fallback={null}>
          <CreateTaskModal
            open={creating}
            projectId={project.id}
            status="to-do"
            onClose={() => {
              setCreating(false);
              // The modal only invalidates the task lists; refresh the counts here.
              void cache.invalidateQueries({
                queryKey: projectOverviewKeys.overview(project.id),
              });
            }}
          />
        </Suspense>
      ) : null}
      <AlertDialog
        open={confirmingArchive}
        onOpenChange={(open) => {
          if (!open && !archive.isPending) setConfirmingArchive(false);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("header.archiveTitle", { name: project.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("header.archiveDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" disabled={archive.isPending}>
                  {t("common.cancel")}
                </Button>
              }
            />
            <Button
              variant="destructive"
              loading={archive.isPending}
              onClick={() => archive.mutate()}
              data-testid="project-overview-archive-confirm"
            >
              {t("header.archiveConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

export default ProjectOverviewPage;
