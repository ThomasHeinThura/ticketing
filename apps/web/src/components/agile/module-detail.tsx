import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Progress,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from "@taskdesk/ui";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  addModuleWorkItems,
  FeatureDisabledError,
  getModule,
  requestModuleDeletion,
} from "@/fetchers/agile";
import useProjectByKey from "@/hooks/queries/agile/use-project-by-key";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { HttpError } from "@/lib/http-error";
import { type AgileDetailSearch, routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import { formatCalendarDate, MODULE_STATE_VARIANT } from "./agile-format";
import { BACKLOG_DRAG_PREFIX, CycleBacklogPanel } from "./cycle-backlog-panel";
import { FeatureOff } from "./feature-off";
import { ModuleForecastText } from "./module-forecast";
import { ModuleFormDialog } from "./module-form-dialog";
import { ScopeLoggedTime } from "./scope-logged-time";
import { ScopedWorkSurface } from "./scoped-work-surface";

const DROP_ID = "module-dropzone";

function DropSurface({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: DROP_ID,
    disabled: !active,
  });
  return (
    <div
      ref={setNodeRef}
      className={
        isOver
          ? "min-w-0 rounded-md ring-2 ring-primary ring-offset-2"
          : "min-w-0"
      }
    >
      {children}
    </div>
  );
}

/**
 * Module detail (`MO-1`..`MO-4`): progress, remaining work, the forecast range and the
 * project's own board or list narrowed to the module. Items without a module can be dragged
 * or added from the side list. A module is independent of cycles (`MO-3`).
 */
export function ModuleDetailScreen({
  projectKey,
  moduleId,
  search,
}: {
  projectKey: string;
  moduleId: string;
  search: AgileDetailSearch;
}) {
  const { t, i18n } = useTranslation("agile");
  const navigate = useNavigate();
  const cache = useQueryClient();
  const openPendingAction = useOpenPendingAction();
  const { project, workspaceId } = useProjectByKey(projectKey);
  const [editing, setEditing] = useState(false);
  const layout = search.layout === "list" ? "list" : "board";
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const query = useQuery({
    queryKey: ["agile", "module", moduleId],
    queryFn: () => getModule(moduleId),
    retry: (count, error) =>
      !(error instanceof FeatureDisabledError) &&
      !(error instanceof HttpError && error.status === 404) &&
      count < 2,
  });
  const add = useMutation({
    mutationFn: (keys: string[]) => addModuleWorkItems(moduleId, keys),
    onSuccess: async (result) => {
      if (result.added.length > 0)
        toast.success(t("backlog.added", { count: result.added.length }));
      if (result.refused.length > 0)
        toast.error(
          t("backlog.refused", {
            count: result.refused.length,
            reason: result.refused[0]?.reason ?? "",
          }),
        );
      await cache.invalidateQueries({ queryKey: ["agile"] });
      await cache.invalidateQueries({ queryKey: ["work-items"] });
    },
    onError: () => toast.error(t("backlog.addFailed")),
  });
  const remove = useMutation({
    mutationFn: () => requestModuleDeletion(moduleId),
    onSuccess: (pending) => openPendingAction(pending),
    onError: () => toast.error(t("modules.deleteFailed")),
  });

  if (query.error instanceof FeatureDisabledError)
    return <FeatureOff feature="modules" />;
  if (query.isLoading)
    return (
      <div
        className="mx-auto flex max-w-5xl flex-col gap-3 p-4"
        role="status"
        aria-label={t("common.loading")}
      >
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (query.isError || !query.data)
    return (
      <div className="mx-auto max-w-5xl p-4">
        <Alert variant="error">
          <AlertDescription>
            {query.error instanceof HttpError && query.error.status === 404
              ? t("modules.notFound")
              : t("modules.loadFailed")}
          </AlertDescription>
        </Alert>
      </div>
    );
  const module = query.data;
  const handleDragEnd = (event: DragEndEvent) => {
    const id = String(event.active.id);
    if (event.over?.id !== DROP_ID || !id.startsWith(BACKLOG_DRAG_PREFIX))
      return;
    add.mutate([id.slice(BACKLOG_DRAG_PREFIX.length)]);
  };
  const setLayout = (next: "board" | "list") =>
    void navigate({
      href: routes.projectModuleDetail.build(
        { projectKey, moduleId },
        next === "list" ? { layout: "list" } : {},
      ),
      replace: true,
    });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4">
      <PageTitle title={module.name} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">
            <Link
              to="/agent/projects/$projectKey/modules"
              params={{ projectKey }}
              className="hover:underline"
            >
              {t("modules.title")}
            </Link>
          </p>
          <h1 className="flex flex-wrap items-center gap-2 font-semibold text-lg">
            <span className="truncate">{module.name}</span>
            <Badge variant={MODULE_STATE_VARIANT[module.state]}>
              {t(`modules.state.${module.state}`)}
            </Badge>
          </h1>
          <p className="text-muted-foreground text-sm">
            {module.lead
              ? t("modules.lead", { name: module.lead.name ?? "-" })
              : t("modules.noLead")}
            {module.targetDate
              ? ` · ${t("modules.target", {
                  date: formatCalendarDate(module.targetDate, i18n.language),
                })}`
              : ""}
          </p>
          {module.description ? (
            <p className="mt-1 max-w-prose text-sm">{module.description}</p>
          ) : null}
        </div>
        {module.canManage ? (
          <div className="flex flex-wrap gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              {t("common.edit")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              <Trash2 aria-hidden="true" />
              {t("common.delete")}
            </Button>
          </div>
        ) : null}
      </div>

      <section
        aria-label={t("modules.progress.label")}
        className="flex max-w-xl flex-col gap-2"
      >
        <Progress
          value={module.progress.percent}
          aria-label={t("modules.progress.label")}
        />
        <p className="text-muted-foreground text-sm">
          {t("modules.progress.line", {
            completed: module.progress.completed,
            total: module.progress.total,
            remaining: module.progress.remaining,
          })}
        </p>
        <ModuleForecastText forecast={module.forecast} />
      </section>
      <ScopeLoggedTime
        workspaceId={workspaceId}
        projectId={project?.id}
        scope={{ moduleId }}
      />

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section
            aria-label={t("work.title")}
            className="flex min-w-0 flex-col gap-2"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium text-sm">{t("work.title")}</h2>
              <ToggleGroup
                value={[layout]}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next === "board" || next === "list") setLayout(next);
                }}
                size="sm"
                aria-label={t("work.layout")}
              >
                <ToggleGroupItem value="board">
                  {t("work.board")}
                </ToggleGroupItem>
                <ToggleGroupItem value="list">{t("work.list")}</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <DropSurface active={module.canEditItems}>
              {project ? (
                <ScopedWorkSurface
                  project={{ id: project.id, slug: project.slug }}
                  workspaceId={workspaceId}
                  scope={{ moduleId }}
                  layout={layout}
                  canEditItems={module.canEditItems}
                />
              ) : (
                <Skeleton className="h-40 w-full" />
              )}
            </DropSurface>
          </section>
          {project ? (
            <CycleBacklogPanel
              kind="module"
              project={{ id: project.id, slug: project.slug }}
              workspaceId={workspaceId}
              canAdd={module.canEditItems}
              onAdd={(key) => add.mutate([key])}
            />
          ) : null}
        </div>
      </DndContext>

      {editing ? (
        <ModuleFormDialog
          projectKey={projectKey}
          module={module}
          leadCandidates={module.leadCandidates}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}
