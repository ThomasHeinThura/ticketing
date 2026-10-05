import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  restrictToFirstScrollableAncestor,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SidebarMenuItem } from "@taskdesk/ui";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type getProjects from "@/fetchers/project/get-projects";
import useReorderProjects from "@/hooks/mutations/project/use-reorder-projects";
import { toast } from "@/lib/toast";

type ProjectRecord = NonNullable<
  Awaited<ReturnType<typeof getProjects>>
>[number];

function SortableProjectItem({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id,
      // The reorder already moves the row; animating the index change too
      // replays the same move from a stale offset.
      animateLayoutChanges: () => false,
      // dnd-kit defaults to `ease`; this is the app's curve.
      transition: { duration: 200, easing: "var(--ease-out)" },
    });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    // `listeners` without `attributes`: the latter puts role="button" and a tab
    // stop on the row, wrapping the link and the dropdown inside it.
    <SidebarMenuItem
      ref={setNodeRef}
      style={style}
      data-taskdesk-sortable=""
      className={isDragging ? "opacity-0" : undefined}
      {...listeners}
    >
      {children}
    </SidebarMenuItem>
  );
}

export default function SortableProjectList({
  projects,
  workspaceId,
  renderProjectContents,
}: {
  projects: ProjectRecord[];
  workspaceId: string;
  renderProjectContents: (project: ProjectRecord) => ReactNode;
}) {
  const { t } = useTranslation();
  const reorderProjects = useReorderProjects();
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(
    null,
  );
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );
  const draggingProject = projects.find(
    (project) => project.id === draggingProjectId,
  );

  useEffect(
    () => () => document.body.classList.remove("taskdesk-dragging"),
    [],
  );

  const handleDragStart = (event: DragStartEvent) => {
    document.body.classList.add("taskdesk-dragging");
    setDraggingProjectId(String(event.active.id));
  };

  const endDrag = () => {
    document.body.classList.remove("taskdesk-dragging");
    setDraggingProjectId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    endDrag();

    if (!over || active.id === over.id) return;

    const oldIndex = projects.findIndex((project) => project.id === active.id);
    const newIndex = projects.findIndex((project) => project.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(projects, oldIndex, newIndex);
    reorderProjects(workspaceId, reordered, {
      onError: () => toast.error(t("workspace:projects.reorderError")),
    });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={endDrag}
    >
      <SortableContext
        items={projects.map((project) => project.id)}
        strategy={verticalListSortingStrategy}
      >
        {projects.map((project) => (
          <SortableProjectItem key={project.id} id={project.id}>
            {renderProjectContents(project)}
          </SortableProjectItem>
        ))}
      </SortableContext>
      {/* Portalled: SidebarContent may clip the project list. */}
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {draggingProject ? (
            <div className="flex h-8 w-(--sidebar-width) max-w-64 items-center rounded-lg border bg-sidebar not-dark:bg-clip-padding ps-3.5 pe-2 text-sm text-sidebar-accent-foreground shadow-lg/5">
              <span className="truncate">{draggingProject.name}</span>
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}
