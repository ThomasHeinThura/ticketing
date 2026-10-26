import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Progress,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { LayoutGrid, Plus } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import CreateProjectModal from "@/components/shared/modals/create-project-modal";
import icons from "@/constants/project-icons";
import { shortcuts } from "@/constants/shortcuts";
import useReorderProjects from "@/hooks/mutations/project/use-reorder-projects";
import useRestoreProject from "@/hooks/mutations/project/use-restore-project";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { toast } from "@/lib/toast";

function SortableProjectRow({
  id,
  canReorder,
  onClick,
  children,
}: {
  id: string;
  canReorder: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const {
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({
    id,
    disabled: !canReorder,
    // The reorder already moves the row; animating the index change too
    // replays the same move from a stale offset.
    animateLayoutChanges: () => false,
    // dnd-kit defaults to `ease`; this is the app's curve.
    transition: { duration: 200, easing: "var(--ease-out)" },
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    // Only while a drag is live, or the dropped row eases back from the drop
    // point over a list that has already reordered.
    transition: isSorting ? transition : undefined,
  };

  return (
    // `listeners` without `attributes`: the latter puts role="button" and a tab
    // stop on the row.
    <TableRow
      ref={setNodeRef}
      style={style}
      data-taskdesk-sortable=""
      className={cn(
        "group/row cursor-pointer",
        isDragging && "relative z-10 bg-muted shadow-md",
      )}
      onClick={onClick}
      {...(canReorder ? listeners : {})}
    >
      {children}
    </TableRow>
  );
}

export default function ProjectsPage({
  workspaceId,
  recoveryMode = false,
  onRecoveryModeChange,
}: {
  workspaceId: string;
  recoveryMode?: boolean;
  onRecoveryModeChange?: (showDeleted: boolean) => void;
}) {
  const { t } = useTranslation();
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const navigate = useNavigate();
  const { data: listedProjects, isLoading } = useGetProjects({
    workspaceId,
    includeArchived: recoveryMode,
    includeDeleted: recoveryMode,
  });
  const projects = recoveryMode
    ? listedProjects?.filter((project) => project.deletedAt !== null)
    : listedProjects;
  const reorderProjects = useReorderProjects();
  const restoreProject = useRestoreProject();
  // PR-1: a child project names its parent next to its own name. The list keeps its flat,
  // draggable sidebar order; hierarchy is shown, not imposed on the ordering.
  const projectNameById = useMemo(
    () => new Map((projects ?? []).map((item) => [item.id, item.name])),
    [projects],
  );

  // React state, not the query cache: dnd-kit clears its transforms with a
  // setState in the same handler, while a cache write notifies a task later,
  // leaving a frame with the transforms gone and the rows not yet moved.
  const [droppedOrder, setDroppedOrder] = useState<string[] | null>(null);

  const orderedProjects = useMemo(() => {
    if (!projects || !droppedOrder) return projects;

    const rank = new Map(droppedOrder.map((id, index) => [id, index]));

    return [...projects].sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [projects, droppedOrder]);

  // Released once the server agrees, or a reorder made elsewhere stays pinned.
  useEffect(() => {
    if (!droppedOrder || !projects) return;
    if (projects.map((project) => project.id).join() === droppedOrder.join()) {
      setDroppedOrder(null);
    }
  }, [projects, droppedOrder]);

  const { canCreateProjects, canUpdateProjects } = useWorkspacePermission();
  const canCreate = canCreateProjects();
  // Matches the API, which gates /project/reorder on `project: ["update"]`
  // alone — not the create+update+delete bundle.
  const canReorder = canUpdateProjects();

  const handleRestoreProject = (projectId: string) => {
    restoreProject.mutate(
      { id: projectId },
      {
        onSuccess: () => toast.success(t("workspace:projects.restoreSuccess")),
        onError: () => toast.error(t("workspace:projects.restoreFailed")),
      },
    );
  };

  // Below these thresholds the row is still a link and the page still scrolls;
  // above them the gesture becomes a drag.
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );

  const handleDragStart = () => {
    document.body.classList.add("taskdesk-dragging");
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    document.body.classList.remove("taskdesk-dragging");

    if (!over || active.id === over.id || !orderedProjects) return;

    const oldIndex = orderedProjects.findIndex(
      (project) => project.id === active.id,
    );
    const newIndex = orderedProjects.findIndex(
      (project) => project.id === over.id,
    );

    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(orderedProjects, oldIndex, newIndex);

    setDroppedOrder(reordered.map((project) => project.id));

    reorderProjects(workspaceId, reordered, {
      onError: () => {
        setDroppedOrder(null);
        toast.error(t("workspace:projects.reorderError"));
      },
    });
  };

  const handleCreateProject = () => {
    if (!canCreate) return;
    setIsCreateProjectOpen(true);
  };

  useRegisterShortcuts({
    sequentialShortcuts: {
      [shortcuts.project.prefix]: {
        [shortcuts.project.create]: handleCreateProject,
      },
    },
  });

  // v2 work items live behind /agent/projects/{key}/work, the same target as the
  // sidebar's project links (nav-projects.tsx); the legacy board reads the old task table.
  const handleProjectClick = (projectKey: string) => {
    navigate({
      to: "/agent/projects/$projectKey/work",
      params: { projectKey },
      search: { layout: "board", sort: "position", dir: "asc" },
    });
  };

  if (isLoading) {
    return (
      <WorkspaceLayout
        title={t("workspace:projects.pageTitle")}
        headerActions={
          canCreate ? (
            <Button
              variant="outline"
              size="xs"
              onClick={handleCreateProject}
              className="gap-1"
            >
              <Plus className="w-3 h-3" />
              {t("workspace:projects.createProject")}
            </Button>
          ) : null
        }
      >
        <Table data-testid="workspace-projects-loading">
          <TableHeader>
            <TableRow>
              <TableHead className="text-foreground font-medium">
                {t("workspace:projects.title")}
              </TableHead>
              <TableHead className="text-foreground font-medium">
                {t("workspace:projects.progress")}
              </TableHead>
              <TableHead className="text-foreground font-medium">
                {t("workspace:projects.targetDate")}
              </TableHead>
              <TableHead className="text-foreground font-medium">
                {t("workspace:projects.status")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[1, 2, 3].map((i) => (
              <TableRow key={i}>
                <TableCell className="py-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-5 w-5" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </TableCell>
                <TableCell className="py-3">
                  <Skeleton className="h-2 w-20" />
                </TableCell>
                <TableCell className="py-3">
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                <TableCell className="py-3">
                  <Skeleton className="h-5 w-16" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <PageTitle title={t("workspace:projects.pageTitle")} />
      </WorkspaceLayout>
    );
  }

  if (recoveryMode) {
    return (
      <WorkspaceLayout
        title={t("workspace:projects.pageTitle")}
        headerActions={
          <Button
            variant="outline"
            size="xs"
            onClick={() => onRecoveryModeChange?.(false)}
          >
            {t("workspace:projects.showActive")}
          </Button>
        }
      >
        {!projects || projects.length === 0 ? (
          <Empty className="min-h-[60vh]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayoutGrid />
              </EmptyMedia>
              <EmptyTitle>
                {t("workspace:projects.deletedEmptyTitle")}
              </EmptyTitle>
              <EmptyDescription>
                {t("workspace:projects.deletedEmptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table data-testid="workspace-projects-recovery">
            <TableHeader>
              <TableRow>
                <TableHead className="text-foreground font-medium">
                  {t("workspace:projects.title")}
                </TableHead>
                <TableHead className="text-foreground font-medium">
                  {t("workspace:projects.status")}
                </TableHead>
                <TableHead className="text-foreground font-medium">
                  {t("workspace:projects.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => {
                const IconComponent =
                  icons[project.icon as keyof typeof icons] || icons.Layout;
                return (
                  <TableRow key={project.id}>
                    <TableCell className="py-3">
                      <div className="flex items-center gap-3">
                        <IconComponent className="w-5 h-5 text-muted-foreground" />
                        <span className="font-medium">{project.name}</span>
                        <Badge variant="outline">
                          {t("workspace:projects.deletedBadge")}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      {project.archivedAt ? (
                        <Badge variant="secondary">
                          {t("workspace:projects.archived")}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {project.deletedAt
                            ? formatDateMedium(project.deletedAt)
                            : "—"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      {canUpdateProjects() && (
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={restoreProject.isPending}
                          onClick={() => handleRestoreProject(project.id)}
                        >
                          {t("workspace:projects.restore")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <PageTitle title={t("workspace:projects.pageTitle")} />
      </WorkspaceLayout>
    );
  }

  if (!projects || projects.length === 0) {
    return (
      <>
        <WorkspaceLayout
          title={t("workspace:projects.pageTitle")}
          headerActions={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="xs"
                onClick={() => onRecoveryModeChange?.(true)}
              >
                {t("workspace:projects.showDeleted")}
              </Button>
              {canCreate && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={handleCreateProject}
                  className="gap-1"
                >
                  <Plus className="w-3 h-3" />
                  {t("workspace:projects.createProject")}
                </Button>
              )}
            </div>
          }
        >
          <Empty className="min-h-[60vh]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayoutGrid />
              </EmptyMedia>
              <EmptyTitle>{t("workspace:projects.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {canCreate
                  ? t("workspace:projects.emptyDescription")
                  : t("workspace:projects.emptyDescriptionReadOnly")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {canCreate && (
                <Button onClick={handleCreateProject}>
                  <Plus />
                  {t("workspace:projects.createProject")}
                </Button>
              )}
            </EmptyContent>
          </Empty>
          <PageTitle title={t("workspace:projects.pageTitle")} />
        </WorkspaceLayout>

        <CreateProjectModal
          open={isCreateProjectOpen}
          onClose={() => setIsCreateProjectOpen(false)}
        />
      </>
    );
  }

  return (
    <>
      <WorkspaceLayout
        title={t("workspace:projects.pageTitle")}
        headerActions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="xs"
              onClick={() => onRecoveryModeChange?.(true)}
            >
              {t("workspace:projects.showDeleted")}
            </Button>
            {canCreate && (
              <Button
                variant="outline"
                size="xs"
                onClick={handleCreateProject}
                className="gap-1"
              >
                <Plus className="w-3 h-3" />
                {t("workspace:projects.createProject")}
              </Button>
            )}
          </div>
        }
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() =>
            document.body.classList.remove("taskdesk-dragging")
          }
        >
          <Table data-testid="g13-projects-content">
            <TableHeader className="p-4">
              <TableRow>
                <TableHead className="text-foreground font-medium">
                  {t("workspace:projects.title")}
                </TableHead>
                <TableHead className="text-foreground font-medium">
                  {t("workspace:projects.progress")}
                </TableHead>
                <TableHead className="text-foreground font-medium">
                  {t("workspace:projects.dueDate")}
                </TableHead>
                <TableHead className="text-foreground font-medium">
                  {t("workspace:projects.status")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <SortableContext
                items={orderedProjects?.map((project) => project.id) ?? []}
                strategy={verticalListSortingStrategy}
              >
                {orderedProjects?.map((project) => {
                  if (!project?.id || !project.statistics) return null;

                  const IconComponent =
                    icons[project.icon as keyof typeof icons] || icons.Layout;

                  const getStatusText = () => {
                    if (project.statistics.totalTasks === 0)
                      return t("workspace:projects.projectStatus.notStarted");
                    if (project.statistics.completionPercentage === 100)
                      return t("workspace:projects.projectStatus.complete");
                    return t("workspace:projects.projectStatus.inProgress");
                  };

                  const getStatusVariant = () => {
                    if (project.statistics.totalTasks === 0) return "secondary";
                    if (project.statistics.completionPercentage === 100)
                      return "default";
                    return "outline";
                  };

                  return (
                    <SortableProjectRow
                      key={project.id}
                      id={project.id}
                      canReorder={canReorder}
                      onClick={() => handleProjectClick(project.slug)}
                    >
                      <TableCell className="py-3">
                        <div className="flex items-center gap-3">
                          <IconComponent className="w-5 h-5 text-muted-foreground" />
                          <span className="font-medium">{project.name}</span>
                          {project.parentId &&
                            projectNameById.has(project.parentId) && (
                              <Badge
                                variant="outline"
                                data-testid="project-parent-badge"
                              >
                                {t("workspace:projects.inParent", {
                                  name: projectNameById.get(project.parentId),
                                })}
                              </Badge>
                            )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <Progress
                              value={project.statistics.completionPercentage}
                              className="w-16 h-2"
                            />
                            <span className="text-sm text-muted-foreground">
                              {project.statistics.completionPercentage}%
                            </span>
                          </div>
                          {project.descendantStatistics ? (
                            <div
                              className="flex items-center gap-2"
                              data-testid="project-visible-tree-progress"
                            >
                              <Progress
                                aria-label={t(
                                  "workspace:projects.visibleTreeStatistics",
                                  { defaultValue: "Visible project tree" },
                                )}
                                value={
                                  project.descendantStatistics
                                    .completionPercentage
                                }
                                className="w-16 h-2"
                              />
                              <span className="text-xs text-muted-foreground">
                                {t("workspace:projects.visibleTreeStatistics", {
                                  defaultValue: "Visible project tree",
                                })}
                                {": "}
                                {
                                  project.descendantStatistics
                                    .completionPercentage
                                }
                                %{" · "}
                                {project.descendantStatistics.totalTasks}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <span className="text-sm text-muted-foreground">
                          {project.statistics.dueDate
                            ? formatDateMedium(project.statistics.dueDate)
                            : t("workspace:projects.noDueDate")}
                        </span>
                      </TableCell>
                      <TableCell className="py-3">
                        <Badge variant={getStatusVariant()}>
                          {getStatusText()}
                        </Badge>
                      </TableCell>
                    </SortableProjectRow>
                  );
                })}
              </SortableContext>
            </TableBody>
          </Table>
        </DndContext>
        <PageTitle title={t("workspace:projects.pageTitle")} />
      </WorkspaceLayout>

      <CreateProjectModal
        open={isCreateProjectOpen}
        onClose={() => setIsCreateProjectOpen(false)}
      />
    </>
  );
}
