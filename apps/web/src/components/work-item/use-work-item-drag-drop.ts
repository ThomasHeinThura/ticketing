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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import getWorkItemTransitions from "@/fetchers/work-item/get-work-item-transitions";
import rankWorkItem from "@/fetchers/work-item/rank-work-item";
import transitionWorkItem from "@/fetchers/work-item/transition-work-item";
import type { WorkItemSortDirection, WorkItemSortField } from "@/lib/routes";
import {
  classifyWorkItemWriteError,
  comparePosition,
  rankNeighbours,
  sortByRank,
  type WorkItemWriteFailure,
} from "@/lib/work-item-board";
import {
  WorkItemTransitionBlockedError,
  workItemTransitionReasonKey,
} from "@/lib/work-item-transition-reasons";
import type { WorkItemRow } from "@/types/work-item";
import {
  isClosingCategory,
  useOpenChildrenGuard,
} from "./open-children-warning";
export type WorkItemDragState = { id: string; name: string; group?: string };
type Notice = { kind: "status" | "error"; text: string };

/** One canonical write controller shared by Kaneo board and list presentations. */
export default function useWorkItemDragDrop({
  projectId,
  states,
  workItems,
  canRank,
  canTransition,
  sort = "position",
  dir = "asc",
  surface = "board",
}: {
  projectId: string;
  states: WorkItemDragState[] | undefined;
  workItems: WorkItemRow[] | undefined;
  canRank: boolean;
  canTransition: boolean;
  sort?: WorkItemSortField;
  dir?: WorkItemSortDirection;
  surface?: "board" | "list";
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const childrenGuard = useOpenChildrenGuard();
  const [dragged, setDragged] = useState<WorkItemRow>();
  const draggedRef = useRef<WorkItemRow | undefined>(undefined);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: surface === "list" ? 200 : 250,
        tolerance: surface === "list" ? 8 : 10,
      },
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
  const [overStateId, setOverStateId] = useState<string | undefined>();
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const pendingFocus = useRef<string | undefined>(undefined);
  const boardRef = useRef<HTMLDivElement>(null);

  const generation = useRef(0);
  const projectContext = useRef(projectId);
  useLayoutEffect(() => {
    projectContext.current = projectId;
    generation.current += 1;
    draggedRef.current = undefined;
    pendingFocus.current = undefined;
    busyRef.current = false;
    setBusy(false);
    setDragged(undefined);
    setNotice(undefined);
    setOverStateId(undefined);
    return () => {
      generation.current += 1;
    };
  }, [projectId]);

  // Ranking is a manual-order action. An explicit sort must never silently change rank.
  const canReorder = canRank && sort === "position" && dir === "asc";

  const itemsByState = useMemo(() => {
    const grouped = new Map<string, WorkItemRow[]>();
    for (const item of workItems ?? []) {
      const items = grouped.get(item.stateId) ?? [];
      items.push(item);
      grouped.set(item.stateId, items);
    }
    for (const [stateId, items] of grouped) {
      if (sort === "position") {
        grouped.set(
          stateId,
          dir === "asc"
            ? sortByRank(items)
            : [...items].sort(
                (a, b) =>
                  comparePosition(b.position, a.position) ||
                  a.id.localeCompare(b.id),
              ),
        );
      }
      // Other sorts arrive in canonical API order, including nulls and ID ties.
      // Preserving that order keeps Load more consistent across cursor pages.
    }
    return grouped;
  }, [workItems, sort, dir]);

  // Keyboard drag completion follows the real card across a persisted column change.
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key || !workItems) return;
    pendingFocus.current = undefined;
    const item = workItems.find((candidate) => candidate.key === key);
    if (item)
      boardRef.current
        ?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(item.id)}"]`)
        ?.focus();
  }, [workItems]);

  function describeFailure(
    failure: WorkItemWriteFailure,
    key: string,
    kind: "rank" | "transition" = "rank",
  ) {
    // A 400 means "a neighbour left the partition" for rank only; a transition 400 is a
    // plain invalid request and must not claim a position was not saved.
    const name =
      kind === "transition" && failure === "invalid"
        ? "transitionInvalid"
        : failure;
    return t(`workItems:board.failure.${name}`, { key });
  }

  async function refreshBoard() {
    await queryClient.invalidateQueries({
      queryKey: ["work-items", projectId],
    });
  }

  /** Runs one write at a time; a second concurrent move would rank against stale neighbours. */
  async function runMove(task: () => Promise<Notice>) {
    // A skipped move must not leave a focus target behind for a later, unrelated refetch.
    if (busyRef.current) return undefined;
    const operationGeneration = generation.current;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await task();
      if (generation.current !== operationGeneration) return undefined;
      // A failed or no-op move has nothing to refocus; clearing here also stops a later
      // refetch (realtime, polling) from moving focus.
      if (result.kind === "error" || result.text === "") {
        pendingFocus.current = undefined;
      }
      setNotice(result);
      return result;
    } catch {
      if (generation.current !== operationGeneration) return undefined;
      // A refresh failure must not leave an unhandled drag callback or report success.
      pendingFocus.current = undefined;
      const result: Notice = {
        kind: "error",
        text: t("common:error.description"),
      };
      setNotice(result);
      return result;
    } finally {
      if (generation.current === operationGeneration) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  async function rankWithin(
    item: WorkItemRow,
    column: WorkItemRow[],
    targetIndex: number,
    announceIndex: number,
    stateName: string,
  ): Promise<Notice> {
    const neighbours = rankNeighbours(column, item.id, targetIndex);
    if (!neighbours) return { kind: "status", text: "" };
    try {
      await rankWorkItem({ key: item.key, ...neighbours });
      await refreshBoard();
      return {
        kind: "status",
        text: t("workItems:board.rankSaved", {
          key: item.key,
          position: announceIndex + 1,
          total: column.length,
          state: stateName,
        }),
      };
    } catch (error) {
      await refreshBoard();
      return {
        kind: "error",
        text: describeFailure(classifyWorkItemWriteError(error), item.key),
      };
    }
  }

  async function handleDrop(
    target: WorkItemDragState,
    targetItem?: WorkItemRow,
  ) {
    const operationGeneration = generation.current;
    const item = draggedRef.current;
    setOverStateId(undefined);
    draggedRef.current = undefined;
    setDragged(undefined);
    if (!item) return;
    const sourceColumn = itemsByState.get(item.stateId) ?? [];

    if (target.id === item.stateId) {
      if (!canReorder || !targetItem || targetItem.id === item.id) return;
      const to = sourceColumn.findIndex((c) => c.id === targetItem.id);
      if (to === -1) return;
      await runMove(() => rankWithin(item, sourceColumn, to, to, target.name));
      return;
    }

    if (!canTransition) {
      setNotice({
        kind: "error",
        text: t("workItems:board.transitionForbidden"),
      });
      return;
    }
    await runMove(async () => {
      try {
        const offers = await getWorkItemTransitions(item.key);
        if (generation.current !== operationGeneration)
          return { kind: "status", text: "" };
        const offer = offers.find(
          (candidate) => candidate.toStateId === target.id,
        );
        if (!offer?.available) {
          await refreshBoard();
          const reason = offer?.blockedBy
            .map((entry) => t(workItemTransitionReasonKey(entry.reasonCode)))
            .join(", ");
          return {
            kind: "error",
            text: reason
              ? t("workItems:board.transitionBlocked", {
                  key: item.key,
                  reason,
                })
              : t("workItems:board.transitionUnavailable", { key: item.key }),
          };
        }
        // `RH-10` / `WI-18`: dropping a parent into a closed column asks about its open
        // children first; cancelling leaves the card where it was.
        const confirmed = await new Promise<boolean>((resolve) => {
          void childrenGuard.guard({
            key: item.key,
            closing:
              isClosingCategory(offer.toStateCategory) &&
              !isClosingCategory(item.stateCategory),
            proceed: () => resolve(true),
            cancel: () => resolve(false),
          });
        });
        if (!confirmed || generation.current !== operationGeneration)
          return { kind: "status", text: "" };
        await transitionWorkItem({
          key: item.key,
          toStateTemplateId: offer.toStateTemplateId,
        });
      } catch (error) {
        await refreshBoard();
        return {
          kind: "error",
          text:
            error instanceof WorkItemTransitionBlockedError
              ? t("workItems:board.transitionBlocked", {
                  key: item.key,
                  reason: error.reasonCodes
                    .map((code) => t(workItemTransitionReasonKey(code)))
                    .join(", "),
                })
              : describeFailure(
                  classifyWorkItemWriteError(error),
                  item.key,
                  "transition",
                ),
        };
      }

      if (generation.current !== operationGeneration) {
        await refreshBoard();
        return { kind: "status", text: "" };
      }
      // The item is now in the target state. Placing it next to the card it was dropped on is
      // a second write; if it fails the move itself still stands and is reported as such.
      // Known limit: the neighbours come from the cards loaded in the target column. If the
      // column has more cards than the loaded pages ("Load more"), the drop is ranked against
      // the loaded ones only, so it can land among them rather than at the exact slot among all.
      // The move itself is correct and the order is repaired by the next rank. A true fix needs
      // the server to place a card by key; see views.md, Edge cases.
      const targetColumn = itemsByState.get(target.id) ?? [];
      if (canReorder && targetColumn.length > 0) {
        const placeAt = targetItem
          ? targetColumn.findIndex((c) => c.id === targetItem.id)
          : targetColumn.length;
        const index = placeAt === -1 ? targetColumn.length : placeAt;
        const before = targetColumn[index - 1];
        const after = targetColumn[index];
        try {
          await rankWorkItem({
            key: item.key,
            ...(before ? { beforeId: before.id } : {}),
            ...(after ? { afterId: after.id } : {}),
          });
        } catch (error) {
          await refreshBoard();
          return {
            kind: "error",
            text: t("workItems:board.movedNotRanked", {
              key: item.key,
              state: target.name,
              reason: describeFailure(
                classifyWorkItemWriteError(error),
                item.key,
              ),
            }),
          };
        }
      }
      await refreshBoard();
      return {
        kind: "status",
        text: t("workItems:board.transitionSaved", {
          key: item.key,
          state: target.name,
        }),
      };
    });
  }

  function startDrag(event: DragStartEvent) {
    if (busyRef.current) return;
    const item = workItems?.find(
      (candidate) => candidate.id === event.active.id,
    );
    if (
      !item ||
      item.projectId !== projectContext.current ||
      item.unavailableFields.includes("key") ||
      (!canTransition && !canReorder)
    )
      return;
    draggedRef.current = item;
    setDragged(item);
    if (event.activatorEvent instanceof KeyboardEvent)
      pendingFocus.current = item.key;
  }
  async function endDrag(event: DragEndEvent) {
    const source = workItems?.find(
      (item) => item.id === draggedRef.current?.id,
    );
    if (
      !source ||
      source.projectId !== projectContext.current ||
      source.unavailableFields.includes("key") ||
      source.stateId !== draggedRef.current?.stateId ||
      (!canTransition && !canReorder)
    ) {
      cancelDrag();
      return;
    }
    const targetItem = workItems?.find(
      (candidate) => candidate.id === event.over?.id,
    );
    const target = states?.find(
      (candidate) => candidate.id === (targetItem?.stateId ?? event.over?.id),
    );
    if (!event.over || !target) {
      cancelDrag();
      return;
    }
    await handleDrop(target, targetItem);
  }
  function cancelDrag() {
    setOverStateId(undefined);
    draggedRef.current = undefined;
    pendingFocus.current = undefined;
    setDragged(undefined);
  }

  function overDrag(event: DragOverEvent) {
    const targetItem = workItems?.find((item) => item.id === event.over?.id);
    const state = states?.find(
      (candidate) => candidate.id === (targetItem?.stateId ?? event.over?.id),
    );
    setOverStateId(draggedRef.current && state ? state.id : undefined);
  }
  return {
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
    overDrag,
    overStateId,
    /** Render once beside the board/list: the open-children warning for closing drops. */
    childrenDialog: childrenGuard.dialog,
  };
}
