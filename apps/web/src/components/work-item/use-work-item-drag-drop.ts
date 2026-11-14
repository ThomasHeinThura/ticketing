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
import {
  motionDurationMs,
  motionEasing,
  useReducedMotionPreference,
} from "@taskdesk/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import getWorkItemTransitions from "@/fetchers/work-item/get-work-item-transitions";
import rankWorkItem from "@/fetchers/work-item/rank-work-item";
import transitionWorkItem from "@/fetchers/work-item/transition-work-item";
import { HttpError } from "@/lib/http-error";
import type { WorkItemSortDirection, WorkItemSortField } from "@/lib/routes";
import { toast } from "@/lib/toast";
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
import type { CombinedWorkItemRow } from "@/types/work-item/combined";
import {
  isClosingCategory,
  useOpenChildrenGuard,
} from "./open-children-warning";
import { useTransitionNote } from "./use-transition-note";
import { sortableKeyboardCoordinatesWithVirtualRows } from "./virtualization/sortable-keyboard-coordinates";
import {
  SynchronousKeyboardSensor,
  VisibleTargetKeyboardSensor,
} from "./virtualization/synchronous-keyboard-sensor";
export type WorkItemDragState = { id: string; name: string; group?: string };
type Notice = { kind: "status" | "error"; text: string };
type Offers = Awaited<ReturnType<typeof getWorkItemTransitions>>;
type Neighbours = { beforeId?: string; afterId?: string };

/**
 * Where a card with an unconfirmed move is shown: next to the cards it was dropped between, or
 * (when the board cannot rank) where the canonical order would put it. The position is only ever
 * derived in `itemsByState`; it is never written into the query cache.
 */
type Placement = ({ kind: "slot" } & Neighbours) | { kind: "canonical" };
type PendingMove = {
  /** The column the card is shown in: a state ID, or a state template ID on a combined board. */
  stateKey: string;
  stateName: string;
  stateCategory?: string;
  placement: Placement;
  /** Server version of the completed write; absent until writes settle. */
  settledVersion?: number;
  concreteStateId?: string;
};
type PendingMoves = ReadonlyMap<string, PendingMove>;
type WriteResult = {
  /** The server changed (a transition and/or a rank was saved), so the move stands. */
  committed: boolean;
  notice: Notice;
  version?: number;
  rankFailed?: boolean;
  concreteStateId?: string;
};

const NO_PENDING_MOVES: PendingMoves = new Map();
type ProjectQueues = {
  chains: Map<string, Promise<void>>;
  depth: Map<string, number>;
};
const projectQueues = new WeakMap<object, ProjectQueues>();
function queuesFor(client: object): ProjectQueues {
  let queues = projectQueues.get(client);
  if (!queues) {
    queues = { chains: new Map(), depth: new Map() };
    projectQueues.set(client, queues);
  }
  return queues;
}
const SILENT: Notice = { kind: "status", text: "" };

// Module constants keep dnd-kit's sensors and activators stable between renders; inline
// options would hand every sortable new listeners on each board render.
const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 8 } };
const TOUCH_SENSOR_OPTIONS = {
  board: { activationConstraint: { delay: 250, tolerance: 10 } },
  list: { activationConstraint: { delay: 200, tolerance: 8 } },
};
const KEYBOARD_SENSOR_OPTIONS = {
  coordinateGetter: sortableKeyboardCoordinatesWithVirtualRows,
  keyboardCodes: {
    start: ["Space"],
    end: ["Space", "Enter"],
    cancel: ["Escape"],
  },
};
const DROP_ANIMATION: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: "0.8" } },
  }),
};

function isCombinedWorkItemRow(item: WorkItemRow): item is CombinedWorkItemRow {
  const row = item as CombinedWorkItemRow;
  return (
    typeof row.stateTemplateId === "string" &&
    typeof row.sourceProject?.id === "string" &&
    typeof row.sourceProject?.key === "string" &&
    typeof row.sourceProject?.name === "string"
  );
}

/** The row as the board shows it while its move is unconfirmed. */
function withPendingState(
  item: WorkItemRow,
  move: PendingMove,
  combined: boolean,
): WorkItemRow {
  if (
    combined &&
    isCombinedWorkItemRow(item) &&
    item.stateTemplateId === move.stateKey
  )
    return item;
  if (!combined && item.stateId === move.stateKey) return item;
  const stateName = move.stateName;
  const stateCategory = move.stateCategory ?? item.stateCategory;
  if (combined && isCombinedWorkItemRow(item)) {
    const row: CombinedWorkItemRow = {
      ...item,
      stateName,
      stateCategory,
      stateTemplateId: move.stateKey,
    };
    return row;
  }
  return combined
    ? { ...item, stateName, stateCategory }
    : { ...item, stateName, stateCategory, stateId: move.stateKey };
}

function insertAt<T>(items: readonly T[], index: number, value: T): T[] {
  return [...items.slice(0, index), value, ...items.slice(index)];
}

/** Puts a moved card into an already ordered column at its drop slot. */
function placeInColumn(
  column: readonly WorkItemRow[],
  row: WorkItemRow,
  placement: Placement,
  sort: WorkItemSortField,
  dir: WorkItemSortDirection,
): WorkItemRow[] {
  const rest = column.filter((candidate) => candidate.id !== row.id);
  if (placement.kind === "slot") {
    const before = placement.beforeId
      ? rest.findIndex((candidate) => candidate.id === placement.beforeId)
      : -1;
    if (before !== -1) return insertAt(rest, before + 1, row);
    const after = placement.afterId
      ? rest.findIndex((candidate) => candidate.id === placement.afterId)
      : -1;
    if (after !== -1) return insertAt(rest, after, row);
    // A column with nothing to sit next to takes the card at its end. Neighbours that have
    // left the column since (another person moved them) fall back to canonical order below.
    if (!placement.beforeId && !placement.afterId) return [...rest, row];
  }
  if (sort === "position") {
    const sign = dir === "asc" ? 1 : -1;
    const index = rest.findIndex(
      (candidate) =>
        (sign * comparePosition(row.position, candidate.position) ||
          row.id.localeCompare(candidate.id)) < 0,
    );
    return insertAt(rest, index === -1 ? rest.length : index, row);
  }
  return [...rest, row];
}

function focusTaskCard(container: HTMLElement | null, id: string) {
  container
    ?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`)
    ?.focus();
}

/** A failed write the person can act on; anything that is not an HTTP answer never arrived. */
function failureOf(error: unknown): WorkItemWriteFailure | "network" {
  return error instanceof HttpError
    ? classifyWorkItemWriteError(error)
    : "network";
}

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
  combined = false,
  canRankForProject,
  canTransitionForProject,
}: {
  projectId: string;
  states: WorkItemDragState[] | undefined;
  workItems: WorkItemRow[] | undefined;
  canRank: boolean;
  canTransition: boolean;
  sort?: WorkItemSortField;
  dir?: WorkItemSortDirection;
  surface?: "board" | "list";
  /** Opt-in presentation grouped by workspace state template, with project-local writes. */
  combined?: boolean;
  canRankForProject?: (projectId: string) => boolean;
  canTransitionForProject?: (projectId: string) => boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const childrenGuard = useOpenChildrenGuard();
  const transitionNote = useTransitionNote(projectId);
  const [dragged, setDragged] = useState<WorkItemRow>();
  const draggedRef = useRef<WorkItemRow | undefined>(undefined);
  const KeyboardSensor =
    surface === "list"
      ? VisibleTargetKeyboardSensor
      : SynchronousKeyboardSensor;
  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS[surface]),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  );
  const reduceMotion = useReducedMotionPreference();
  const dropAnimation = useMemo(
    () =>
      reduceMotion
        ? null
        : {
            ...DROP_ANIMATION,
            duration: motionDurationMs("slow"),
            easing: motionEasing("out"),
          },
    [reduceMotion],
  );
  const [overStateId, setOverStateId] = useState<string | undefined>();
  const [notice, setNotice] = useState<Notice>();
  // Cards whose move the server has not confirmed yet, in the order they were dropped.
  const [pending, setPending] = useState<PendingMoves>(NO_PENDING_MOVES);
  const pendingFocus = useRef<string | undefined>(undefined);
  const rollbackFocus = useRef<string | undefined>(undefined);
  const pendingRef = useRef<PendingMoves>(NO_PENDING_MOVES);
  const rowsRef = useRef(workItems);
  rowsRef.current = workItems;
  function updatePending(update: (previous: PendingMoves) => PendingMoves) {
    const next = update(pendingRef.current);
    pendingRef.current = next;
    setPending(next);
  }
  const boardRef = useRef<HTMLDivElement>(null);
  // Writes for one project run one at a time, in drop order: a second move ranked while the
  // first is in flight would be placed against neighbours the server has not got yet.
  const { chains: queues, depth: queueDepth } = queuesFor(queryClient);
  // The legal transitions are fetched when a drag starts so that the drop does not wait for them.
  const offerRequests = useRef(new Map<string, Promise<Offers>>());

  const generation = useRef(0);
  const projectContext = useRef(projectId);
  useLayoutEffect(() => {
    projectContext.current = projectId;
    generation.current += 1;
    draggedRef.current = undefined;
    pendingFocus.current = undefined;
    offerRequests.current = new Map();
    pendingRef.current = NO_PENDING_MOVES;
    rollbackFocus.current = undefined;
    setPending(NO_PENDING_MOVES);
    setDragged(undefined);
    setNotice(undefined);
    setOverStateId(undefined);
    return () => {
      generation.current += 1;
    };
  }, [projectId]);

  // Ranking is a manual-order action. An explicit sort must never silently change rank.
  const canReorder = canRank && sort === "position" && dir === "asc";

  // The rows as shown: each unconfirmed move is applied on top of the persisted rows, so a
  // dropped card is already in its new column and slot. Persisted rows are never modified.
  const { viewItems, itemsByState } = useMemo(() => {
    const grouped = new Map<string, WorkItemRow[]>();
    const moved = new Map<string, WorkItemRow>();
    const view: WorkItemRow[] = [];
    for (const item of workItems ?? []) {
      const move = pending.get(item.id);
      if (move) {
        const row = withPendingState(item, move, combined);
        moved.set(item.id, row);
        view.push(row);
        continue;
      }
      view.push(item);
      const stateKey =
        combined && isCombinedWorkItemRow(item)
          ? item.stateTemplateId
          : item.stateId;
      const items = grouped.get(stateKey) ?? [];
      items.push(item);
      grouped.set(stateKey, items);
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
    // Earlier drops go in first, so a later drop can sit next to a card that is itself unconfirmed.
    for (const [id, move] of pending) {
      const row = moved.get(id);
      if (!row) continue;
      grouped.set(
        move.stateKey,
        placeInColumn(
          grouped.get(move.stateKey) ?? [],
          row,
          move.placement,
          sort,
          dir,
        ),
      );
    }
    return {
      viewItems: moved.size > 0 ? view : workItems,
      itemsByState: grouped,
    };
  }, [workItems, pending, sort, dir, combined]);

  const pendingItemIds = useMemo<ReadonlySet<string>>(
    () => new Set(pending.keys()),
    [pending],
  );

  // Only a server row at least as new as the completed write can retire an overlay.
  // This also handles a realtime update arriving before the write promise resolves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry reconciliation after writes settle.
  useEffect(() => {
    if (!workItems) return;
    updatePending((previous) => {
      let next: Map<string, PendingMove> | undefined;
      for (const [id, move] of previous) {
        if (move.settledVersion === undefined) continue;
        const row = workItems.find((entry) => entry.id === id);
        const state =
          row && combined && isCombinedWorkItemRow(row)
            ? row.stateTemplateId
            : row?.stateId;
        if (
          row &&
          (row.version > move.settledVersion ||
            (state === move.stateKey && row.version === move.settledVersion))
        ) {
          next ??= new Map(previous);
          next.delete(id);
        }
      }
      return next ?? previous;
    });
  }, [workItems, pending, combined]);

  useLayoutEffect(() => {
    const id = rollbackFocus.current;
    if (!id || pending.has(id)) return;
    rollbackFocus.current = undefined;
    focusTaskCard(boardRef.current, id);
  }, [pending]);

  // Keyboard drag completion follows the real card across a persisted column change.
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key || !workItems) return;
    pendingFocus.current = undefined;
    const item = workItems.find((candidate) => candidate.key === key);
    if (item) focusTaskCard(boardRef.current, item.id);
  }, [workItems]);
  // The card is remounted in its new column as soon as it is dropped; keep focus on it there
  // without waiting for the server, and keep the target for the fresh rows too.
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key || pending.size === 0) return;
    const item = viewItems?.find((candidate) => candidate.key === key);
    if (item && pending.has(item.id)) focusTaskCard(boardRef.current, item.id);
  }, [pending, viewItems]);

  function describeFailure(
    failure: WorkItemWriteFailure | "network",
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

  function transitionRefusal(
    key: string,
    offer: Offers[number] | undefined,
  ): Notice {
    const reason = offer?.blockedBy
      .map((entry) => t(workItemTransitionReasonKey(entry.reasonCode)))
      .join(", ");
    return {
      kind: "error",
      text: reason
        ? t("workItems:board.transitionBlocked", { key, reason })
        : t("workItems:board.transitionUnavailable", { key }),
    };
  }

  function transitionFailure(error: unknown, key: string): Notice {
    return {
      kind: "error",
      text:
        error instanceof WorkItemTransitionBlockedError
          ? t("workItems:board.transitionBlocked", {
              key,
              reason: error.reasonCodes
                .map((code) => t(workItemTransitionReasonKey(code)))
                .join(", "),
            })
          : describeFailure(failureOf(error), key, "transition"),
    };
  }

  /** Shows the outcome: a status line for assistive tech, a toast for a refusal. */
  function publish(result: Notice) {
    // A failed or no-op move has nothing to refocus; clearing here also stops a later
    // refetch (realtime, polling) from moving focus.
    if (result.kind === "error" || result.text === "") {
      pendingFocus.current = undefined;
    }
    setNotice(result);
    if (result.kind === "error") toast.error(result.text);
  }

  function dropPending(id: string) {
    updatePending((previous) => {
      if (!previous.has(id)) return previous;
      const next = new Map(previous);
      next.delete(id);
      return next;
    });
  }

  /** Reloads what a move can change and never throws; callers do not wait for it. */
  function reload(key?: string, itemProjectId?: string): Promise<unknown> {
    const swallow = () => undefined;
    if (key) {
      for (const scope of ["transitions", "detail"]) {
        void Promise.resolve(
          queryClient.invalidateQueries({
            queryKey: ["work-items", scope, key],
          }),
        ).catch(swallow);
      }
    }
    if (itemProjectId && itemProjectId !== projectId) {
      void queryClient
        .invalidateQueries({ queryKey: ["work-items", itemProjectId] })
        .catch(swallow);
    }
    return Promise.resolve(
      queryClient.invalidateQueries({
        queryKey:
          key || surface !== "board"
            ? ["work-items", projectId]
            : ["work-items", projectId, combined ? "combined" : "board"],
      }),
    ).catch(swallow);
  }

  /**
   * Shows the card where it was dropped, then runs its writes behind the project's earlier ones.
   * The returned promise settles when the writes have; the card keeps its new place until the
   * reloaded rows arrive, or returns at once if nothing was saved.
   */
  function submit(
    item: WorkItemRow,
    move: PendingMove,
    write: (context: {
      stale: () => boolean;
      reusePrefetch: boolean;
    }) => Promise<WriteResult>,
  ): Promise<void> {
    const operation = generation.current;
    const stale = () => generation.current !== operation;
    const queueKey = item.projectId;
    const depth = queueDepth.get(queueKey) ?? 0;
    queueDepth.set(queueKey, depth + 1);
    const keyboardMove = pendingFocus.current === item.key;
    updatePending((previous) => new Map(previous).set(item.id, move));
    const run = async () => {
      try {
        if (stale()) return;
        let result: WriteResult;
        try {
          result = await write({ stale, reusePrefetch: depth === 0 });
        } catch {
          result = {
            committed: false,
            notice: { kind: "error", text: t("common:error.description") },
          };
        }
        if (stale()) {
          // The route changed under an in-flight write: refresh what it did, show nothing.
          if (result.committed) void reload(item.key, item.projectId);
          return;
        }
        publish(result.notice);
        if (result.committed) {
          updatePending((previous) => {
            const current = previous.get(item.id);
            if (!current) return previous;
            const next = new Map(previous);
            next.set(item.id, {
              ...current,
              ...(result.rankFailed
                ? { placement: { kind: "canonical" } as const }
                : {}),
              settledVersion: result.version ?? item.version + 1,
              concreteStateId: result.concreteStateId,
            });
            return next;
          });
          void reload(item.key, item.projectId);
          return;
        }
        if (keyboardMove) rollbackFocus.current = item.id;
        pendingFocus.current = undefined;
        dropPending(item.id);
        setNotice({
          kind: "status",
          text: t(
            result.notice.kind === "error"
              ? "workItems:board.moveRefusedReturned"
              : "workItems:board.moveCancelledReturned",
            {
              key: item.key,
              state:
                states?.find(
                  (state) =>
                    state.id ===
                    (combined && isCombinedWorkItemRow(item)
                      ? item.stateTemplateId
                      : item.stateId),
                )?.name ?? item.stateName,
            },
          ),
        });
        if (result.notice.kind === "error") void reload();
      } finally {
        const remaining = (queueDepth.get(queueKey) ?? 1) - 1;
        if (remaining > 0) queueDepth.set(queueKey, remaining);
        else queueDepth.delete(queueKey);
      }
    };
    const chain = (queues.get(queueKey) ?? Promise.resolve()).then(run);
    queues.set(queueKey, chain);
    void chain.finally(() => {
      if (queues.get(queueKey) === chain) queues.delete(queueKey);
    });
    return chain;
  }

  function prefetchOffers(key: string) {
    const request = new Promise<Offers>((resolve) =>
      resolve(getWorkItemTransitions(key)),
    );
    // A refused prefetch is fetched again at drop time, where its error is reported.
    request.catch(() => undefined);
    offerRequests.current.set(key, request);
  }

  function takeOfferRequest(key: string) {
    const request = offerRequests.current.get(key);
    offerRequests.current.delete(key);
    return request;
  }

  async function readOffers(
    key: string,
    prefetched: Promise<Offers> | undefined,
    reusePrefetch: boolean,
  ): Promise<Offers> {
    if (prefetched && reusePrefetch) {
      try {
        return await prefetched;
      } catch {
        /* Fall through to a fresh read. */
      }
    }
    return getWorkItemTransitions(key);
  }

  function confirmClosing(item: WorkItemRow, toCategory: string | undefined) {
    // `RH-10` / `WI-18`: dropping a parent into a closed column asks about its open
    // children first; cancelling puts the card back.
    return new Promise<boolean>((resolve) => {
      childrenGuard
        .guard({
          key: item.key,
          closing:
            isClosingCategory(toCategory) &&
            !isClosingCategory(item.stateCategory),
          proceed: () => resolve(true),
          cancel: () => resolve(false),
        })
        .catch(() => resolve(false));
    });
  }

  function currentNeighbours(
    item: WorkItemRow,
    stateKey: string,
    concreteStateId: string,
    placement: Placement,
  ): Neighbours | undefined {
    if (placement.kind !== "slot") return undefined;
    const pendingMoves = pendingRef.current;
    const earlier = new Map<string, PendingMove>();
    for (const [id, move] of pendingMoves) {
      if (id === item.id) break;
      earlier.set(id, move);
    }
    const rows = rowsRef.current ?? [];
    for (const [id, move] of earlier) {
      const row = rows.find((entry) => entry.id === id);
      const state =
        row && combined && isCombinedWorkItemRow(row)
          ? row.stateTemplateId
          : row?.stateId;
      if (
        row &&
        move.settledVersion !== undefined &&
        (row.version > move.settledVersion ||
          (row.version === move.settledVersion && state === move.stateKey))
      ) {
        earlier.delete(id);
      }
    }
    let partition = sortByRank(
      rows
        .filter((row) => {
          if (row.projectId !== item.projectId) return false;
          const move = earlier.get(row.id);
          if (move)
            return (
              move.stateKey === stateKey &&
              (!combined ||
                (move.concreteStateId ?? row.stateId) === concreteStateId)
            );
          return row.stateId === concreteStateId;
        })
        .filter((row) => !earlier.has(row.id)),
    );
    for (const [id, move] of earlier) {
      const row = rows.find((entry) => entry.id === id);
      if (
        !row ||
        row.projectId !== item.projectId ||
        move.stateKey !== stateKey ||
        (combined && (move.concreteStateId ?? row.stateId) !== concreteStateId)
      )
        continue;
      partition = placeInColumn(
        partition,
        row,
        move.placement,
        "position",
        "asc",
      );
    }
    partition = partition.filter((row) => row.id !== item.id);
    const positioned = placeInColumn(
      partition,
      item,
      placement,
      "position",
      "asc",
    );
    const index = positioned.findIndex((row) => row.id === item.id);
    const before = positioned[index - 1];
    const after = positioned[index + 1];
    if (!before && !after) return undefined;
    return {
      ...(before ? { beforeId: before.id } : {}),
      ...(after ? { afterId: after.id } : {}),
    };
  }

  function rankWithin(
    item: WorkItemRow,
    column: WorkItemRow[],
    targetIndex: number,
    stateKey: string,
    stateName: string,
    stateCategory?: string,
  ): Promise<void> | undefined {
    const neighbours = rankNeighbours(column, item.id, targetIndex);
    if (!neighbours) {
      publish(SILENT);
      return undefined;
    }
    return submit(
      item,
      {
        stateKey,
        stateName,
        stateCategory,
        placement: { kind: "slot", ...neighbours },
      },
      async () => {
        try {
          const current = currentNeighbours(item, stateKey, item.stateId, {
            kind: "slot",
            ...neighbours,
          });
          if (!current) return { committed: false, notice: SILENT };
          const ranked = await rankWorkItem({ key: item.key, ...current });
          return {
            committed: true,
            version: ranked.version,
            notice: {
              kind: "status",
              text: t("workItems:board.rankSaved", {
                key: item.key,
                position: targetIndex + 1,
                total: column.length,
                state: stateName,
              }),
            },
          };
        } catch (error) {
          return {
            committed: false,
            notice: {
              kind: "error",
              text: describeFailure(failureOf(error), item.key),
            },
          };
        }
      },
    );
  }

  /**
   * The cross-column write: the legal offer, the open-children question, the transition, then
   * the position among the cards the drop was between. If the position write fails the move
   * itself still stands and is reported as such.
   * Known limit: the neighbours come from the cards loaded in the target column. If the
   * column has more cards than the loaded pages ("Load more"), the drop is ranked against
   * the loaded ones only, so it can land among them rather than at the exact slot among all.
   * The move itself is correct and the order is repaired by the next rank. A true fix needs
   * the server to place a card by key; see views.md, Edge cases.
   */
  async function transitionAndRank({
    item,
    target,
    findOffer,
    neighboursFor,
    prefetched,
    context,
  }: {
    item: WorkItemRow;
    target: WorkItemDragState;
    findOffer: (offers: Offers) => Offers[number] | undefined;
    neighboursFor: (offer: Offers[number]) => Neighbours | undefined;
    prefetched: Promise<Offers> | undefined;
    context: { stale: () => boolean; reusePrefetch: boolean };
  }): Promise<WriteResult> {
    let offer: Offers[number];
    let version: number | undefined;
    try {
      const offers = await readOffers(
        item.key,
        prefetched,
        context.reusePrefetch,
      );
      if (context.stale()) return { committed: false, notice: SILENT };
      const found = findOffer(offers);
      const noteOnly =
        found &&
        found.notePolicy === "required" &&
        found.blockedBy.length > 0 &&
        found.blockedBy.every(
          (reason) => reason.reasonCode === "note.required",
        );
      if (!found || (!found.available && !noteOnly)) {
        return { committed: false, notice: transitionRefusal(item.key, found) };
      }
      offer = found;
      const confirmed = await confirmClosing(item, offer.toStateCategory);
      if (!confirmed || context.stale())
        return { committed: false, notice: SILENT };
      const note =
        offer.notePolicy && offer.notePolicy !== "none"
          ? await transitionNote.ask(
              target.name,
              offer.notePolicy === "required",
            )
          : "";
      if (note === null || context.stale())
        return { committed: false, notice: SILENT };
      const transitioned = await transitionWorkItem({
        key: item.key,
        toStateTemplateId: offer.toStateTemplateId,
        ...(note.trim() ? { note } : {}),
      });
      version = transitioned.version;
    } catch (error) {
      return {
        committed: false,
        notice: transitionFailure(error, item.key),
      };
    }
    if (context.stale()) return { committed: true, notice: SILENT };
    const neighbours = neighboursFor(offer);
    if (neighbours) {
      try {
        const ranked = await rankWorkItem({ key: item.key, ...neighbours });
        version = ranked.version;
      } catch (error) {
        return {
          committed: true,
          version,
          rankFailed: true,
          concreteStateId: offer.toStateId,
          notice: {
            kind: "error",
            text: t("workItems:board.movedNotRanked", {
              key: item.key,
              state: target.name,
              reason:
                failureOf(error) === "network"
                  ? t("common:error.messages.network")
                  : describeFailure(failureOf(error), item.key),
            }),
          },
        };
      }
    }
    return {
      committed: true,
      version,
      concreteStateId: offer.toStateId,
      notice: {
        kind: "status",
        text: t("workItems:board.transitionSaved", {
          key: item.key,
          state: target.name,
        }),
      },
    };
  }

  async function handleDrop(
    target: WorkItemDragState,
    targetItem?: WorkItemRow,
  ) {
    const item = draggedRef.current;
    setOverStateId(undefined);
    draggedRef.current = undefined;
    setDragged(undefined);
    if (!item) return;
    const prefetched = takeOfferRequest(item.key);
    const sourceColumn = itemsByState.get(item.stateId) ?? [];

    if (target.id === item.stateId) {
      if (!canReorder || !targetItem || targetItem.id === item.id) return;
      const to = sourceColumn.findIndex((c) => c.id === targetItem.id);
      if (to === -1) return;
      await rankWithin(
        item,
        sourceColumn,
        to,
        item.stateId,
        target.name,
        target.group,
      );
      return;
    }

    if (!canTransition) {
      publish({
        kind: "error",
        text: t("workItems:board.transitionForbidden"),
      });
      return;
    }
    // The card goes next to the card it was dropped on, or to the end of the column. Neighbours
    // are read now, from the column as shown: unconfirmed drops queued before this one count,
    // because their writes run first.
    const targetColumn = itemsByState.get(target.id) ?? [];
    let neighbours: Neighbours | undefined;
    if (canReorder) {
      const placeAt = targetItem
        ? targetColumn.findIndex((c) => c.id === targetItem.id)
        : targetColumn.length;
      const index = placeAt === -1 ? targetColumn.length : placeAt;
      const before = targetColumn[index - 1];
      const after = targetColumn[index];
      neighbours = {
        ...(before ? { beforeId: before.id } : {}),
        ...(after ? { afterId: after.id } : {}),
      };
    }
    await submit(
      item,
      {
        stateKey: target.id,
        stateName: target.name,
        stateCategory: target.group,
        placement: neighbours
          ? { kind: "slot", ...neighbours }
          : { kind: "canonical" },
      },
      (context) =>
        transitionAndRank({
          item,
          target,
          findOffer: (offers) =>
            offers.find((candidate) => candidate.toStateId === target.id),
          neighboursFor: () =>
            neighbours
              ? currentNeighbours(item, target.id, target.id, {
                  kind: "slot",
                  ...neighbours,
                })
              : undefined,
          prefetched,
          context,
        }),
    );
  }

  function canRankItem(item: WorkItemRow) {
    return combined
      ? canReorder && (canRankForProject?.(item.projectId) ?? false)
      : canRank;
  }

  function canTransitionItem(item: WorkItemRow) {
    return combined
      ? (canTransitionForProject?.(item.projectId) ?? false)
      : canTransition;
  }

  async function handleCombinedDrop(
    target: WorkItemDragState,
    targetItem?: WorkItemRow,
  ) {
    const item = draggedRef.current;
    setOverStateId(undefined);
    draggedRef.current = undefined;
    setDragged(undefined);
    if (!item || !isCombinedWorkItemRow(item)) return;
    const prefetched = takeOfferRequest(item.key);

    const sourceColumn = (itemsByState.get(item.stateTemplateId) ?? []).filter(
      (candidate) =>
        candidate.projectId === item.projectId &&
        (pendingRef.current.get(candidate.id)?.concreteStateId ??
          (pendingRef.current.get(candidate.id)?.stateKey ===
          item.stateTemplateId
            ? item.stateId
            : candidate.stateId)) === item.stateId,
    );
    if (target.id === item.stateTemplateId) {
      if (!canRankItem(item) || !canReorder) {
        publish({ kind: "error", text: t("workItems:board.rankForbidden") });
        return;
      }
      if (targetItem && targetItem.id !== item.id) {
        const samePartition =
          targetItem.projectId === item.projectId &&
          (pendingRef.current.get(targetItem.id)?.concreteStateId ??
            (pendingRef.current.get(targetItem.id)?.stateKey ===
            item.stateTemplateId
              ? item.stateId
              : targetItem.stateId)) === item.stateId;
        if (!samePartition) {
          publish({
            kind: "error",
            text: t("workItems:board.crossProjectRankDenied"),
          });
          return;
        }
        const targetIndex = sourceColumn.findIndex(
          (candidate) => candidate.id === targetItem.id,
        );
        if (targetIndex >= 0)
          await rankWithin(
            item,
            sourceColumn,
            targetIndex,
            item.stateTemplateId,
            target.name,
            target.group,
          );
        return;
      }
      if (!targetItem)
        await rankWithin(
          item,
          sourceColumn,
          sourceColumn.length,
          item.stateTemplateId,
          target.name,
          target.group,
        );
      return;
    }

    if (!canTransitionItem(item)) {
      publish({
        kind: "error",
        text: t("workItems:board.transitionForbidden"),
      });
      return;
    }
    const targetPartition = (itemsByState.get(target.id) ?? []).filter(
      (candidate) => candidate.projectId === item.projectId,
    );
    const targetIndex =
      targetItem?.projectId === item.projectId
        ? targetPartition.findIndex(
            (candidate) => candidate.id === targetItem.id,
          )
        : -1;
    const at = targetIndex < 0 ? targetPartition.length : targetIndex;
    const before = targetPartition[at - 1];
    const after = targetPartition[at];
    const placement: Placement = canRankItem(item)
      ? {
          kind: "slot",
          ...(before ? { beforeId: before.id } : {}),
          ...(after ? { afterId: after.id } : {}),
        }
      : { kind: "canonical" };
    await submit(
      item,
      {
        stateKey: target.id,
        stateName: target.name,
        stateCategory: target.group,
        placement,
      },
      (context) =>
        transitionAndRank({
          item,
          target,
          findOffer: (offers) =>
            offers.find(
              (candidate) => candidate.toStateTemplateId === target.id,
            ),
          neighboursFor: (offer) =>
            currentNeighbours(item, target.id, offer.toStateId, placement),
          prefetched,
          context,
        }),
    );
  }

  function startDrag(event: DragStartEvent) {
    const item = viewItems?.find(
      (candidate) => candidate.id === event.active.id,
    );
    if (
      !item ||
      // Only a card whose own move is unconfirmed is held back; every other card stays usable.
      pending.has(item.id) ||
      (!combined && item.projectId !== projectContext.current) ||
      item.unavailableFields.includes("key") ||
      (combined
        ? !canRankItem(item) && !canTransitionItem(item)
        : !canTransition && !canReorder)
    )
      return;
    draggedRef.current = item;
    setDragged(item);
    if (event.activatorEvent instanceof KeyboardEvent)
      pendingFocus.current = item.key;
    if (canTransitionItem(item)) prefetchOffers(item.key);
  }
  async function endDrag(event: DragEndEvent) {
    const source = viewItems?.find(
      (item) => item.id === draggedRef.current?.id,
    );
    if (
      !source ||
      (!combined && source.projectId !== projectContext.current) ||
      source.unavailableFields.includes("key") ||
      source.projectId !== draggedRef.current?.projectId ||
      source.stateId !== draggedRef.current?.stateId ||
      (combined
        ? !canRankItem(source) && !canTransitionItem(source)
        : !canTransition && !canReorder)
    ) {
      cancelDrag();
      return;
    }
    const targetItem = viewItems?.find(
      (candidate) => candidate.id === event.over?.id,
    );
    const targetStateId = combined
      ? targetItem && isCombinedWorkItemRow(targetItem)
        ? targetItem.stateTemplateId
        : event.over?.id
      : (targetItem?.stateId ?? event.over?.id);
    const target = states?.find((candidate) => candidate.id === targetStateId);
    if (!event.over || !target) {
      cancelDrag();
      return;
    }
    if (combined) await handleCombinedDrop(target, targetItem);
    else await handleDrop(target, targetItem);
  }
  function cancelDrag() {
    if (draggedRef.current)
      offerRequests.current.delete(draggedRef.current.key);
    setOverStateId(undefined);
    draggedRef.current = undefined;
    pendingFocus.current = undefined;
    setDragged(undefined);
  }

  function overDrag(event: DragOverEvent) {
    const targetItem = viewItems?.find((item) => item.id === event.over?.id);
    const targetStateId = combined
      ? targetItem && isCombinedWorkItemRow(targetItem)
        ? targetItem.stateTemplateId
        : event.over?.id
      : (targetItem?.stateId ?? event.over?.id);
    const state = states?.find((candidate) => candidate.id === targetStateId);
    setOverStateId(draggedRef.current && state ? state.id : undefined);
  }
  return {
    dragged,
    /** Cards whose move is not confirmed yet; only these refuse a new drag. */
    pendingItemIds,
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
    noteDialog: transitionNote.dialog,
  };
}
