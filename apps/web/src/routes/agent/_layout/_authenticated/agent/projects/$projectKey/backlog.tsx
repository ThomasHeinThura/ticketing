import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { ArrowDown, ArrowUp, ListFilter } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  loadWorkItemCreateDialogShell,
  preloadWorkItemCreateDialogShell,
} from "@/components/work-item/work-item-create-dialog-shell-loader";
import rankWorkItem from "@/fetchers/work-item/rank-work-item";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetBoardWorkItems from "@/hooks/queries/work-item/use-get-board-work-items";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { afterFirstPaint } from "@/lib/i18n/after-first-paint";
import {
  parseWorkItemListSearch,
  routes,
  type WorkItemFilterMode,
  type WorkItemListSearch,
} from "@/lib/routes";
import {
  classifyWorkItemWriteError,
  rankNeighbours,
  sortByRank,
} from "@/lib/work-item-board";
import type { WorkItemRow } from "@/types/work-item";

type CreateDialogShellComponent = Awaited<
  ReturnType<typeof loadWorkItemCreateDialogShell>
>["default"];

const BulkAssignToolbar = lazy(
  () => import("@/components/work-item/bulk-assign-toolbar"),
);
const WorkItemCreateTrigger = lazy(
  () => import("@/components/work-item/work-item-create-trigger"),
);
const WorkItemListControls = lazy(
  () => import("@/components/work-item/work-item-list-controls"),
);
const WorkItemSelectionToggle = lazy(
  () => import("@/components/work-item/work-item-selection-toggle"),
);
const WorkItemSidePane = lazy(
  () => import("@/components/work-item/work-item-side-pane"),
);

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/backlog",
)({
  validateSearch: parseWorkItemListSearch,
  component: BacklogRouteComponent,
});

function BacklogRouteComponent() {
  const { projectKey } = Route.useParams();
  return <ProjectBacklogRoute key={projectKey} projectKey={projectKey} />;
}

function ProjectBacklogRoute({ projectKey }: { projectKey: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { filter, filterMode, item } = Route.useSearch();
  const navigate = Route.useNavigate();
  const isFiltered = !!filter?.trim();
  const [isFilterOpen, setIsFilterOpen] = useState(isFiltered);
  const [focusFilterEditor, setFocusFilterEditor] = useState(false);
  const filterToggleRef = useRef<HTMLButtonElement>(null);

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [canAssign, setCanAssign] = useState(false);
  const [rankingNotice, setRankingNotice] = useState<{
    kind: "status" | "error";
    text: string;
  }>();
  const [rankingBusy, setRankingBusy] = useState(false);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [CreateDialogShell, setCreateDialogShell] =
    useState<CreateDialogShellComponent>();
  const [createDialogLoad, setCreateDialogLoad] = useState<
    "idle" | "loading" | "failed"
  >("idle");
  const createTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void afterFirstPaint().then(() => {
      if (!cancelled) preloadWorkItemCreateDialogShell();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { data: workspace, isLoading: isWorkspaceLoading } =
    useActiveWorkspace();
  const {
    data: projects,
    isPending: isProjectsLoading,
    isError: isProjectsError,
    refetch: refetchProjects,
  } = useGetProjects({
    workspaceId: workspace?.id ?? "",
  });

  const project = projects?.find((candidate) => candidate.slug === projectKey);
  const { canRankTasks, isCheckingPermissions } = useWorkspacePermission();
  const canRank = !isCheckingPermissions && canRankTasks();
  const canBulkAct = selectionMode && canAssign;

  const [realtimeStatus] = useState<WorkItemRealtimeStatus>("connecting");
  const itemsQuery = useGetBoardWorkItems({
    projectId: project?.id,
    projectSlug: project?.slug,
    workspaceId: workspace?.id,
    filter,
    realtimeStatus,
    enabled: Boolean(project?.id),
  });

  const backlogGroups = useMemo(() => {
    const allItems = itemsQuery.data?.pages.flatMap((page) => page.items) ?? [];
    const backlogItems = allItems.filter(
      (candidate) =>
        candidate.stateCategory === "backlog" ||
        candidate.stateCategory === "unstarted",
    );
    const byState = new Map<
      string,
      { stateId: string; stateName: string; items: WorkItemRow[] }
    >();
    for (const row of backlogItems) {
      const existing = byState.get(row.stateId);
      if (existing) {
        existing.items.push(row);
      } else {
        byState.set(row.stateId, {
          stateId: row.stateId,
          stateName: row.stateName ?? "Backlog",
          items: [row],
        });
      }
    }
    return [...byState.values()].map((group) => ({
      ...group,
      items: sortByRank(group.items),
    }));
  }, [itemsQuery.data]);

  const flatBacklogItems = useMemo(
    () => backlogGroups.flatMap((group) => group.items),
    [backlogGroups],
  );

  useEffect(() => {
    const present = new Set(flatBacklogItems.map((row) => row.key));
    setSelectedKeys((current) =>
      current.every((key) => present.has(key))
        ? current
        : current.filter((key) => present.has(key)),
    );
  }, [flatBacklogItems]);

  const toggleFilter = useCallback(() => {
    if (isFilterOpen) {
      setIsFilterOpen(false);
      setFocusFilterEditor(false);
      filterToggleRef.current?.focus();
    } else {
      setFocusFilterEditor(true);
      setIsFilterOpen(true);
    }
  }, [isFilterOpen]);

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((on) => !on);
    setSelectedKeys([]);
  }, []);

  const handleSelectionChange = useCallback((key: string, checked: boolean) => {
    setSelectedKeys((current) =>
      checked
        ? current.includes(key)
          ? current
          : [...current, key]
        : current.filter((selected) => selected !== key),
    );
  }, []);

  const openCreateDialog = useCallback(() => {
    if (CreateDialogShell) {
      setIsCreateOpen(true);
      return;
    }
    setCreateDialogLoad("loading");
    void loadWorkItemCreateDialogShell()
      .then((m) => {
        setCreateDialogShell(() => m.default);
        setCreateDialogLoad("idle");
        setIsCreateOpen(true);
      })
      .catch(() => {
        setCreateDialogLoad("failed");
      });
  }, [CreateDialogShell]);

  const handleRankMove = async (
    row: WorkItemRow,
    groupItems: WorkItemRow[],
    direction: "up" | "down",
    stateName: string,
  ) => {
    if (rankingBusy || !project) return;
    const from = groupItems.findIndex((candidate) => candidate.id === row.id);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from === -1 || to < 0 || to >= groupItems.length) return;
    const neighbours = rankNeighbours(groupItems, row.id, to);
    if (!neighbours) return;

    setRankingBusy(true);
    try {
      await rankWorkItem({ key: row.key, ...neighbours });
      await queryClient.invalidateQueries({
        queryKey: ["work-items", project.id],
      });
      setRankingNotice({
        kind: "status",
        text: t("workItems:board.rankSaved", {
          key: row.key,
          position: to + 1,
          total: groupItems.length,
          state: stateName,
        }),
      });
    } catch (error) {
      await queryClient.invalidateQueries({
        queryKey: ["work-items", project.id],
      });
      const failure = classifyWorkItemWriteError(error);
      setRankingNotice({
        kind: "error",
        text: t(`workItems:board.failure.${failure}`, { key: row.key }),
      });
    } finally {
      setRankingBusy(false);
    }
  };

  const isLoading =
    isWorkspaceLoading || isProjectsLoading || itemsQuery.isLoading;
  const isError = isProjectsError || itemsQuery.isError;

  return (
    <>
      <PageTitle
        title={
          project
            ? `${project.name} · ${t("navigation:projectList.backlog", { defaultValue: "Backlog" })}`
            : t("navigation:projectList.backlog", { defaultValue: "Backlog" })
        }
      />
      <div
        className="flex h-full flex-col gap-4 overflow-y-auto p-6 w-full min-w-0"
        data-testid="project-backlog-page"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="font-semibold text-lg">
              {project ? project.name : projectKey} ·{" "}
              {t("navigation:projectList.backlog", { defaultValue: "Backlog" })}
            </h1>
            <Link
              to="/agent/projects/$projectKey/work"
              params={{ projectKey }}
              className="text-sm underline-offset-4 hover:underline"
            >
              {t("workItems:list.heading")}
            </Link>
          </div>
          <div className="flex items-center gap-2">
            {project ? (
              <Suspense fallback={null}>
                <WorkItemSelectionToggle
                  selectionMode={selectionMode}
                  onToggle={toggleSelectionMode}
                  onCapabilityChange={setCanAssign}
                />
              </Suspense>
            ) : null}
            <Button
              ref={filterToggleRef}
              variant={isFiltered ? "secondary" : "outline"}
              size="sm"
              aria-expanded={isFilterOpen}
              aria-controls={
                isFilterOpen ? "backlog-filter-controls" : undefined
              }
              onClick={toggleFilter}
            >
              <ListFilter />
              {isFiltered
                ? t("workItems:filter.toggleActive")
                : t("workItems:filter.toggle")}
            </Button>
            {project ? (
              <Suspense fallback={null}>
                <WorkItemCreateTrigger
                  buttonRef={createTriggerRef}
                  pending={createDialogLoad === "loading"}
                  onClick={openCreateDialog}
                />
              </Suspense>
            ) : null}
          </div>
        </div>

        {isFilterOpen ? (
          <div id="backlog-filter-controls">
            <Suspense fallback={null}>
              <WorkItemListControls
                autoFocus={focusFilterEditor}
                onClose={toggleFilter}
                filter={filter ?? ""}
                mode={filterMode ?? "visual"}
                workItemsError={itemsQuery.error}
                onModeChange={(nextMode: WorkItemFilterMode) =>
                  navigate({
                    search: (prev: WorkItemListSearch) => ({
                      ...prev,
                      filterMode: nextMode,
                    }),
                  })
                }
                onApply={(nextFilter: string) =>
                  navigate({
                    search: (prev: WorkItemListSearch) => ({
                      ...prev,
                      filter: nextFilter.trim() ? nextFilter : undefined,
                    }),
                  })
                }
                workspaceId={workspace?.id}
                projectSlug={project?.slug}
              />
            </Suspense>
          </div>
        ) : null}

        {rankingNotice ? (
          <Alert
            variant={rankingNotice.kind === "error" ? "error" : "default"}
            role={rankingNotice.kind === "error" ? "alert" : "status"}
            data-testid="backlog-rank-notice"
          >
            <AlertDescription>{rankingNotice.text}</AlertDescription>
          </Alert>
        ) : null}

        {project && selectedKeys.length > 0 && canBulkAct ? (
          <Suspense fallback={null}>
            <BulkAssignToolbar
              projectId={project.id}
              workspaceId={project.workspaceId}
              selectedKeys={selectedKeys}
              onAssigned={(succeeded) =>
                setSelectedKeys((current) =>
                  current.filter((key) => !succeeded.includes(key)),
                )
              }
              onClear={() => setSelectedKeys([])}
            />
          </Suspense>
        ) : null}

        {isLoading ? (
          <div
            className="flex flex-col gap-2"
            data-testid="backlog-loading"
            aria-busy="true"
          >
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <Alert variant="error" data-testid="backlog-error">
            <AlertTitle>{t("workItems:list.errorTitle")}</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>{t("workItems:list.errorDescription")}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void refetchProjects();
                  void itemsQuery.refetch();
                }}
              >
                {t("workItems:list.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : flatBacklogItems.length === 0 ? (
          <Alert data-testid="backlog-empty">
            <AlertTitle>
              {t("workItems:backlog.emptyTitle", {
                defaultValue: "No backlog items",
              })}
            </AlertTitle>
            <AlertDescription>
              {t("workItems:backlog.emptyDescription", {
                defaultValue:
                  "Items in backlog or unstarted states appear here for manual ranking.",
              })}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-6" data-testid="backlog-populated">
            {backlogGroups.map((group) => (
              <section
                key={group.stateId}
                className="flex flex-col gap-2"
                aria-label={group.stateName}
              >
                <div className="flex items-center gap-2">
                  <h2 className="font-medium text-sm">{group.stateName}</h2>
                  <Badge variant="secondary" size="sm">
                    {group.items.length}
                  </Badge>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {canBulkAct ? <TableHead className="w-10" /> : null}
                      <TableHead className="w-28">
                        {t("workItems:list.columns.key")}
                      </TableHead>
                      <TableHead>{t("workItems:list.columns.title")}</TableHead>
                      <TableHead className="w-32">
                        {t("workItems:list.columns.priority")}
                      </TableHead>
                      <TableHead className="w-40">
                        {t("workItems:list.columns.assignee")}
                      </TableHead>
                      {canRank ? (
                        <TableHead className="w-28 text-right">
                          {t("workItems:backlog.rankColumn", {
                            defaultValue: "Order",
                          })}
                        </TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.items.map((row, index) => (
                      <TableRow
                        key={row.id}
                        data-testid={`backlog-row-${row.key}`}
                      >
                        {canBulkAct ? (
                          <TableCell>
                            <Checkbox
                              checked={selectedKeys.includes(row.key)}
                              aria-label={t("workItems:bulk.selectItem", {
                                key: row.key,
                              })}
                              onCheckedChange={(checked) =>
                                handleSelectionChange(row.key, Boolean(checked))
                              }
                            />
                          </TableCell>
                        ) : null}
                        <TableCell className="font-mono text-xs">
                          <Button
                            variant="ghost"
                            size="xs"
                            data-testid={`backlog-open-pane-${row.key}`}
                            onClick={() =>
                              navigate({
                                search: (prev: WorkItemListSearch) => ({
                                  ...prev,
                                  item: row.key,
                                }),
                              })
                            }
                          >
                            {row.key}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <Link
                            to={routes.workItemDetail.path}
                            params={{ key: row.key }}
                            className="font-medium text-sm hover:underline"
                          >
                            {row.title}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" size="sm">
                            {t(`workItems:priority.${row.priority}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.assigneeName ?? t("workItems:list.unassigned")}
                        </TableCell>
                        {canRank ? (
                          <TableCell className="text-right">
                            <div className="inline-flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="xs"
                                disabled={rankingBusy || index === 0}
                                aria-label={t("workItems:board.moveUp", {
                                  key: row.key,
                                })}
                                data-testid={`backlog-move-up-${row.key}`}
                                onClick={() =>
                                  void handleRankMove(
                                    row,
                                    group.items,
                                    "up",
                                    group.stateName,
                                  )
                                }
                              >
                                <ArrowUp className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="xs"
                                disabled={
                                  rankingBusy ||
                                  index === group.items.length - 1
                                }
                                aria-label={t("workItems:board.moveDown", {
                                  key: row.key,
                                })}
                                data-testid={`backlog-move-down-${row.key}`}
                                onClick={() =>
                                  void handleRankMove(
                                    row,
                                    group.items,
                                    "down",
                                    group.stateName,
                                  )
                                }
                              >
                                <ArrowDown className="size-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            ))}
          </div>
        )}

        {item ? (
          <Suspense fallback={null}>
            <WorkItemSidePane
              itemKey={item}
              onClose={() =>
                navigate({
                  search: (prev: WorkItemListSearch) => ({
                    ...prev,
                    item: undefined,
                  }),
                  replace: true,
                })
              }
            />
          </Suspense>
        ) : null}

        {project && isCreateOpen && CreateDialogShell ? (
          <CreateDialogShell
            projectId={project.id}
            workspaceId={project.workspaceId}
            onClose={() => setIsCreateOpen(false)}
            finalFocus={() => createTriggerRef.current ?? false}
          />
        ) : null}
      </div>
    </>
  );
}
