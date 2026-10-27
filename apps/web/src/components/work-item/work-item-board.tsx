import {
  type CollisionDetection,
  closestCorners,
  DndContext,
  DragOverlay,
  pointerWithin,
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
import { Plus } from "lucide-react";
import {
  type CSSProperties,
  lazy,
  type ReactNode,
  type Ref,
  Suspense,
  useCallback,
  useState,
} from "react";
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
import type {
  CombinedWorkItemColumn,
  CombinedWorkItemRow,
} from "@/types/work-item/combined";
import ColumnCountBadge from "./column-count-badge";
import useWorkItemDragDrop from "./use-work-item-drag-drop";
import type { VirtualizedSortableItem } from "./virtualization/virtualized-sortable-list";
import { WorkItemBlockedBadge } from "./work-item-blocked-badge";
import WorkItemContextMenu from "./work-item-context-menu";
import { WorkItemSlaBadge } from "./work-item-sla-badge";

/** Pointer drops should land in an empty combined column; keyboard keeps Kaneo's corner fallback. */
export const combinedBoardCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0
    ? pointerCollisions
    : closestCorners(args);
};

const VirtualizedSortableList = lazy(
  () => import("./virtualization/virtualized-sortable-list"),
) as unknown as typeof import("./virtualization/virtualized-sortable-list").default;

type ProjectState = { id: string; name: string; group?: string };

function getCombinedSourceProject(
  item: WorkItemRow,
): CombinedWorkItemRow["sourceProject"] | undefined {
  const row = item as CombinedWorkItemRow;
  return typeof row.sourceProject?.id === "string" &&
    typeof row.sourceProject.key === "string" &&
    typeof row.sourceProject.name === "string"
    ? row.sourceProject
    : undefined;
}

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
  wipLimits,
  combinedColumns,
  combinedCapabilities,
  onCreateInState,
}: {
  projectId: string;
  /**
   * Kaneo's per-column "+" (feature-contracts-p1 views edge cases): opens the create dialog for
   * this column. Omitted when the caller cannot create, and never offered on a combined board.
   */
  onCreateInState?: (
    state: { id: string; name: string },
    trigger: HTMLButtonElement,
  ) => void;
  /** `VW-12`: optional work-in-progress limit per state id. */
  wipLimits?: ReadonlyMap<string, number>;
  /** Template IDs are presentation columns only; items retain their concrete states. */
  combinedColumns?: CombinedWorkItemColumn[];
  combinedCapabilities?: ReadonlyMap<
    string,
    { canRank: boolean; canTransition: boolean; canBulkAct: boolean }
  >;
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
  const combined = Boolean(combinedColumns);
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
    combined,
    canRankForProject: (sourceProjectId) =>
      combinedCapabilities?.get(sourceProjectId)?.canRank ?? false,
    canTransitionForProject: (sourceProjectId) =>
      combinedCapabilities?.get(sourceProjectId)?.canTransition ?? false,
  });
  const describeDnd = useCallback(
    (id: string | number) =>
      workItems?.find((item) => item.id === id)?.title ??
      states?.find((state) => state.id === id)?.name,
    [workItems, states],
  );
  const dndAccessibility = useDndAccessibility(describeDnd);
  const [retainFocusId, setRetainFocusId] = useState<string>();
  const onRetainFocus = useCallback(() => setRetainFocusId(undefined), []);

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
      collisionDetection={
        combined ? combinedBoardCollisionDetection : closestCorners
      }
      onDragStart={(event) => {
        setRetainFocusId(undefined);
        startDrag(event);
      }}
      onDragEnd={(event) => {
        if (event.over) setRetainFocusId(String(event.active.id));
        endDrag(event);
      }}
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
                const selectable = stateItems.filter((item) => {
                  const itemCanBulkAct = combined
                    ? (combinedCapabilities?.get(item.projectId)?.canBulkAct ??
                      false)
                    : canSelect;
                  return (
                    itemCanBulkAct && !item.unavailableFields.includes("key")
                  );
                });
                const headingId = `work-item-board-column-${state.id}`;
                return (
                  <BoardColumn
                    key={state.id}
                    state={state}
                    headingId={headingId}
                    disabled={busy || (!canTransition && !canReorder)}
                    combined={combined}
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
                          <ColumnCountBadge
                            total={stateItems.length}
                            limit={wipLimits?.get(state.id)}
                            state={state.name}
                          />
                        </div>
                        <div className="flex items-center gap-1">
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
                          {onCreateInState && !combined ? (
                            <Button
                              variant="ghost"
                              type="button"
                              onClick={(event) =>
                                onCreateInState(
                                  { id: state.id, name: state.name },
                                  event.currentTarget,
                                )
                              }
                              className="flex items-center rounded-md px-2 py-1 text-left text-muted-foreground transition-colors hover:bg-accent/50"
                              title={t("tasks:kanban.addTask")}
                              aria-label={`${t("tasks:kanban.addTask")}: ${state.name}`}
                              data-testid="work-item-board-column-create"
                            >
                              <Plus className="w-4 h-4 text-muted-foreground" />
                            </Button>
                          ) : null}
                        </div>
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
                      ) : stateItems.length > 50 ? (
                        <Suspense
                          fallback={
                            <ul className="flex min-h-24 flex-1 list-none flex-col gap-2 py-1">
                              {stateItems.map((item) => (
                                <BoardCard
                                  key={item.id}
                                  item={item}
                                  state={state}
                                  busy={busy}
                                  canSelect={
                                    combined
                                      ? canSelect &&
                                        (combinedCapabilities?.get(
                                          item.projectId,
                                        )?.canBulkAct ??
                                          false)
                                      : canSelect
                                  }
                                  canTransition={
                                    combined
                                      ? (combinedCapabilities?.get(
                                          item.projectId,
                                        )?.canTransition ?? false)
                                      : canTransition
                                  }
                                  canRank={
                                    combined
                                      ? sort === "position" &&
                                        dir === "asc" &&
                                        (combinedCapabilities?.get(
                                          item.projectId,
                                        )?.canRank ??
                                          false)
                                      : canReorder
                                  }
                                  selected={selectedKeys.includes(item.key)}
                                  onSelectionChange={onSelectionChange}
                                  onOpenItem={onOpenItem}
                                  sourceProject={
                                    combined
                                      ? getCombinedSourceProject(item)
                                      : undefined
                                  }
                                />
                              ))}
                            </ul>
                          }
                        >
                          <VirtualizedSortableList
                            items={stateItems}
                            getItemId={(item) => item.id}
                            as="ul"
                            className="flex min-h-24 flex-1 list-none flex-col gap-2 py-1"
                            estimateSize={150}
                            gap={8}
                            retainFocusId={retainFocusId}
                            onRetainFocus={onRetainFocus}
                            renderItem={(item, virtualItem) => (
                              <BoardCard
                                key={item.id}
                                item={item}
                                state={state}
                                busy={busy}
                                canSelect={
                                  combined
                                    ? canSelect &&
                                      (combinedCapabilities?.get(item.projectId)
                                        ?.canBulkAct ??
                                        false)
                                    : canSelect
                                }
                                canTransition={
                                  combined
                                    ? (combinedCapabilities?.get(item.projectId)
                                        ?.canTransition ?? false)
                                    : canTransition
                                }
                                canRank={
                                  combined
                                    ? sort === "position" &&
                                      dir === "asc" &&
                                      (combinedCapabilities?.get(item.projectId)
                                        ?.canRank ??
                                        false)
                                    : canReorder
                                }
                                selected={selectedKeys.includes(item.key)}
                                onSelectionChange={onSelectionChange}
                                onOpenItem={onOpenItem}
                                sourceProject={
                                  combined
                                    ? getCombinedSourceProject(item)
                                    : undefined
                                }
                                virtualItem={virtualItem}
                              />
                            )}
                          />
                        </Suspense>
                      ) : (
                        <ul className="flex min-h-24 flex-1 list-none flex-col gap-2 py-1">
                          {stateItems.map((item) => (
                            <BoardCard
                              key={item.id}
                              item={item}
                              state={state}
                              busy={busy}
                              canSelect={
                                combined
                                  ? canSelect &&
                                    (combinedCapabilities?.get(item.projectId)
                                      ?.canBulkAct ??
                                      false)
                                  : canSelect
                              }
                              canTransition={
                                combined
                                  ? (combinedCapabilities?.get(item.projectId)
                                      ?.canTransition ?? false)
                                  : canTransition
                              }
                              canRank={
                                combined
                                  ? sort === "position" &&
                                    dir === "asc" &&
                                    (combinedCapabilities?.get(item.projectId)
                                      ?.canRank ??
                                      false)
                                  : canReorder
                              }
                              selected={selectedKeys.includes(item.key)}
                              onSelectionChange={onSelectionChange}
                              onOpenItem={onOpenItem}
                              sourceProject={
                                combined
                                  ? getCombinedSourceProject(item)
                                  : undefined
                              }
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
                sourceProject={
                  combined ? getCombinedSourceProject(dragged) : undefined
                }
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
  combined = false,
}: {
  state: ProjectState;
  headingId: string;
  header: ReactNode;
  children: ReactNode;
  disabled: boolean;
  combined?: boolean;
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
      {...(combined
        ? { "data-template-id": state.id }
        : { "data-state-id": state.id })}
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
  sortableId,
  state,
  busy,
  canSelect,
  canTransition,
  canRank,
  selected,
  onSelectionChange,
  onOpenItem,
  overlay = false,
  virtualItem,
  sourceProject,
}: {
  item: WorkItemRow;
  /** DnD-only identifier for a card rendered in more than one group. */
  sortableId?: string;
  state: ProjectState;
  busy: boolean;
  canSelect: boolean;
  canTransition: boolean;
  canRank: boolean;
  selected: boolean;
  onSelectionChange: (key: string, checked: boolean) => void;
  onOpenItem?: (key: string) => void;
  overlay?: boolean;
  virtualItem?: VirtualizedSortableItem;
  sourceProject?: CombinedWorkItemRow["sourceProject"];
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
      ref={virtualItem?.measureRef as Ref<HTMLLIElement> | undefined}
      data-index={virtualItem?.index}
      data-virtual-item-id={virtualItem?.id}
      data-testid={
        overlay ? "work-item-drag-overlay-card" : "work-item-board-card"
      }
      data-work-item-key={item.key}
      style={virtualItem?.style as CSSProperties | undefined}
      className="group/board-card flex flex-col gap-2"
    >
      {sourceProject ? (
        <span
          className="px-1 text-xs text-muted-foreground"
          data-source-project-id={sourceProject.id}
        >
          {sourceProject.key} · {sourceProject.name}
        </span>
      ) : null}
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
        sortableId={sortableId}
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
        badges={item.sla ? <WorkItemSlaBadge sla={item.sla} /> : undefined}
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
