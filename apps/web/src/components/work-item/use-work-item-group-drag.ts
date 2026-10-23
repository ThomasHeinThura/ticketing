import {
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  defaultDropAnimationSideEffects,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import assignWorkItem from "@/fetchers/work-item/assign-work-item";
import unassignWorkItem from "@/fetchers/work-item/unassign-work-item";
import updateWorkItem from "@/fetchers/work-item/update-work-item";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { classifyWorkItemWriteError } from "@/lib/work-item-board";
import {
  type AssignablePerson,
  itemGroupValue,
  parseBoardGroupId,
  type WorkItemBoardGroup,
  type WorkItemBoardGroupField,
} from "@/lib/work-item-board-groups";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";
import type { WorkItemPriority, WorkItemRow } from "@/types/work-item";

type Notice = { kind: "status" | "error"; text: string };

/**
 * `VW-13`: on a board grouped by anything but state, a drop sets that field instead of
 * transitioning state. Each write is the one the properties panel and context menu already
 * use (`PATCH` for priority, assign / unassign for the assignee), so the server's own
 * permission, version and holder checks decide; the flags here only hide what cannot work.
 * Dragging within a group does nothing: rank belongs to a state column.
 */
export default function useWorkItemGroupDrag({
  projectId,
  field,
  workItems,
  groups,
  people,
  canAssign,
  canUnassign,
  canSetPriority,
}: {
  projectId: string;
  field: WorkItemBoardGroupField;
  workItems: WorkItemRow[] | undefined;
  groups: WorkItemBoardGroup[];
  people: readonly AssignablePerson[];
  canAssign: boolean;
  /** Whether the person may clear this item's assignee. */
  canUnassign: (item: WorkItemRow) => boolean;
  canSetPriority: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [dragged, setDragged] = useState<WorkItemRow>();
  const draggedRef = useRef<WorkItemRow | undefined>(undefined);
  const [overGroupId, setOverGroupId] = useState<string>();
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const projectContext = useRef(projectId);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 10 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: { active: { opacity: "0.8" } },
    }),
    duration: 300,
    easing: "cubic-bezier(0.23, 1, 0.32, 1)",
  };

  useLayoutEffect(() => {
    projectContext.current = projectId;
    generation.current += 1;
    draggedRef.current = undefined;
    busyRef.current = false;
    setBusy(false);
    setDragged(undefined);
    setNotice(undefined);
    setOverGroupId(undefined);
    return () => {
      generation.current += 1;
    };
  }, [projectId]);

  // A different grouping is a different set of drop targets; drop any half-finished drag.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `field` is the trigger.
  useLayoutEffect(() => {
    draggedRef.current = undefined;
    setDragged(undefined);
    setOverGroupId(undefined);
    setNotice(undefined);
  }, [field]);

  const canWrite = field === "priority" ? canSetPriority : canAssign;

  function groupName(group: WorkItemBoardGroup): string {
    if (field === "priority")
      return group.value === null
        ? t("workItems:board.groupNoPriority")
        : getPriorityLabel(group.value);
    return group.name ?? t("workItems:board.groupUnassigned");
  }

  function resolveTarget(overId: unknown): WorkItemBoardGroup | undefined {
    const direct = parseBoardGroupId(overId);
    if (direct)
      return groups.find(
        (group) => group.field === direct.field && group.value === direct.value,
      );
    const overItem = workItems?.find((candidate) => candidate.id === overId);
    if (!overItem) return undefined;
    const value = itemGroupValue(overItem, field);
    return groups.find((group) => group.value === value);
  }

  function describeFailure(error: unknown, key: string) {
    if (error instanceof WorkItemVersionConflictError)
      return t("workItems:board.failure.conflict", { key });
    return t(`workItems:board.failure.${classifyWorkItemWriteError(error)}`, {
      key,
    });
  }

  async function write(item: WorkItemRow, target: WorkItemBoardGroup) {
    const operationGeneration = generation.current;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    let result: Notice;
    try {
      if (field === "priority") {
        await updateWorkItem({
          key: item.key,
          version: item.version,
          priority: target.value as WorkItemPriority | null,
        });
      } else if (target.value === null) {
        await unassignWorkItem(item.key, item.assigneeId);
      } else {
        await assignWorkItem({
          key: item.key,
          assigneeId: target.value,
          expectedCurrentAssigneeId: item.assigneeId,
        });
      }
      result = {
        kind: "status",
        text: t("workItems:board.groupSaved", {
          key: item.key,
          group: groupName(target),
        }),
      };
    } catch (error) {
      result = { kind: "error", text: describeFailure(error, item.key) };
    }
    try {
      await queryClient.invalidateQueries({
        queryKey: ["work-items", projectId],
      });
    } catch {
      // The write result stands; the next realtime or manual refresh repairs the view.
    }
    if (generation.current !== operationGeneration) return;
    busyRef.current = false;
    setBusy(false);
    setNotice(result);
  }

  function startDrag(event: DragStartEvent) {
    if (busyRef.current || !canWrite) return;
    const item = workItems?.find(
      (candidate) => candidate.id === event.active.id,
    );
    if (
      !item ||
      item.projectId !== projectContext.current ||
      item.unavailableFields.includes("key")
    )
      return;
    draggedRef.current = item;
    setDragged(item);
  }

  function cancelDrag() {
    draggedRef.current = undefined;
    setDragged(undefined);
    setOverGroupId(undefined);
  }

  function overDrag(event: DragOverEvent) {
    const target = resolveTarget(event.over?.id);
    setOverGroupId(draggedRef.current && target ? target.id : undefined);
  }

  async function endDrag(event: DragEndEvent) {
    const item = draggedRef.current;
    const target = resolveTarget(event.over?.id);
    cancelDrag();
    if (!item || !target) return;
    if (itemGroupValue(item, field) === target.value) return;
    if (!target.droppable) {
      setNotice({
        kind: "error",
        text: t("workItems:board.groupNotDroppable", {
          key: item.key,
          group: groupName(target),
        }),
      });
      return;
    }
    const allowed =
      field === "priority"
        ? canSetPriority
        : target.value === null
          ? canUnassign(item)
          : canAssign &&
            people.some((person) => person.personId === target.value);
    if (!allowed) {
      setNotice({
        kind: "error",
        text: t("workItems:board.groupForbidden", { key: item.key }),
      });
      return;
    }
    await write(item, target);
  }

  return {
    dragged,
    busy,
    notice,
    canWrite,
    overGroupId,
    containerRef,
    sensors,
    dropAnimation,
    startDrag,
    overDrag,
    endDrag,
    cancelDrag,
    groupName,
  };
}
