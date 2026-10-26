import {
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
import { useQuery } from "@tanstack/react-query";
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
import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar";
import { ColumnShell } from "@/components/kanban-board/column/column-shell";
import { getProjectLabels } from "@/fetchers/label/project-labels";
import getAssignablePeople from "@/fetchers/work-item/get-assignable-people";
import { useDndAccessibility } from "@/hooks/use-dnd-accessibility";
import { getInitials } from "@/lib/get-initials";
import { getPriorityIcon } from "@/lib/priority";
import {
  boardGroupItemId,
  buildBoardGroups,
  type CustomFieldGroupDefinition,
  type CustomFieldGroupPerson,
  parseBoardGroupId,
  parseBoardGroupItemId,
  type WorkItemBoardGroup,
  type WorkItemBoardGroupField,
} from "@/lib/work-item-board-groups";
import type { WorkItemRow } from "@/types/work-item";
import useWorkItemGroupDrag from "./use-work-item-group-drag";
import { BoardCard } from "./work-item-board";
import WorkItemContextMenu from "./work-item-context-menu";

const VirtualizedSortableList = lazy(
  () => import("./virtualization/virtualized-sortable-list"),
) as unknown as typeof import("./virtualization/virtualized-sortable-list").default;

export function groupedBoardCollisionDetection(
  args: Parameters<typeof closestCorners>[0],
) {
  if (args.pointerCoordinates) {
    const group = pointerWithin(args).find((collision) =>
      parseBoardGroupId(collision.id),
    );
    return group ? [group] : [];
  }
  return closestCorners(args);
}

/**
 * `VW-13`: the Kaneo board with its columns split by assignee or priority instead of state.
 * The columns, cards, drag overlay and selection are the board's own; only the grouping and
 * what a drop writes differ (`use-work-item-group-drag.ts`). State transitions and rank
 * belong to the state grouping, so neither is offered here.
 */
export default function WorkItemGroupedBoard({
  projectId,
  field,
  customField,
  customFieldPeople = [],
  workItems,
  peopleEnabled,
  isLoading,
  isError,
  onRetry,
  hasMore,
  isLoadingMore,
  onLoadMore,
  canSelect,
  canAssign,
  canUnassignAny,
  canUpdate,
  canSetPriority,
  selectedKeys,
  onSelectionChange,
  onOpenItem,
}: {
  projectId: string;
  field: WorkItemBoardGroupField;
  customField?: CustomFieldGroupDefinition;
  customFieldPeople?: CustomFieldGroupPerson[];
  workItems: WorkItemRow[] | undefined;
  /** Whether the assignable people may be fetched yet (capabilities have loaded). */
  peopleEnabled: boolean;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  canSelect: boolean;
  canAssign: boolean;
  /** `assign` capability: may clear anyone's assignee (else only people on the project). */
  canUnassignAny: boolean;
  canUpdate: boolean;
  canSetPriority: boolean;
  selectedKeys: string[];
  onSelectionChange: (key: string, checked: boolean) => void;
  onOpenItem?: (key: string) => void;
}) {
  const { t } = useTranslation();
  // The assignee columns are the project's assignable people, so a person with no card yet is
  // still a drop target. The context menu reads the same query.
  const peopleQuery = useQuery({
    queryKey: ["projects", projectId, "assignable"],
    queryFn: () => getAssignablePeople(projectId),
    enabled: field === "assignee" && peopleEnabled,
    staleTime: 30_000,
  });
  const labelsQuery = useQuery({
    queryKey: ["projects", projectId, "labels"],
    queryFn: () => getProjectLabels(projectId),
    enabled: field === "label",
    staleTime: 30_000,
  });
  const people = useMemo(
    () =>
      (peopleQuery.data ?? []).map((person) => ({
        personId: person.personId,
        name: person.name,
      })),
    [peopleQuery.data],
  );
  const labels = useMemo(
    () =>
      (labelsQuery.data ?? []).map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      })),
    [labelsQuery.data],
  );
  const groups = useMemo(
    () =>
      buildBoardGroups(
        field,
        workItems ?? [],
        people,
        customField,
        customFieldPeople,
        labels,
        canUpdate,
      ),
    [
      field,
      workItems,
      people,
      customField,
      customFieldPeople,
      labels,
      canUpdate,
    ],
  );
  const drag = useWorkItemGroupDrag({
    projectId,
    field,
    workItems,
    groups,
    people,
    canAssign,
    canUpdate,
    canUnassign: (item) =>
      canUnassignAny ||
      (canUpdate &&
        people.some((person) => person.personId === item.assigneeId)),
    canSetPriority: canUpdate && canSetPriority,
    customField,
  });

  const describeDnd = useCallback(
    (id: string | number) => {
      const active = String(id);
      const draggedItemId = parseBoardGroupItemId(active)?.itemId ?? active;
      const title = workItems?.find((item) => item.id === draggedItemId)?.title;
      if (title) return title;
      const group = groups.find((candidate) => candidate.id === id);
      return group ? drag.groupName(group) : undefined;
    },
    [workItems, groups, drag],
  );
  const dndAccessibility = useDndAccessibility(describeDnd);
  const [retainFocusId, setRetainFocusId] = useState<string>();
  const onRetainFocus = useCallback(() => setRetainFocusId(undefined), []);

  if (
    isError ||
    (field === "assignee" && peopleQuery.isError) ||
    (field === "label" && labelsQuery.isError)
  ) {
    return (
      <Alert variant="error" data-primary-content-ready="true">
        <AlertTitle>{t("workItems:board.loadErrorTitle")}</AlertTitle>
        <AlertDescription>
          {t("workItems:board.loadErrorDescription")}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onRetry();
              void peopleQuery.refetch();
              void labelsQuery.refetch();
            }}
          >
            {t("workItems:board.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (
    isLoading ||
    (field === "assignee" && peopleQuery.isLoading) ||
    (field === "label" && labelsQuery.isLoading)
  ) {
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

  if (groups.length === 0) {
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
      sensors={drag.sensors}
      collisionDetection={groupedBoardCollisionDetection}
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
    >
      <WorkItemContextMenu items={workItems ?? []}>
        <div
          ref={drag.containerRef}
          className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-linear-to-b from-muted/20 to-background"
          data-testid="work-item-board"
          data-group={field}
          data-primary-content-ready="true"
        >
          <p className="sr-only" role="status" aria-live="polite">
            {drag.notice?.kind === "status" ? drag.notice.text : ""}
          </p>
          {drag.notice?.kind === "error" ? (
            <Alert
              variant="error"
              role="alert"
              data-testid="work-item-board-error"
            >
              <AlertDescription>{drag.notice.text}</AlertDescription>
            </Alert>
          ) : null}
          <div className="min-h-0 flex-1 overflow-x-auto [-webkit-overflow-scrolling:touch]">
            <div className="flex h-full min-w-max gap-4 px-4 py-4 md:px-5">
              {groups.map((group) => (
                <GroupColumn
                  key={group.id}
                  group={group}
                  name={drag.groupName(group)}
                  disabled={drag.busy || !drag.canWrite || !group.droppable}
                  isOver={drag.overGroupId === group.id}
                  canSelect={canSelect}
                  selectedKeys={selectedKeys}
                  onSelectionChange={onSelectionChange}
                  onOpenItem={onOpenItem}
                  busy={drag.busy}
                  canWrite={drag.canWrite}
                  retainFocusId={retainFocusId}
                  onRetainFocus={onRetainFocus}
                />
              ))}
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
      <DragOverlay dropAnimation={drag.dropAnimation}>
        {drag.dragged ? (
          <div className="transform rotate-1 scale-[1.03] shadow-lg">
            <div className="ring-2 ring-ring/35 rounded-lg">
              <BoardCard
                item={drag.dragged}
                state={{
                  id: drag.dragged.stateId,
                  name: drag.dragged.stateName,
                }}
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
    </DndContext>
  );
}

function GroupIcon({ group }: { group: WorkItemBoardGroup }) {
  if (group.field === "priority")
    return (
      <span className="text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">
        {getPriorityIcon(String(group.value ?? "no-priority"))}
      </span>
    );
  if (group.field === "label")
    return (
      <span
        aria-hidden="true"
        className="size-3.5 shrink-0 rounded-full border border-border/50"
        style={{ backgroundColor: group.color }}
      />
    );
  return (
    <Avatar className="h-5 w-5">
      <AvatarImage src="" alt="" />
      <AvatarFallback className="border border-border/30 text-[10px] font-medium">
        {group.value === null ? "–" : getInitials(group.name)}
      </AvatarFallback>
    </Avatar>
  );
}

function GroupColumn({
  group,
  name,
  disabled,
  isOver,
  canSelect,
  selectedKeys,
  onSelectionChange,
  onOpenItem,
  busy,
  canWrite,
  retainFocusId,
  onRetainFocus,
}: {
  group: WorkItemBoardGroup;
  name: string;
  disabled: boolean;
  isOver: boolean;
  canSelect: boolean;
  selectedKeys: string[];
  onSelectionChange: (key: string, checked: boolean) => void;
  onOpenItem?: (key: string) => void;
  busy: boolean;
  canWrite: boolean;
  retainFocusId?: string;
  onRetainFocus: () => void;
}) {
  const { t } = useTranslation();
  const { setNodeRef } = useDroppable({
    id: group.id,
    disabled,
    data: { type: "group", group: group.id },
  });
  const headingId = `work-item-board-group-${group.id}`;
  const selectable = group.items.filter(
    (item) => !item.unavailableFields.includes("key"),
  );
  return (
    <fieldset
      ref={setNodeRef}
      aria-labelledby={headingId}
      data-testid="work-item-board-column"
      data-group-id={group.id}
      className="m-0 h-full min-h-0 max-w-96 min-w-80 shrink-0 flex-1 border-0 p-0"
    >
      <ColumnShell
        isOver={isOver}
        header={
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <GroupIcon group={group} />
              <h2
                id={headingId}
                className="truncate text-sm font-medium text-foreground/95"
              >
                {name}
              </h2>
              <span
                role="img"
                className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
                aria-label={t("workItems:board.groupCount", {
                  total: group.items.length,
                  group: name,
                })}
              >
                {group.items.length}
              </span>
            </div>
            {canSelect && selectable.length > 0 && (
              <Checkbox
                aria-label={t("workItems:board.selectColumn", { state: name })}
                checked={selectable.every((item) =>
                  selectedKeys.includes(item.key),
                )}
                onCheckedChange={(checked) => {
                  for (const item of selectable)
                    onSelectionChange(item.key, Boolean(checked));
                }}
              />
            )}
          </div>
        }
      >
        <SortableContext
          items={group.items.map((item) => boardGroupItemId(group, item.id))}
          strategy={verticalListSortingStrategy}
        >
          {group.items.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
              {t("workItems:board.groupEmpty")}
            </p>
          ) : group.items.length > 50 ? (
            <Suspense
              fallback={
                <ul className="flex min-h-24 flex-1 list-none flex-col gap-2 py-1">
                  {group.items.map((item) => (
                    <BoardCard
                      key={item.id}
                      item={item}
                      sortableId={boardGroupItemId(group, item.id)}
                      state={{ id: item.stateId, name: item.stateName }}
                      busy={busy}
                      canSelect={canSelect}
                      canTransition={canWrite && group.droppable}
                      canRank={false}
                      selected={selectedKeys.includes(item.key)}
                      onSelectionChange={onSelectionChange}
                      onOpenItem={onOpenItem}
                    />
                  ))}
                </ul>
              }
            >
              <VirtualizedSortableList
                items={group.items}
                getItemId={(item) => boardGroupItemId(group, item.id)}
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
                    sortableId={boardGroupItemId(group, item.id)}
                    state={{ id: item.stateId, name: item.stateName }}
                    busy={busy}
                    canSelect={canSelect}
                    canTransition={canWrite && group.droppable}
                    canRank={false}
                    selected={selectedKeys.includes(item.key)}
                    onSelectionChange={onSelectionChange}
                    onOpenItem={onOpenItem}
                    virtualItem={virtualItem}
                  />
                )}
              />
            </Suspense>
          ) : (
            <ul className="flex min-h-24 flex-1 list-none flex-col gap-2 py-1">
              {group.items.map((item) => (
                <BoardCard
                  key={item.id}
                  item={item}
                  sortableId={boardGroupItemId(group, item.id)}
                  state={{ id: item.stateId, name: item.stateName }}
                  busy={busy}
                  canSelect={canSelect}
                  canTransition={canWrite && group.droppable}
                  canRank={false}
                  selected={selectedKeys.includes(item.key)}
                  onSelectionChange={onSelectionChange}
                  onOpenItem={onOpenItem}
                />
              ))}
            </ul>
          )}
        </SortableContext>
      </ColumnShell>
    </fieldset>
  );
}
