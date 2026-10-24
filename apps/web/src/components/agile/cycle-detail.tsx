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
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
} from "@taskdesk/ui";
import { CheckCheck, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  addCycleWorkItems,
  type CycleDetail,
  type CycleItemsResult,
  FeatureDisabledError,
  getBurndown,
  getCycle,
  requestCycleDeletion,
} from "@/fetchers/agile";
import useProjectByKey from "@/hooks/queries/agile/use-project-by-key";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { HttpError } from "@/lib/http-error";
import { type AgileDetailSearch, routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import {
  CYCLE_STATUS_VARIANT,
  formatCalendarDate,
  formatScopeAmount,
} from "./agile-format";
import { BurndownChart } from "./burndown-chart";
import { CompleteCycleDialog } from "./complete-cycle-dialog";
import { BACKLOG_DRAG_PREFIX, CycleBacklogPanel } from "./cycle-backlog-panel";
import { CycleFormDialog } from "./cycle-form-dialog";
import { FeatureOff } from "./feature-off";
import { ScopedWorkSurface } from "./scoped-work-surface";

const DROP_ID = "cycle-dropzone";

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-semibold text-lg">{value}</p>
    </div>
  );
}

/** `CY-7`: scope, completed, in progress and not started in the cycle's unit. */
export function CycleSummaryTiles({ cycle }: { cycle: CycleDetail }) {
  const { t } = useTranslation("agile");
  const { summary } = cycle;
  const amount = (bucket: { count: number; points: number }) =>
    summary.unit === "count"
      ? String(bucket.count)
      : `${formatScopeAmount(bucket.points, summary.unit)} (${bucket.count})`;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryTile label={t("summary.scope")} value={amount(summary.total)} />
        <SummaryTile
          label={t("summary.completed")}
          value={amount(summary.completed)}
        />
        <SummaryTile
          label={t("summary.inProgress")}
          value={amount(summary.inProgress)}
        />
        <SummaryTile
          label={t("summary.notStarted")}
          value={amount(summary.notStarted)}
        />
      </div>
      {summary.unit !== "count" && summary.unestimated.count > 0 ? (
        <p className="text-muted-foreground text-xs" data-testid="unestimated">
          {t("summary.unestimated", {
            count: summary.unestimated.count,
            percent: Math.round(summary.unestimated.share * 100),
          })}
        </p>
      ) : null}
    </div>
  );
}

/** `CY-8`: what was added or removed after the cycle started, retrospective adds marked. */
export function ScopeChangeLog({ cycle }: { cycle: CycleDetail }) {
  const { t, i18n } = useTranslation("agile");
  if (cycle.scopeChanges.length === 0)
    return (
      <p className="text-muted-foreground text-sm" data-testid="scope-empty">
        {t("scope.empty")}
      </p>
    );
  return (
    <Table data-testid="scope-changes">
      <TableHeader>
        <TableRow>
          <TableHead>{t("scope.item")}</TableHead>
          <TableHead>{t("scope.change")}</TableHead>
          <TableHead>{t("scope.when")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cycle.scopeChanges.map((change) => (
          <TableRow key={`${change.workItemKey}-${change.kind}-${change.at}`}>
            <TableCell>
              <span className="font-mono text-xs">{change.workItemKey}</span>{" "}
              {change.title}
            </TableCell>
            <TableCell className="flex flex-wrap gap-1">
              <Badge
                variant={change.kind === "added" ? "warning" : "secondary"}
              >
                {t(`scope.kind.${change.kind}`)}
              </Badge>
              {change.retrospective ? (
                <Badge variant="info">{t("scope.retrospective")}</Badge>
              ) : null}
            </TableCell>
            <TableCell className="text-muted-foreground text-xs">
              {new Intl.DateTimeFormat(i18n.language, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(change.at))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

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
      data-testid="cycle-dropzone"
    >
      {children}
    </div>
  );
}

function reportResult(
  result: CycleItemsResult,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (result.refused.length > 0)
    toast.error(
      t("backlog.refused", {
        count: result.refused.length,
        reason: result.refused[0]?.reason ?? "",
      }),
    );
  if (result.added.length > 0)
    toast.success(t("backlog.added", { count: result.added.length }));
}

/**
 * Cycle detail (`CY-5`..`CY-9`): summary, burndown (with its table), the scope-change log and
 * the project's own board or list narrowed to the cycle, with the open backlog beside it to
 * drag work in. Planners (`project:manage_settings`) edit, complete or delete; anyone who can
 * update work items can add and remove them.
 */
export function CycleDetailScreen({
  projectKey,
  cycleId,
  search,
}: {
  projectKey: string;
  cycleId: string;
  search: AgileDetailSearch;
}) {
  const { t, i18n } = useTranslation("agile");
  const navigate = useNavigate();
  const cache = useQueryClient();
  const openPendingAction = useOpenPendingAction();
  const { project, workspaceId } = useProjectByKey(projectKey);
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const layout = search.layout === "list" ? "list" : "board";
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const cycleQuery = useQuery({
    queryKey: ["agile", "cycle", cycleId],
    queryFn: () => getCycle(cycleId),
    retry: (count, error) =>
      !(error instanceof FeatureDisabledError) &&
      !(error instanceof HttpError && error.status === 404) &&
      count < 2,
  });
  const burndownQuery = useQuery({
    queryKey: ["agile", "cycle", cycleId, "burndown"],
    queryFn: () => getBurndown(cycleId),
    enabled: cycleQuery.isSuccess,
  });

  const refreshAll = async () => {
    await cache.invalidateQueries({ queryKey: ["agile"] });
    await cache.invalidateQueries({ queryKey: ["work-items"] });
  };
  const add = useMutation({
    mutationFn: (keys: string[]) => addCycleWorkItems(cycleId, keys),
    onSuccess: async (result) => {
      reportResult(result, t);
      await refreshAll();
    },
    onError: () => toast.error(t("backlog.addFailed")),
  });
  const remove = useMutation({
    mutationFn: () => requestCycleDeletion(cycleId),
    onSuccess: (pending) => openPendingAction(pending),
    onError: () => toast.error(t("cycles.deleteFailed")),
  });

  if (cycleQuery.error instanceof FeatureDisabledError)
    return <FeatureOff feature="cycles" />;
  if (cycleQuery.isLoading)
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
  if (cycleQuery.isError || !cycleQuery.data)
    return (
      <div className="mx-auto max-w-5xl p-4">
        <Alert variant="error">
          <AlertDescription>
            {cycleQuery.error instanceof HttpError &&
            cycleQuery.error.status === 404
              ? t("cycles.notFound")
              : t("cycles.loadFailed")}
          </AlertDescription>
        </Alert>
      </div>
    );

  const cycle = cycleQuery.data;
  const handleDragEnd = (event: DragEndEvent) => {
    const id = String(event.active.id);
    if (event.over?.id !== DROP_ID || !id.startsWith(BACKLOG_DRAG_PREFIX))
      return;
    add.mutate([id.slice(BACKLOG_DRAG_PREFIX.length)]);
  };
  const setLayout = (next: "board" | "list") =>
    void navigate({
      href: routes.projectCycleDetail.build(
        { projectKey, cycleId },
        next === "list" ? { layout: "list" } : {},
      ),
      replace: true,
    });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4">
      <PageTitle title={cycle.name} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">
            <Link
              to="/agent/projects/$projectKey/cycles"
              params={{ projectKey }}
              className="hover:underline"
            >
              {t("cycles.title")}
            </Link>
          </p>
          <h1 className="flex flex-wrap items-center gap-2 font-semibold text-lg">
            <span className="truncate">{cycle.name}</span>
            <Badge variant={CYCLE_STATUS_VARIANT[cycle.status]}>
              {t(`cycles.status.${cycle.status}`)}
            </Badge>
          </h1>
          <p className="text-muted-foreground text-sm">
            {formatCalendarDate(cycle.startDate, i18n.language)}
            {" – "}
            {formatCalendarDate(cycle.endDate, i18n.language)}
          </p>
        </div>
        {cycle.canManage ? (
          <div className="flex flex-wrap gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              {t("common.edit")}
            </Button>
            {!cycle.completedAt ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCompleting(true)}
              >
                <CheckCheck aria-hidden="true" />
                {t("complete.action")}
              </Button>
            ) : null}
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

      <CycleSummaryTiles cycle={cycle} />

      <section aria-label={t("burndown.title")} className="flex flex-col gap-2">
        <h2 className="font-medium text-sm">{t("burndown.title")}</h2>
        {burndownQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : burndownQuery.isError || !burndownQuery.data ? (
          <Alert variant="error">
            <AlertDescription>{t("burndown.loadFailed")}</AlertDescription>
          </Alert>
        ) : (
          <BurndownChart burndown={burndownQuery.data} />
        )}
      </section>

      <section aria-label={t("scope.title")} className="flex flex-col gap-2">
        <h2 className="font-medium text-sm">{t("scope.title")}</h2>
        <ScopeChangeLog cycle={cycle} />
      </section>

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
            <DropSurface active={cycle.canEditItems}>
              {project ? (
                <ScopedWorkSurface
                  project={{ id: project.id, slug: project.slug }}
                  workspaceId={workspaceId}
                  scope={{ cycleId }}
                  layout={layout}
                  canEditItems={cycle.canEditItems}
                />
              ) : (
                <Skeleton className="h-40 w-full" />
              )}
            </DropSurface>
          </section>
          {project ? (
            <CycleBacklogPanel
              project={{ id: project.id, slug: project.slug }}
              workspaceId={workspaceId}
              canAdd={cycle.canEditItems}
              onAdd={(key) => add.mutate([key])}
            />
          ) : null}
        </div>
      </DndContext>

      {editing ? (
        <CycleFormDialog
          projectKey={projectKey}
          cycle={cycle}
          onClose={() => setEditing(false)}
        />
      ) : null}
      {completing ? (
        <CompleteCycleDialog
          cycle={cycle}
          onClose={() => setCompleting(false)}
        />
      ) : null}
    </div>
  );
}
