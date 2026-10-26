import {
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  defaultDropAnimationSideEffects,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
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
  type CustomFieldGroupDefinition,
  type CustomFieldGroupValue,
  itemGroupValue,
  itemGroupValues,
  parseBoardGroupId,
  parseBoardGroupItemId,
  type WorkItemBoardGroup,
  type WorkItemBoardGroupField,
} from "@/lib/work-item-board-groups";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";
import type { WorkItemPriority, WorkItemRow } from "@/types/work-item";
import { sortableKeyboardCoordinatesWithVirtualRows } from "./virtualization/sortable-keyboard-coordinates";
import { SynchronousKeyboardSensor } from "./virtualization/synchronous-keyboard-sensor";

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
  canUpdate,
  canSetPriority,
  customField,
}: {
  projectId: string;
  field: WorkItemBoardGroupField;
  workItems: WorkItemRow[] | undefined;
  groups: WorkItemBoardGroup[];
  people: readonly AssignablePerson[];
  canAssign: boolean;
  canUpdate: boolean;
  /** Whether the person may clear this item's assignee. */
  canUnassign: (item: WorkItemRow) => boolean;
  canSetPriority: boolean;
  customField?: CustomFieldGroupDefinition;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [dragged, setDragged] = useState<WorkItemRow>();
  const draggedRef = useRef<
    | {
        item: WorkItemRow;
        sourceValue: CustomFieldGroupValue | undefined;
        sourceGroupId: string;
      }
    | undefined
  >(undefined);
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
    useSensor(SynchronousKeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinatesWithVirtualRows,
      keyboardCodes: {
        start: ["Space"],
        end: ["Space", "Enter"],
        cancel: ["Escape"],
      },
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

  const canWrite =
    field === "priority"
      ? canSetPriority
      : field === "assignee"
        ? canAssign
        : canUpdate;

  function groupName(group: WorkItemBoardGroup): string {
    if (field === "priority")
      return group.value === null
        ? t("workItems:board.groupNoPriority")
        : getPriorityLabel(String(group.value));
    if (group.name) return group.name;
    if (group.value === undefined) return t("workItems:board.groupUnavailable");
    if (group.value === null)
      return field === "assignee"
        ? t("workItems:board.groupUnassigned")
        : t("workItems:list.customFieldNotSet");
    if (field.startsWith("cf.") && customField?.format === "boolean")
      return group.value === true
        ? t("workItems:board.groupYes")
        : t("workItems:board.groupNo");
    if (
      field.startsWith("cf.") &&
      (customField?.format === "user" || customField?.format === "multi_user")
    )
      return t("workItems:list.customFieldPersonUnavailable");
    return String(group.value);
  }

  function resolveTarget(overId: unknown): WorkItemBoardGroup | undefined {
    const composite = parseBoardGroupItemId(overId);
    const direct = parseBoardGroupId(overId);
    const groupId = composite?.groupId;
    if (groupId) return groups.find((group) => group.id === groupId);
    if (direct)
      return groups.find(
        (group) =>
          group.field === direct.field &&
          JSON.stringify(group.value) === JSON.stringify(direct.value),
      );
    const overItem = workItems?.find((candidate) => candidate.id === overId);
    if (!overItem) return undefined;
    const value = itemGroupValue(overItem, field, customField);
    return groups.find(
      (group) => JSON.stringify(group.value) === JSON.stringify(value),
    );
  }

  function describeFailure(error: unknown, key: string) {
    if (error instanceof WorkItemVersionConflictError)
      return t("workItems:board.failure.conflict", { key });
    return t(`workItems:board.failure.${classifyWorkItemWriteError(error)}`, {
      key,
    });
  }

  async function write(
    item: WorkItemRow,
    target: WorkItemBoardGroup,
    sourceValue: CustomFieldGroupValue | undefined,
  ) {
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
      } else if (field === "assignee" && target.value === null) {
        await unassignWorkItem(item.key, item.assigneeId);
      } else if (field === "assignee") {
        await assignWorkItem({
          key: item.key,
          assigneeId: String(target.value),
          expectedCurrentAssigneeId: item.assigneeId,
        });
      } else if (field === "label") {
        const current = item.labels ?? [];
        const next =
          target.value === null
            ? []
            : sourceValue === null
              ? [
                  ...new Set([
                    ...current.map((label) => label.id),
                    String(target.value),
                  ]),
                ]
              : [
                  ...new Set([
                    ...current
                      .filter((label) => label.id !== sourceValue)
                      .map((label) => label.id),
                    String(target.value),
                  ]),
                ];
        await updateWorkItem({
          key: item.key,
          version: item.version,
          labelIds: next,
        });
      } else if (field.startsWith("cf.") && customField) {
        const multi =
          customField.format === "multi_select" ||
          customField.format === "multi_user";
        const currentValue = item.customFieldValues?.[customField.key];
        const nextValue = multi
          ? target.value === null
            ? []
            : sourceValue === null
              ? [
                  ...new Set([
                    ...(Array.isArray(currentValue) ? currentValue : []),
                    target.value as string,
                  ]),
                ]
              : [
                  ...new Set([
                    ...(Array.isArray(currentValue) ? currentValue : []).filter(
                      (value) =>
                        JSON.stringify(value) !== JSON.stringify(sourceValue),
                    ),
                    target.value as string,
                  ]),
                ]
          : target.value;
        await updateWorkItem({
          key: item.key,
          version: item.version,
          customFields: { [customField.key]: nextValue },
        });
      } else {
        throw new Error("The selected board grouping is unavailable");
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
    const composite = parseBoardGroupItemId(event.active.id);
    const item = workItems?.find(
      (candidate) => candidate.id === (composite?.itemId ?? event.active.id),
    );
    if (
      !item ||
      item.projectId !== projectContext.current ||
      item.unavailableFields.includes("key")
    )
      return;
    const groupsForItem = groups.filter((group) =>
      group.items.some((row) => row.id === item.id),
    );
    const sourceGroup = composite
      ? groupsForItem.find((group) => group.id === composite.groupId)
      : groupsForItem[0];
    if (!sourceGroup) return;
    draggedRef.current = {
      item,
      sourceValue: sourceGroup.value,
      sourceGroupId: sourceGroup.id,
    };
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
    const draggedState = draggedRef.current;
    const item = draggedState?.item;
    const target = resolveTarget(event.over?.id);
    cancelDrag();
    if (!item || !target || !draggedState) return;
    if (draggedState.sourceGroupId === target.id) return;
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
        : field === "assignee"
          ? target.value === null
            ? canUnassign(item)
            : canAssign &&
              people.some((person) => person.personId === target.value)
          : canUpdate &&
            itemGroupValues(item, field, customField) !== undefined;
    if (!allowed) {
      setNotice({
        kind: "error",
        text: t("workItems:board.groupForbidden", { key: item.key }),
      });
      return;
    }
    if (
      target.value === null &&
      field.startsWith("cf.") &&
      customField?.visibility?.some(
        (entry) =>
          entry.workItemTypeId === item.typeId &&
          entry.visible &&
          entry.required,
      )
    ) {
      setNotice({
        kind: "error",
        text: t("workItems:board.groupNotDroppable", {
          key: item.key,
          group: groupName(target),
        }),
      });
      return;
    }
    await write(item, target, draggedState.sourceValue);
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
