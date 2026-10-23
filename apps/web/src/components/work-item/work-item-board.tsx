import {
  closestCorners,
  DndContext,
  DragOverlay,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { type ReactNode, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { ColumnShell } from "@/components/kanban-board/column/column-shell";
import TaskCard from "@/components/kanban-board/task-card";
import { useDndAccessibility } from "@/hooks/use-dnd-accessibility";
import { getColumnIcon } from "@/lib/column";
import {
  routes,
  type WorkItemSortDirection,
  type WorkItemSortField,
} from "@/lib/routes";
import {
  workItemKaneoView,
  workItemProjectSlug,
} from "@/lib/work-item-kaneo-view";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { WorkItemRow } from "@/types/work-item";
import useWorkItemDragDrop from "./use-work-item-drag-drop";
import { WorkItemBlockedBadge } from "./work-item-blocked-badge";
import WorkItemContextMenu from "./work-item-context-menu";

type ProjectState = { id: string; name: string; group?: string };

/**
 * The project board (`docs/03-features/views.md` `VW-8`-`VW-10`, `VW-14`): one column per
 * active project state in project order, cards in rank order.
 *
 * Capabilities are inputs, not inferences. `canTransition` and `canRank` are the strict
 * `transitionTasks` / `rankTasks` flags from `/api/capabilities`; a control that needs one is
 * not rendered without it. That is a usability affordance only -- the server re-checks every
 * write, and every failure it returns is surfaced here (404 gone, 409 conflict, 422 rejected).
 *
 * Kaneo's mouse, touch and keyboard sensors drive canonical rank/transition writes.
 * Workflow offers and guards remain authoritative; failures refresh persisted rows.
 */
export default function WorkItemBoard({
  projectId,
  states,
  statesError,
  workItems,
  isLoading,
  isError,
  onRetry,
  hasMore,
  isLoadingMore,
  onLoadMore,
  canSelect,
  canTransition,
  canRank,
  selectedKeys,
  onSelectionChange,
  onOpenItem,
  sort = "position",
  dir = "asc",
}: {
  projectId: string;
  /** Must match the server query: non-rank sorts retain its cursor order. */
  sort?: WorkItemSortField;
  dir?: WorkItemSortDirection;
  states: ProjectState[] | undefined;
  statesError: boolean;
  workItems: WorkItemRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  canSelect: boolean;
  canTransition: boolean;
  canRank: boolean;
  selectedKeys: string[];
  onSelectionChange: (key: string, checked: boolean) => void;
  onOpenItem?: (key: string) => void;
}) {
  const { t } = useTranslation();
  const {
    dragged,
    busy,
    notice,
    canReorder,
    itemsByState,
    containerRef: boardRef,
    sensors,
    dropAnimation,
    startDrag,
    endDrag,
    cancelDrag,
    childrenDialog,
  } = useWorkItemDragDrop({
    projectId,
    states,
    workItems,
    canRank,
    canTransition,
    sort,
    dir,
  });
  const describeDnd = useCallback(
    (id: string | number) =>
      workItems?.find((item) => item.id === id)?.title ??
      states?.find((state) => state.id === id)?.name,
    [workItems, states],
  );
  const dndAccessibility = useDndAccessibility(describeDnd);

  if (isError || statesError) {
    return (
      <Alert variant="error" data-primary-content-ready="true">
        <AlertTitle>{t("workItems:board.loadErrorTitle")}</AlertTitle>
        <AlertDescription>
          {t("workItems:board.loadErrorDescription")}
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t("workItems:board.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (isLoading || !states) {
    return (
      <div
        className="flex gap-4 overflow-x-auto p-4"
        aria-busy="true"
        data-testid="work-item-board-loading"
      >
        {["one", "two", "three", "four"].map((key) => (
          <Skeleton key={key} className="h-72 min-w-72" />
        ))}
      </div>
    );
  }

  if (states.length === 0) {
    return (
      <Empty data-primary-content-ready="true">
        <EmptyHeader>
          <EmptyTitle>{t("workItems:board.noStatesTitle")}</EmptyTitle>
          <EmptyDescription>
            {t("workItems:board.noStatesDescription")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <DndContext
      accessibility={dndAccessibility}
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={startDrag}
      onDragEnd={endDrag}
      onDragCancel={cancelDrag}
    >
      <WorkItemContextMenu items={workItems ?? []}>
        <div
          ref={boardRef}
          className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-linear-to-b from-muted/20 to-background"
          data-testid="work-item-board"
          data-primary-content-ready="true"
        >
          <p className="sr-only" role="status" aria-live="polite">
            {notice?.kind === "status" ? notice.text : ""}
          </p>
          {notice?.kind === "error" ? (
            <Alert
              variant="error"
              role="alert"
              data-testid="work-item-board-error"
            >
              <AlertDescription>{notice.text}</AlertDescription>
            </Alert>
          ) : null}
          <div className="min-h-0 flex-1 overflow-x-auto [-webkit-overflow-scrolling:touch]">
            <div className="flex h-full min-w-max gap-4 px-4 py-4 md:px-5">
              {states.map((state) => {
                const stateItems = itemsByState.get(state.id) ?? [];
                const selectable = stateItems.filter(
                  (item) => !item.unavailableFields.includes("key"),
                );
                const headingId = `work-item-board-column-${state.id}`;
                return (
                  <BoardColumn
                    key={state.id}
                    state={state}
                    headingId={headingId}
                    disabled={busy || (!canTransition && !canReorder)}
                    header={
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-muted-foreground">
                            {getColumnIcon(
                              state.id,
                              state.group === "completed" ||
                                state.group === "cancelled",
                            )}
                          </span>
                          <h2
                            id={headingId}
                            className="truncate text-sm font-medium text-foreground/95"
                          >
                            {state.name}
                          </h2>
                          <span
                            role="img"
                            className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
                            aria-label={t("workItems:board.columnCount", {
                              total: stateItems.length,
                              state: state.name,
                            })}
                          >
                            {stateItems.length}
                          </span>
                        </div>
                        {canSelect && selectable.length > 0 && (
                          <Checkbox
                            aria-label={t("workItems:board.selectColumn", {
                              state: state.name,
                            })}
                            checked={selectable.every((item) =>
                              selectedKeys.includes(item.key),
                            )}
                            onCheckedChange={(checked) => {
                              for (const item of selectable) {
                                onSelectionChange(item.key, Boolean(checked));
                              }
                            }}
                          />
                        )}
                      </div>
                    }
                  >
                    <SortableContext
                      items={stateItems.map((item) => item.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {stateItems.length === 0 ? (
                        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                          {t("workItems:board.emptyColumn")}
                        </p>
                      ) : (
                        <ul className="flex min-h-24 flex-1 list-none flex-col gap-2 py-1">
                          {stateItems.map((item) => (
                            <BoardCard
                              key={item.id}
                              item={item}
                              state={state}
                              busy={busy}
                              canSelect={canSelect}
                              canTransition={canTransition}
                              canRank={canReorder}
                              selected={selectedKeys.includes(item.key)}
                              onSelectionChange={onSelectionChange}
                              onOpenItem={onOpenItem}
                            />
                          ))}
                        </ul>
                      )}
                    </SortableContext>
                  </BoardColumn>
                );
              })}
            </div>
          </div>
          {hasMore && (
            <div className="flex justify-center pb-3">
              <Button
                variant="outline"
                disabled={isLoadingMore}
                onClick={onLoadMore}
              >
                {isLoadingMore
                  ? t("workItems:board.loadingMore")
                  : t("workItems:board.loadMore")}
              </Button>
            </div>
          )}
        </div>
      </WorkItemContextMenu>
      <DragOverlay dropAnimation={dropAnimation}>
        {dragged ? (
          <div className="transform rotate-1 scale-[1.03] shadow-lg">
            <div className="ring-2 ring-ring/35 rounded-lg">
              <BoardCard
                item={dragged}
                state={
                  (states ?? []).find(
                    (state) => state.id === dragged.stateId,
                  ) ?? { id: dragged.stateId, name: dragged.stateName }
                }
                busy
                canSelect={false}
                canTransition={false}
                canRank={false}
                selected={false}
                onSelectionChange={() => {}}
                onOpenItem={onOpenItem}
                overlay
              />
            </div>
          </div>
        ) : null}
      </DragOverlay>
      {childrenDialog}
    </DndContext>
  );
}

function BoardColumn({
  state,
  headingId,
  header,
  children,
  disabled,
}: {
  state: ProjectState;
  headingId: string;
  header: ReactNode;
  children: ReactNode;
  disabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: state.id,
    disabled,
    data: { type: "column", state },
  });
  return (
    <fieldset
      ref={setNodeRef}
      aria-labelledby={headingId}
      data-testid="work-item-board-column"
      data-state-id={state.id}
      className="m-0 h-full min-h-0 max-w-96 min-w-80 shrink-0 flex-1 border-0 p-0"
    >
      <ColumnShell header={header} isOver={isOver}>
        {children}
      </ColumnShell>
    </fieldset>
  );
}

/** One Kaneo task card for a canonical row; shared with the grouped board (`VW-13`). */
export function BoardCard({
  item,
  state,
  busy,
  canSelect,
  canTransition,
  canRank,
  selected,
  onSelectionChange,
  onOpenItem,
  overlay = false,
}: {
  item: WorkItemRow;
  state: ProjectState;
  busy: boolean;
  canSelect: boolean;
  canTransition: boolean;
  canRank: boolean;
  selected: boolean;
  onSelectionChange: (key: string, checked: boolean) => void;
  onOpenItem?: (key: string) => void;
  overlay?: boolean;
}) {
  const { t } = useTranslation();
  const displayPreferences = useUserPreferencesStore(
    useShallow((preferences) => ({
      showAssignees: preferences.showAssignees,
      showPriority: preferences.showPriority,
      showDueDates: preferences.showDueDates,
      showLabels: preferences.showLabels,
      showTaskNumbers: preferences.showTaskNumbers,
      showTaskItemCounts: preferences.showTaskItemCounts,
    })),
  );
  const actionable = !item.unavailableFields.includes("key");
  return (
    <li
      data-testid={
        overlay ? "work-item-drag-overlay-card" : "work-item-board-card"
      }
      data-work-item-key={item.key}
      className="group/board-card flex flex-col gap-2"
    >
      {canSelect ? (
        <div className="flex items-start gap-2">
          <Checkbox
            aria-label={t("workItems:bulk.selectItem", { key: item.key })}
            checked={selected}
            disabled={!actionable}
            onCheckedChange={(checked) =>
              onSelectionChange(item.key, Boolean(checked))
            }
          />
        </div>
      ) : null}
      <TaskCard
        task={{
          ...workItemKaneoView(item),
          title: item.unavailableFields.includes("title")
            ? t("workItems:list.unavailable")
            : item.title,
        }}
        disableDragDrop={
          overlay || busy || !actionable || (!canTransition && !canRank)
        }
        workspaceId={item.workspaceId}
        projectSlug={workItemProjectSlug(item)}
        taskHref={
          actionable
            ? routes.workItemDetail.build({ key: item.key })
            : undefined
        }
        taskIsCompleted={
          item.stateCategory === "completed" ||
          item.stateCategory === "cancelled"
        }
        displayPreferences={{
          ...displayPreferences,
          showPriority:
            displayPreferences.showPriority &&
            !item.unavailableFields.includes("priority"),
          showDueDates:
            displayPreferences.showDueDates &&
            !item.unavailableFields.includes("dueDate"),
          showAssignees:
            displayPreferences.showAssignees &&
            !item.unavailableFields.includes("assigneeName"),
          showTaskNumbers: displayPreferences.showTaskNumbers && actionable,
        }}
        isSelected={selected}
        isFocused={false}
        selectionEnabled={canSelect && actionable}
        onToggleSelection={() => onSelectionChange(item.key, !selected)}
        onContextMenuTask={() => {}}
        openTaskOnLinkClick={Boolean(onOpenItem)}
        onOpenTask={() => {
          if (!actionable || overlay) return;
          if (onOpenItem) onOpenItem(item.key);
          else
            window.location.assign(
              routes.workItemDetail.build({ key: item.key }),
            );
        }}
        t={t}
      />
      <WorkItemBlockedBadge
        blockedByOpenCount={item.blockedByOpenCount}
        className="self-start"
      />
      {!actionable || item.unavailableFields.includes("priority") ? (
        <span className="sr-only">{t("workItems:list.unavailable")}</span>
      ) : null}
      <span className="sr-only">
        {t("workItems:board.currentState", { state: state.name })}
      </span>
    </li>
  );
}
