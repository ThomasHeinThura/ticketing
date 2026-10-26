import { closestCorners, DndContext, DragOverlay } from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription, Button } from "@taskdesk/ui";
import { lazy, Suspense, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { ListColumnSection } from "@/components/list-view/list-column-section";
import TaskDragPreview from "@/components/list-view/task-drag-preview";
import TaskRow from "@/components/list-view/task-row";
import useGetProjectStates from "@/hooks/queries/project/use-get-project-states";
import { useDndAccessibility } from "@/hooks/use-dnd-accessibility";
import {
  parseCollapsedGroups,
  useProjectViewPreference,
} from "@/hooks/use-project-view-preference";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { routes } from "@/lib/routes";
import {
  workItemKaneoView,
  workItemProjectSlug,
} from "@/lib/work-item-kaneo-view";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { ProjectWithTasks } from "@/types/project";
import useWorkItemDragDrop from "./use-work-item-drag-drop";
import type { VirtualizedSortableItem } from "./virtualization/virtualized-sortable-list";
import WorkItemContextMenu from "./work-item-context-menu";
import WorkItemList, { type WorkItemListProps } from "./work-item-list";
import { WorkItemSlaBadge } from "./work-item-sla-badge";

const VirtualizedSortableList = lazy(
  () => import("./virtualization/virtualized-sortable-list"),
) as unknown as typeof import("./virtualization/virtualized-sortable-list").default;
const WorkItemInlineFields = lazy(() => import("./work-item-inline-fields"));

/** Kaneo presentation over canonical rows; all writes stay with canonical actions. */
export default function WorkItemKaneoList({
  projectId,
  workspaceId,
  ...props
}: WorkItemListProps & { projectId?: string; workspaceId?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const states = useGetProjectStates(projectId);
  const permission = useWorkspacePermission(workspaceId, projectId);
  const drag = useWorkItemDragDrop({
    projectId: projectId ?? "",
    states: states.data,
    workItems: props.workItems,
    canRank:
      !props.isPlaceholderData &&
      !permission.isCheckingPermissions &&
      permission.canRankTasks(),
    canTransition:
      !permission.isCheckingPermissions && permission.canTransitionTasks(),
    // Structured search substitutes key order for position; never rank that subset.
    sort: props.isFiltered && props.sort === "position" ? "key" : props.sort,
    dir: props.isFiltered && props.sort === "position" ? "asc" : props.dir,
    surface: "list",
  });
  const describeDnd = useCallback(
    (id: string | number) =>
      props.workItems?.find((item) => item.id === id)?.title ??
      states.data?.find((state) => state.id === id)?.name,
    [props.workItems, states.data],
  );
  const dndAccessibility = useDndAccessibility(describeDnd);
  const [retainFocusId, setRetainFocusId] = useState<string>();
  const onRetainFocus = useCallback(() => setRetainFocusId(undefined), []);
  // `VW-15`: collapsed groups are a per-user, per-project preference, so they persist.
  const collapsedPreference = useProjectViewPreference({
    projectId,
    name: "listGroups",
    parse: parseCollapsedGroups,
  });
  const collapsedIds = collapsedPreference.value;
  const setCollapsedPreference = collapsedPreference.set;
  const toggleGroup = useCallback(
    (groupId: string) => {
      const current = collapsedIds ?? [];
      const next = current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId];
      setCollapsedPreference(next.length > 0 ? next.slice(-50) : null);
    },
    [collapsedIds, setCollapsedPreference],
  );
  const displayPreferences = useUserPreferencesStore(
    useShallow((state) => ({
      showAssignees: state.showAssignees,
      showPriority: state.showPriority,
      showDueDates: state.showDueDates,
      showLabels: state.showLabels,
      showTaskNumbers: state.showTaskNumbers,
    })),
  );

  // Preserve the table's field-level partial/error/empty semantics. A row whose
  // state is no longer active must remain visible rather than disappearing from groups.
  const hasUngroupedRows = props.workItems?.some(
    (item) => !states.data?.some((state) => state.id === item.stateId),
  );
  if (
    props.isError ||
    props.isLoading ||
    !props.workItems?.length ||
    props.workItems.some((item) => item.deletedAt || item.archivedAt) ||
    props.hasPartialFailure ||
    hasUngroupedRows ||
    states.isError ||
    states.isLoading
  ) {
    return <WorkItemList {...props} />;
  }

  const workItems = props.workItems;
  const columns = (states.data ?? []).map(
    (state) =>
      ({
        id: state.id,
        slug: state.id,
        name: state.name,
        isFinal: state.group === "completed" || state.group === "cancelled",
        icon: null,
        tasks: drag.itemsByState.get(state.id)?.map(workItemKaneoView) ?? [],
      }) satisfies ProjectWithTasks["columns"][number],
  );
  const rowsById = new Map(workItems.map((item) => [item.id, item]));
  const renderTaskRow = (
    task: ProjectWithTasks["columns"][number]["tasks"][number],
    column: ProjectWithTasks["columns"][number],
    virtualItem?: VirtualizedSortableItem,
  ) => {
    const item = rowsById.get(task.id);
    if (!item) return null;
    const rowProps = {
      task,
      projectSlug: workItemProjectSlug(item),
      taskIsCompleted: column.isFinal,
      displayPreferences,
      badges: <WorkItemSlaBadge sla={item.sla} />,
      taskHref: routes.workItemDetail.build({ key: item.key }),
      openTaskOnLinkClick: Boolean(props.onOpenItem),
      onOpenTask: () =>
        props.onOpenItem
          ? props.onOpenItem(item.key)
          : void navigate({
              href: routes.workItemDetail.build({ key: item.key }),
            }),
      disableDragDrop:
        props.isPlaceholderData ||
        drag.busy ||
        item.unavailableFields.includes("key") ||
        (!drag.canReorder &&
          (permission.isCheckingPermissions ||
            !permission.canTransitionTasks())),
      selectionEnabled: Boolean(props.canBulkAssign && props.onSelectionChange),
      isSelected: props.selectedKeys?.includes(item.key) ?? false,
      onToggleSelection: () =>
        props.onSelectionChange?.(
          item.key,
          !props.selectedKeys?.includes(item.key),
        ),
      t,
    };
    const row = <TaskRow {...rowProps} />;
    const inlineRow = (
      <Suspense fallback={row}>
        <WorkItemInlineFields
          item={item}
          disabled={Boolean(props.isPlaceholderData)}
        >
          {(controls) => <TaskRow {...rowProps} {...controls} />}
        </WorkItemInlineFields>
      </Suspense>
    );
    if (!virtualItem) return inlineRow;
    return (
      <div
        key={task.id}
        ref={virtualItem.measureRef}
        data-index={virtualItem.index}
        data-virtual-item-id={virtualItem.id}
        style={virtualItem.style}
      >
        {inlineRow}
      </div>
    );
  };

  return (
    <div
      ref={drag.containerRef}
      data-testid="work-item-list-populated"
      data-primary-content-ready="true"
      className="w-full bg-muted/20"
    >
      <DndContext
        accessibility={dndAccessibility}
        sensors={drag.sensors}
        collisionDetection={closestCorners}
        onDragStart={(event) => {
          setRetainFocusId(undefined);
          drag.startDrag(event);
        }}
        onDragOver={drag.overDrag}
        onDragEnd={(event) => {
          if (event.over) setRetainFocusId(String(event.active.id));
          drag.endDrag(event);
        }}
        onDragCancel={drag.cancelDrag}
        modifiers={[snapCenterToCursor]}
      >
        <p className="sr-only" role="status" aria-live="polite">
          {drag.notice?.kind === "status" ? drag.notice.text : ""}
        </p>
        {drag.notice?.kind === "error" ? (
          <Alert
            variant="error"
            role="alert"
            data-testid="work-item-list-drag-error"
          >
            <AlertDescription>{drag.notice.text}</AlertDescription>
          </Alert>
        ) : null}
        <WorkItemContextMenu items={props.workItems}>
          <div className="divide-y divide-border/50">
            {columns.map((column) => (
              <ListColumnSection
                key={column.id}
                column={column}
                expanded={!collapsedIds?.includes(column.id)}
                showDropIndicator={drag.overStateId === column.id}
                onToggle={() => toggleGroup(column.id)}
                t={t}
              >
                {workItems.length > 100 && column.tasks.length > 0 ? (
                  <Suspense
                    fallback={column.tasks.map((task) =>
                      renderTaskRow(task, column),
                    )}
                  >
                    <VirtualizedSortableList
                      items={column.tasks}
                      getItemId={(task) => task.id}
                      as="div"
                      className="relative"
                      estimateSize={46}
                      retainFocusId={retainFocusId}
                      onRetainFocus={onRetainFocus}
                      renderItem={(task, virtualItem) =>
                        renderTaskRow(task, column, virtualItem)
                      }
                    />
                  </Suspense>
                ) : (
                  column.tasks.map((task) => renderTaskRow(task, column))
                )}
              </ListColumnSection>
            ))}
          </div>
        </WorkItemContextMenu>
        <DragOverlay>
          {drag.dragged ? (
            <TaskDragPreview
              task={workItemKaneoView(drag.dragged)}
              projectSlug={workItemProjectSlug(drag.dragged)}
            />
          ) : null}
        </DragOverlay>
        {drag.childrenDialog}
      </DndContext>
      {props.isLoadMoreError ? (
        <Alert
          variant="error"
          role="alert"
          data-testid="work-item-list-page-error"
        >
          <AlertDescription>
            {t("workItems:list.errorDescription")}
            {!props.hasMore ? (
              <Button variant="outline" size="sm" onClick={props.onRetry}>
                {t("workItems:list.retry")}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {props.hasMore && props.onLoadMore ? (
        <div className="flex justify-center bg-background">
          <Button
            variant="outline"
            size="sm"
            disabled={props.isLoadingMore}
            onClick={props.onLoadMore}
            data-testid="work-item-list-load-more"
          >
            {props.isLoadingMore
              ? t("workItems:list.loadingMore")
              : t(
                  props.isLoadMoreError
                    ? "workItems:list.retry"
                    : "workItems:list.loadMore",
                )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
