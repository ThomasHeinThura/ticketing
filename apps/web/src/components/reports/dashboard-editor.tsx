import {
  DndContext,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from "@taskdesk/ui";
import {
  ArrowLeftRight,
  ArrowUpDown,
  ChevronLeft,
  Ellipsis,
  GripVertical,
  Minus,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PickerPopover } from "@/components/common/picker-popover";
import PageTitle from "@/components/page-title";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import {
  createDashboard,
  type DashboardDetail,
  type DashboardWidget,
  ReportRuleError,
  requestDashboardDeletion,
  updateDashboard,
} from "@/fetchers/report";
import { getSavedViews } from "@/fetchers/saved-views";
import {
  reportKeys,
  useDashboard,
  useDashboards,
  useReportCatalogue,
} from "@/hooks/queries/report";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useDndAccessibility } from "@/hooks/use-dnd-accessibility";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import {
  type Cell,
  findFreeSpot,
  MAX_WIDGETS,
  type Move,
  moveByPixels,
  resize,
} from "@/lib/dashboard-layout";
import type { DashboardSearch } from "@/lib/report-search";
import { routes } from "@/lib/routes";
import { savedViewKeys } from "@/lib/saved-view-keys";
import { toast } from "@/lib/toast";
import {
  DashboardGrid,
  GRID_GAP,
  gridItemStyle,
  ROW_HEIGHT,
  readingOrder,
  useWideGrid,
} from "./dashboard-grid";
import { DashboardWidgetCard } from "./dashboard-widget";
import { ReportError } from "./report-detail";

type Draft = DashboardWidget;
let draftCounter = 0;
const isNew = (id: string) => id.startsWith("new-");

function stripId(widget: Draft) {
  const { id, ...rest } = widget;
  return isNew(id) ? rest : { id, ...rest };
}

/** The refusal, in words: a stale version, an overlap, a taken name. */
function useRuleMessage() {
  const { t } = useTranslation();
  return (error: unknown) =>
    error instanceof ReportRuleError
      ? t(`reports:errors.rule.${error.code}`, { defaultValue: error.message })
      : error instanceof Error
        ? error.message
        : t("reports:errors.failed.description");
}

function DraggableWidget({
  widget,
  title,
  wide,
  canResize,
  children,
  onResize,
  onRemove,
}: {
  widget: Draft;
  title: string;
  wide: boolean;
  canResize: boolean;
  children: (controls: React.ReactNode) => React.ReactNode;
  onResize: (dw: number, dh: number) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: widget.id });
  return (
    <div
      ref={setNodeRef}
      data-testid="editor-widget"
      style={{
        ...gridItemStyle(widget, wide),
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 20 : undefined,
      }}
      className={`relative min-w-0 ${isDragging ? "opacity-80 shadow-lg" : ""}`}
    >
      {children(
        <div className="flex min-w-0 max-w-full items-center justify-end gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("reports:editor.move", { title })}
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden="true" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("reports:editor.widgetActions", { title })}
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-auto p-2"
              aria-label={t("reports:editor.widgetActions", { title })}
            >
              <div className="flex items-center gap-0.5">
                {canResize ? (
                  <>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("reports:editor.narrower", { title })}
                      onClick={() => onResize(-1, 0)}
                    >
                      <Minus aria-hidden="true" />
                    </Button>
                    <ArrowLeftRight
                      aria-hidden="true"
                      className="size-3 text-muted-foreground"
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("reports:editor.wider", { title })}
                      onClick={() => onResize(1, 0)}
                    >
                      <Plus aria-hidden="true" />
                    </Button>
                    <span
                      aria-hidden="true"
                      className="mx-0.5 h-4 w-px bg-border"
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("reports:editor.shorter", { title })}
                      onClick={() => onResize(0, -1)}
                    >
                      <Minus aria-hidden="true" />
                    </Button>
                    <ArrowUpDown
                      aria-hidden="true"
                      className="size-3 text-muted-foreground"
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("reports:editor.taller", { title })}
                      onClick={() => onResize(0, 1)}
                    >
                      <Plus aria-hidden="true" />
                    </Button>
                    <span
                      aria-hidden="true"
                      className="mx-0.5 h-4 w-px bg-border"
                    />
                  </>
                ) : null}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("reports:editor.remove", { title })}
                  onClick={onRemove}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>,
      )}
      <span className="sr-only">
        {t("reports:editor.position", {
          x: widget.x + 1,
          y: widget.y + 1,
          w: widget.w,
          h: widget.h,
        })}
      </span>
    </div>
  );
}

type AddChoice = { value: string; label: string };

function AddWidgetDialog({
  reports,
  views,
  onAdd,
  onClose,
}: {
  reports: AddChoice[];
  views: AddChoice[];
  onAdd: (input: {
    source: string;
    chartType: Draft["chartType"];
    window: string;
  }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState(
    reports[0]?.value ?? views[0]?.value ?? "",
  );
  const [chartType, setChartType] = useState<Draft["chartType"]>("bar");
  const [window, setWindow] = useState("30");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{t("reports:editor.addTitle")}</DialogTitle>
          <DialogDescription>
            {t("reports:editor.addDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6">
          <div className="space-y-1">
            <Label htmlFor="widget-source">{t("reports:editor.source")}</Label>
            <PickerPopover
              id="widget-source"
              value={source || undefined}
              className="w-full"
              options={[
                ...reports,
                ...views.map((option) => ({
                  value: option.value,
                  label: `${option.label} (${t("reports:tiers.chart")})`,
                })),
              ]}
              onChange={setSource}
            />
          </div>
          <div className="space-y-1">
            <Label id="widget-chart-label">
              {t("reports:builder.chartType")}
            </Label>
            <ToggleGroup
              aria-labelledby="widget-chart-label"
              value={[chartType]}
              onValueChange={(values) => {
                const next = (["number", "bar", "line", "table"] as const).find(
                  (candidate) => candidate === values[values.length - 1],
                );
                if (next) setChartType(next);
              }}
            >
              {(["number", "bar", "line", "table"] as const).map(
                (candidate) => (
                  <ToggleGroupItem key={candidate} value={candidate}>
                    {t(`reports:builder.chartTypes.${candidate}`)}
                  </ToggleGroupItem>
                ),
              )}
            </ToggleGroup>
          </div>
          <div className="space-y-1">
            <Label id="widget-window-label">
              {t("reports:filters.window")}
            </Label>
            <ToggleGroup
              aria-labelledby="widget-window-label"
              value={[window]}
              onValueChange={(values) => {
                const next = values[values.length - 1];
                if (next) setWindow(next);
              }}
            >
              {["7", "30", "60", "90"].map((candidate) => (
                <ToggleGroupItem key={candidate} value={candidate}>
                  {t("reports:filters.days", { count: Number(candidate) })}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            disabled={!source}
            onClick={() => {
              onAdd({ source, chartType, window });
              onClose();
            }}
          >
            {t("reports:editor.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewDashboardDialog({
  workspaceId,
  canManageWorkspace,
  onClose,
}: {
  workspaceId: string;
  canManageWorkspace: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const message = useRuleMessage();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"personal" | "workspace">("personal");
  const create = useMutation({
    mutationFn: () =>
      createDashboard({ workspaceId, name: name.trim(), scope, widgets: [] }),
    onSuccess: async (dashboard) => {
      await queryClient.invalidateQueries({
        queryKey: reportKeys.dashboards(workspaceId),
      });
      onClose();
      void navigate({
        to: routes.agentDashboardEdit.path,
        search: { id: dashboard.id },
      });
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !create.isPending && onClose()}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{t("reports:editor.newTitle")}</DialogTitle>
          <DialogDescription>
            {t("reports:editor.newDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !create.isPending) create.mutate();
          }}
        >
          <div className="space-y-4 px-6">
            <div className="space-y-1">
              <Label htmlFor="dashboard-new-name">
                {t("reports:editor.name")}
              </Label>
              <Input
                id="dashboard-new-name"
                autoFocus
                required
                maxLength={120}
                value={name}
                disabled={create.isPending}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            {canManageWorkspace ? (
              <div className="space-y-1">
                <Label htmlFor="dashboard-new-scope">
                  {t("reports:editor.scope")}
                </Label>
                <Select
                  value={scope}
                  onValueChange={(next) =>
                    setScope(next === "workspace" ? "workspace" : "personal")
                  }
                >
                  <SelectTrigger id="dashboard-new-scope">
                    <SelectValue>
                      {scope === "workspace"
                        ? t("reports:dashboard.workspaceScope")
                        : t("reports:dashboard.personalScope")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="personal">
                      {t("reports:dashboard.personalScope")}
                    </SelectItem>
                    <SelectItem value="workspace">
                      {t("reports:dashboard.workspaceScope")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {create.error ? (
              <Alert variant="error">
                <AlertDescription>{message(create.error)}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={create.isPending}
              onClick={onClose}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {t("reports:editor.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditorBody({
  workspaceId,
  dashboard,
  canManageWorkspace,
}: {
  workspaceId: string;
  dashboard: DashboardDetail;
  canManageWorkspace: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const message = useRuleMessage();
  const openPending = useOpenPendingAction();
  const { user } = useAuth();
  const wide = useWideGrid();
  const catalogue = useReportCatalogue(workspaceId);
  const views = useQuery({
    queryKey: savedViewKeys.list(workspaceId, user?.id),
    queryFn: () => getSavedViews(workspaceId),
  });
  const [name, setName] = useState(dashboard.name);
  const [widgets, setWidgets] = useState<Draft[]>(dashboard.widgets);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const metrics = useRef({ column: 80, row: ROW_HEIGHT + GRID_GAP });
  const editable = dashboard.canEdit;
  const dirty =
    name !== dashboard.name ||
    JSON.stringify(widgets) !== JSON.stringify(dashboard.widgets);

  const measure = useCallback(() => {
    const width = gridRef.current?.clientWidth ?? 0;
    if (width > 0)
      metrics.current = {
        column: (width + GRID_GAP) / 12,
        row: ROW_HEIGHT + GRID_GAP,
      };
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const coordinateGetter: KeyboardCoordinateGetter = (
    event,
    { currentCoordinates },
  ) => {
    const { column, row } = metrics.current;
    switch (event.code) {
      case "ArrowRight":
        return { ...currentCoordinates, x: currentCoordinates.x + column };
      case "ArrowLeft":
        return { ...currentCoordinates, x: currentCoordinates.x - column };
      case "ArrowDown":
        return { ...currentCoordinates, y: currentCoordinates.y + row };
      case "ArrowUp":
        return { ...currentCoordinates, y: currentCoordinates.y - row };
      default:
        return undefined;
    }
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter }),
  );

  const titleOf = useCallback(
    (widget: Draft) =>
      widget.reportKey
        ? t(`reports:catalogue.${widget.reportKey}.title`, {
            defaultValue: widget.reportKey,
          })
        : (views.data?.find((view) => view.id === widget.savedViewId)?.name ??
          t("reports:dashboard.savedView")),
    [t, views.data],
  );
  const accessibility = useDndAccessibility(
    useCallback(
      (id) => {
        const widget = widgets.find((entry) => entry.id === id);
        return widget ? titleOf(widget) : undefined;
      },
      [widgets, titleOf],
    ),
  );

  function apply(id: string, move: Move) {
    if (!move.ok) {
      if (move.reason !== "unchanged")
        toast.error(t(`reports:editor.refused.${move.reason}`));
      return;
    }
    setWidgets((current) =>
      current.map((widget) =>
        widget.id === id ? { ...widget, ...move.cell } : widget,
      ),
    );
  }
  const othersOf = (id: string): Cell[] =>
    widgets.filter((entry) => entry.id !== id);

  function onDragEnd(event: DragEndEvent) {
    const id = String(event.active.id);
    const widget = widgets.find((entry) => entry.id === id);
    if (!widget) return;
    apply(id, moveByPixels(widget, othersOf(id), event.delta, metrics.current));
  }

  const save = useMutation({
    mutationFn: () =>
      updateDashboard(dashboard.id, {
        version: dashboard.version,
        ...(name.trim() !== dashboard.name ? { name: name.trim() } : {}),
        widgets: widgets.map(stripId),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: reportKeys.all(workspaceId),
      });
      toast.success(t("reports:editor.saved"));
      void navigate({
        to: routes.agentDashboard.path,
        search: { id: dashboard.id },
      });
    },
    onError: async (error) => {
      toast.error(message(error));
      if (error instanceof ReportRuleError && error.code === "version_conflict")
        await queryClient.invalidateQueries({
          queryKey: reportKeys.all(workspaceId),
        });
    },
  });
  const copy = useMutation({
    mutationFn: () =>
      createDashboard({
        workspaceId,
        name: t("reports:editor.copyName", { name: dashboard.name }),
        scope: "personal",
        widgets: dashboard.widgets.map(stripId),
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({
        queryKey: reportKeys.dashboards(workspaceId),
      });
      void navigate({
        to: routes.agentDashboardEdit.path,
        search: { id: created.id },
      });
    },
    onError: (error) => toast.error(message(error)),
  });
  const remove = useMutation({
    mutationFn: () => requestDashboardDeletion(dashboard.id),
    onSuccess: (pending) => void openPending(pending),
    onError: (error) => toast.error(message(error)),
  });

  const reportChoices = useMemo(
    () =>
      (catalogue.data?.data ?? [])
        .filter((entry) => entry.available)
        .map((entry) => ({
          value: `report:${entry.key}`,
          label: t(`reports:catalogue.${entry.key}.title`, {
            defaultValue: entry.title,
          }),
        })),
    [catalogue.data, t],
  );
  const viewChoices = useMemo(
    () =>
      (views.data ?? [])
        .filter((view) => view.layout === "chart")
        .map((view) => ({ value: `view:${view.id}`, label: view.name })),
    [views.data],
  );

  function addWidget(input: {
    source: string;
    chartType: Draft["chartType"];
    window: string;
  }) {
    const size = input.chartType === "number" ? { w: 4, h: 2 } : { w: 6, h: 4 };
    const spot = findFreeSpot(widgets, size);
    const [kind, ...rest] = input.source.split(":");
    const ref = rest.join(":");
    draftCounter += 1;
    setWidgets((current) => [
      ...current,
      {
        id: `new-${draftCounter}`,
        reportKey: kind === "report" ? ref : null,
        savedViewId: kind === "view" ? ref : null,
        chartType: input.chartType,
        filters: { window: input.window },
        ...spot,
      },
    ]);
  }

  const ordered = readingOrder(widgets);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="dashboard-name">{t("reports:editor.name")}</Label>
          <Input
            id="dashboard-name"
            className="w-64"
            maxLength={120}
            value={name}
            disabled={!editable}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Badge variant="outline">
          {dashboard.scope === "workspace"
            ? t("reports:dashboard.workspaceScope")
            : t("reports:dashboard.personalScope")}
        </Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t("reports:editor.new")}
          </Button>
          {editable ? (
            <>
              <Button
                variant="outline"
                disabled={widgets.length >= MAX_WIDGETS}
                onClick={() => setAdding(true)}
              >
                <Plus aria-hidden="true" />
                {t("reports:editor.addWidget")}
              </Button>
              <Button
                variant="outline"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                <Trash2 aria-hidden="true" />
                {t("reports:editor.delete")}
              </Button>
              <Button
                disabled={save.isPending || !dirty || !name.trim()}
                onClick={() => save.mutate()}
              >
                <Save aria-hidden="true" />
                {t("reports:editor.save")}
              </Button>
            </>
          ) : (
            <Button disabled={copy.isPending} onClick={() => copy.mutate()}>
              {t("reports:editor.copy")}
            </Button>
          )}
        </div>
      </div>
      {!editable ? (
        <Alert variant="info">
          <AlertDescription>{t("reports:editor.readOnly")}</AlertDescription>
        </Alert>
      ) : (
        <p className="text-muted-foreground text-xs">
          {t("reports:editor.limits", {
            count: widgets.length,
            max: MAX_WIDGETS,
          })}
        </p>
      )}
      {widgets.length === 0 ? (
        <Alert variant="info">
          <AlertDescription>
            {t("reports:dashboard.emptyGrid")}
          </AlertDescription>
        </Alert>
      ) : (
        <DndContext
          sensors={sensors}
          accessibility={accessibility}
          onDragEnd={editable ? onDragEnd : undefined}
        >
          <div ref={gridRef}>
            <DashboardGrid wide={wide} data-testid="editor-grid">
              {ordered.map((widget) => {
                const title = titleOf(widget);
                const card = (
                  <DashboardWidgetCard
                    workspaceId={workspaceId}
                    dashboardId={dashboard.id}
                    version={dashboard.version}
                    widget={widget}
                  />
                );
                if (!editable)
                  return (
                    <div
                      key={widget.id}
                      style={gridItemStyle(widget, wide)}
                      className="min-w-0"
                    >
                      {card}
                    </div>
                  );
                return (
                  <DraggableWidget
                    key={widget.id}
                    widget={widget}
                    title={title}
                    wide={wide}
                    canResize={wide}
                    onResize={(dw, dh) =>
                      apply(
                        widget.id,
                        resize(widget, othersOf(widget.id), dw, dh),
                      )
                    }
                    onRemove={() =>
                      setWidgets((current) =>
                        current.filter((entry) => entry.id !== widget.id),
                      )
                    }
                  >
                    {(editorActions) =>
                      isNew(widget.id) ? (
                        <Card className="flex h-full flex-col">
                          <CardHeader className="flex flex-row justify-end px-2 py-1">
                            {editorActions}
                          </CardHeader>
                          <CardContent className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground text-sm">
                            {title} · {t("reports:editor.unsaved")}
                          </CardContent>
                        </Card>
                      ) : (
                        <DashboardWidgetCard
                          workspaceId={workspaceId}
                          dashboardId={dashboard.id}
                          version={dashboard.version}
                          widget={widget}
                          editorActions={editorActions}
                        />
                      )
                    }
                  </DraggableWidget>
                );
              })}
            </DashboardGrid>
          </div>
        </DndContext>
      )}
      {adding ? (
        <AddWidgetDialog
          reports={reportChoices}
          views={viewChoices}
          onAdd={addWidget}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {creating ? (
        <NewDashboardDialog
          workspaceId={workspaceId}
          canManageWorkspace={canManageWorkspace}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * `docs/screens.md` "Dashboard editor": drag a widget, resize it with the steppers, add and remove
 * widgets, then save the whole layout in one go (`RP-15`). Workspace dashboards need
 * `workspace:manage_settings`; anyone else can copy one to their own.
 */
export function DashboardEditor({ search }: { search: DashboardSearch }) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const dashboards = useDashboards(workspaceId);
  const list = dashboards.data?.data ?? [];
  const chosen =
    list.find((entry) => entry.id === search.id) ??
    list.find((entry) => entry.isDefault) ??
    list[0];
  const dashboard = useDashboard(workspaceId, chosen?.id ?? "");
  return (
    <>
      <PageTitle title={t("reports:editor.title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="space-y-1">
          <Link
            to={routes.agentDashboard.path}
            search={chosen ? { id: chosen.id } : {}}
            className="inline-flex items-center gap-1 rounded-sm text-muted-foreground text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            {t("reports:editor.back")}
          </Link>
          <h1 className="font-semibold text-2xl">
            {t("reports:editor.title")}
          </h1>
          <p className="max-w-2xl text-muted-foreground text-sm">
            {t("reports:editor.description")}
          </p>
        </div>
        {dashboards.isLoading || !workspace || dashboard.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : dashboards.isError ? (
          <ReportError error={dashboards.error} />
        ) : dashboard.isError || !dashboard.data ? (
          <ReportError error={dashboard.error} />
        ) : (
          <EditorBody
            // A different dashboard, or a saved version, is a fresh draft.
            key={`${dashboard.data.id}:${dashboard.data.version}`}
            workspaceId={workspaceId}
            dashboard={dashboard.data}
            canManageWorkspace={
              dashboards.data?.meta.canManageWorkspaceDashboards === true
            }
          />
        )}
      </div>
    </>
  );
}
