import { closestCorners, DndContext, DragOverlay } from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription, Button } from "@taskdesk/ui";
import {
  type ComponentProps,
  type FocusEvent,
  lazy,
  memo,
  type PointerEvent,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { type DueDateStatus, getDueDateStatus } from "@/lib/due-date-status";
import { routes } from "@/lib/routes";
import {
  workItemKaneoView,
  workItemProjectSlug,
} from "@/lib/work-item-kaneo-view";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import type { WorkItemRow } from "@/types/work-item";
import loadVirtualizedSortableList, {
  isVirtualizedSortableListLoaded,
} from "./load-virtualized-sortable-list";
import loadWorkItemInlineFields, {
  isWorkItemInlineFieldsLoaded,
} from "./load-work-item-inline-fields";
import useWorkItemDragDrop from "./use-work-item-drag-drop";
import type { VirtualizedSortableItem } from "./virtualization/virtualized-sortable-list";
import { warmWorkItemDetailOnIntent } from "./warm-work-item-detail-on-intent";
import WorkItemContextMenu from "./work-item-context-menu";
import WorkItemLightList, {
  canPreviewWorkItemList,
} from "./work-item-light-list";
import WorkItemList, { type WorkItemListProps } from "./work-item-list";
import { WorkItemSlaBadge } from "./work-item-sla-badge";

// The grouped rows' virtual window and inline controls are fetched with this module, alongside
// the states query, and the grouped list renders once both are here. Rendered through their
// Suspense fallbacks instead, the window's mounted every row of a large group (500 on G11) and
// the controls' remounted each row when they arrived, so a click landing then was lost.
const loadRowModules = () =>
  Promise.all([loadVirtualizedSortableList(), loadWorkItemInlineFields()]);
void loadRowModules().catch(() => undefined);
const rowModulesLoaded = () =>
  isVirtualizedSortableListLoaded() && isWorkItemInlineFieldsLoaded();

// biome-ignore format: the contrast gate reads the lazy loader binding from a one-line `lazy(loader)`
const VirtualizedSortableList = lazy(loadVirtualizedSortableList) as unknown as typeof import("./virtualization/virtualized-sortable-list").default;
const WorkItemInlineFields = lazy(loadWorkItemInlineFields);

function isKeyboardFocus(target: EventTarget) {
  try {
    return target instanceof Element && target.matches(":focus-visible");
  } catch {
    return true; // shortcut: an engine without :focus-visible warms on any focus
  }
}

/** True once the row modules are loaded, or their download failed (the lazy path retries). */
function useRowModulesSettled() {
  const [settled, setSettled] = useState(rowModulesLoaded);
  useEffect(() => {
    if (settled) return;
    let current = true;
    loadRowModules().then(
      () => current && setSettled(true),
      () => current && setSettled(true),
    );
    return () => {
      current = false;
    };
  }, [settled]);
  return settled;
}

// One view object per row object, so an unchanged row keeps its `task` identity across renders.
const taskViews = new WeakMap<WorkItemRow, Task>();
function cachedTaskView(item: WorkItemRow) {
  let task = taskViews.get(item);
  if (!task) {
    task = workItemKaneoView(item);
    taskViews.set(item, task);
  }
  return task;
}

type ListRowProps = {
  item: WorkItemRow;
  task: Task;
  isFinal: boolean;
  projectSlug: string;
  displayPreferences: ComponentProps<typeof TaskRow>["displayPreferences"];
  disableDragDrop: boolean;
  selectionEnabled: boolean;
  isSelected: boolean;
  isPlaceholderData: boolean;
  openTaskOnLinkClick: boolean;
  onOpenItem: (key: string) => void;
  onToggleSelection: (key: string, selected: boolean) => void;
  /**
   * The row's due-date badge state, computed by the parent each render. TaskRow reads the clock
   * while rendering, so passing the state lets a skipped row re-render exactly when its badge
   * crosses a threshold.
   */
  dueStatus: DueDateStatus;
};

/** Only primitives, row objects and callbacks that are stable per list: an unchanged row skips. */
const WorkItemListRow = memo(function WorkItemListRow({
  item,
  task,
  isFinal,
  projectSlug,
  displayPreferences,
  disableDragDrop,
  selectionEnabled,
  isSelected,
  isPlaceholderData,
  openTaskOnLinkClick,
  onOpenItem,
  onToggleSelection,
}: ListRowProps) {
  const { t } = useTranslation();
  const rowProps = {
    task,
    projectSlug,
    taskIsCompleted: isFinal,
    displayPreferences,
    // Built here, not in the parent, so the SLA badge paints with its row and never later.
    badges: useMemo(() => <WorkItemSlaBadge sla={item.sla} />, [item.sla]),
    taskHref: routes.workItemDetail.build({ key: item.key }),
    openTaskOnLinkClick,
    onOpenTask: useCallback(() => onOpenItem(item.key), [onOpenItem, item.key]),
    disableDragDrop,
    selectionEnabled,
    isSelected,
    onToggleSelection: useCallback(
      () => onToggleSelection(item.key, !isSelected),
      [onToggleSelection, item.key, isSelected],
    ),
    t,
  };
  return (
    <Suspense fallback={<TaskRow {...rowProps} />}>
      <WorkItemInlineFields item={item} disabled={isPlaceholderData}>
        {(controls) => <TaskRow {...rowProps} {...controls} />}
      </WorkItemInlineFields>
    </Suspense>
  );
});

/** Kaneo presentation over canonical rows; all writes stay with canonical actions. */
export default function WorkItemKaneoList({
  projectId,
  workspaceId,
  onCreateInState,
  ...props
}: WorkItemListProps & {
  projectId?: string;
  workspaceId?: string;
  /** Kaneo's per-column "+": opens the create dialog for one state section. */
  onCreateInState?: (
    state: { id: string; name: string },
    trigger: HTMLButtonElement,
  ) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rowModulesSettled = useRowModulesSettled();
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

  // The latest handlers behind identity-stable callbacks, so memoised rows skip even when a caller
  // (cycle and module lists) passes a fresh handler on every render.
  const handlers = useRef({
    onOpenItem: props.onOpenItem,
    onSelectionChange: props.onSelectionChange,
    navigate,
  });
  useLayoutEffect(() => {
    handlers.current = {
      onOpenItem: props.onOpenItem,
      onSelectionChange: props.onSelectionChange,
      navigate,
    };
  });
  const openItem = useCallback((key: string) => {
    const { onOpenItem, navigate: go } = handlers.current;
    if (onOpenItem) onOpenItem(key);
    else void go({ href: routes.workItemDetail.build({ key }) });
  }, []);
  const toggleSelection = useCallback(
    (key: string, selected: boolean) =>
      handlers.current.onSelectionChange?.(key, selected),
    [],
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
    states.isLoading ||
    !rowModulesSettled
  ) {
    // While only the row modules are still downloading, keep the grouped list's first viewport
    // (the preview the panel painted) instead of swapping in the full table (G11 work-list LCP).
    if (
      !rowModulesSettled &&
      !props.isError &&
      !props.isLoading &&
      !props.isPlaceholderData &&
      states.data &&
      props.workItems &&
      canPreviewWorkItemList({
        workItems: props.workItems,
        states: states.data,
        sort: props.sort,
        hasPartialFailure: props.hasPartialFailure,
      })
    )
      return (
        <WorkItemLightList
          projectId={projectId}
          workItems={props.workItems}
          states={states.data}
        />
      );
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
        tasks: drag.itemsByState.get(state.id)?.map(cachedTaskView) ?? [],
      }) satisfies ProjectWithTasks["columns"][number],
  );
  const rowsById = new Map(workItems.map((item) => [item.id, item]));
  // Intent only: a mouse over the row, keyboard focus on it, or a mouse press starts reading its
  // item so the pane opens with data on the way. Touch and idle never do (G11 side pane).
  const warmRowDetail = (target: EventTarget | null) => {
    if (!props.onOpenItem || !(target instanceof Element)) return;
    const row = target.closest<HTMLElement>("[data-task-id]");
    const item = row?.dataset.taskId
      ? rowsById.get(row.dataset.taskId)
      : undefined;
    if (item && !item.unavailableFields.includes("key"))
      warmWorkItemDetailOnIntent(queryClient, item.key);
  };
  const handleRowPointerOver = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    const row = (event.target as Element).closest("[data-task-id]");
    if (
      row &&
      event.relatedTarget instanceof Node &&
      row.contains(event.relatedTarget)
    )
      return;
    warmRowDetail(event.target);
  };
  const handleRowPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") warmRowDetail(event.target);
  };
  const handleRowFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (isKeyboardFocus(event.target)) warmRowDetail(event.target);
  };
  const renderTaskRow = (
    task: ProjectWithTasks["columns"][number]["tasks"][number],
    column: ProjectWithTasks["columns"][number],
    virtualItem?: VirtualizedSortableItem,
  ) => {
    const item = rowsById.get(task.id);
    if (!item) return null;
    const inlineRow = (
      <WorkItemListRow
        key={task.id}
        item={item}
        task={task}
        dueStatus={getDueDateStatus(item.dueDate, column.isFinal)}
        isFinal={column.isFinal}
        projectSlug={workItemProjectSlug(item)}
        displayPreferences={displayPreferences}
        disableDragDrop={
          props.isPlaceholderData ||
          drag.pendingItemIds.has(item.id) ||
          item.unavailableFields.includes("key") ||
          (!drag.canReorder &&
            (permission.isCheckingPermissions ||
              !permission.canTransitionTasks()))
        }
        selectionEnabled={Boolean(
          props.canBulkAssign && props.onSelectionChange,
        )}
        isSelected={props.selectedKeys?.includes(item.key) ?? false}
        isPlaceholderData={Boolean(props.isPlaceholderData)}
        openTaskOnLinkClick={Boolean(props.onOpenItem)}
        onOpenItem={openItem}
        onToggleSelection={toggleSelection}
      />
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
        <WorkItemContextMenu items={props.workItems}>
          <div
            className="divide-y divide-border/50"
            onPointerOver={handleRowPointerOver}
            onPointerDown={handleRowPointerDown}
            onFocusCapture={handleRowFocus}
          >
            {columns.map((column) => (
              <ListColumnSection
                key={column.id}
                column={column}
                expanded={!collapsedIds?.includes(column.id)}
                showDropIndicator={drag.overStateId === column.id}
                onToggle={() => toggleGroup(column.id)}
                onAddTask={
                  onCreateInState &&
                  !permission.isCheckingPermissions &&
                  permission.canCreateTasks()
                    ? (trigger) =>
                        onCreateInState(
                          { id: column.id, name: column.name },
                          trigger,
                        )
                    : undefined
                }
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
        <DragOverlay dropAnimation={drag.dropAnimation}>
          {drag.dragged ? (
            <TaskDragPreview
              task={workItemKaneoView(drag.dragged)}
              projectSlug={workItemProjectSlug(drag.dragged)}
            />
          ) : null}
        </DragOverlay>
        {drag.childrenDialog}
        {drag.noteDialog}
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
