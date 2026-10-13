import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import getWorkItemTransitions from "@/fetchers/work-item/get-work-item-transitions";
import rankWorkItem from "@/fetchers/work-item/rank-work-item";
import transitionWorkItem from "@/fetchers/work-item/transition-work-item";
import { routes } from "@/lib/routes";
import {
  classifyWorkItemWriteError,
  rankNeighbours,
  sortByRank,
  type WorkItemWriteFailure,
} from "@/lib/work-item-board";
import type { WorkItemRow } from "@/types/work-item";

type ProjectState = { id: string; name: string };

type Notice = { kind: "status" | "error"; text: string };

type FocusTarget = { key: string; direction: "up" | "down" | "state" };

/**
 * The project board (`docs/03-features/views.md` `VW-8`-`VW-10`, `VW-14`): one column per
 * active project state in project order, cards in rank order.
 *
 * Capabilities are inputs, not inferences. `canTransition` and `canRank` are the strict
 * `transitionTasks` / `rankTasks` flags from `/api/capabilities`; a control that needs one is
 * not rendered without it. That is a usability affordance only -- the server re-checks every
 * write, and every failure it returns is surfaced here (404 gone, 409 conflict, 422 rejected).
 *
 * Dragging is a convenience, never the only way in (`VW-14`): each card also carries Move up
 * and Move down buttons for rank and a Change state control for transitions, all reachable by
 * keyboard, and every outcome is announced through one polite status region.
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
}: {
  projectId: string;
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
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [dragged, setDragged] = useState<WorkItemRow>();
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const pendingFocus = useRef<FocusTarget | undefined>(undefined);
  const boardRef = useRef<HTMLDivElement>(null);

  const itemsByState = useMemo(() => {
    const grouped = new Map<string, WorkItemRow[]>();
    for (const item of workItems ?? []) {
      const items = grouped.get(item.stateId) ?? [];
      items.push(item);
      grouped.set(item.stateId, items);
    }
    for (const [stateId, items] of grouped) {
      grouped.set(stateId, sortByRank(items));
    }
    return grouped;
  }, [workItems]);

  // Keyboard users move a card with a button; after the board re-renders in its new order the
  // same control must still hold focus, or each move would drop them back to the page top.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || !workItems) return;
    pendingFocus.current = undefined;
    const root = boardRef.current;
    if (!root) return;
    if (target.direction === "state") {
      // The card may have moved column (and remounted): find its toggle by item key.
      root
        .querySelector<HTMLButtonElement>(
          `[data-change-state-button="${CSS.escape(target.key)}"]`,
        )
        ?.focus();
      return;
    }
    const find = (direction: "up" | "down") =>
      root.querySelector<HTMLButtonElement>(
        `[data-rank-button="${CSS.escape(target.key)}:${direction}"]`,
      );
    const preferred = find(target.direction);
    const fallback = find(target.direction === "up" ? "down" : "up");
    const next = preferred && !preferred.disabled ? preferred : fallback;
    next?.focus();
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
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await task();
      setNotice(result);
      return result;
    } finally {
      busyRef.current = false;
      setBusy(false);
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

  function moveByKeyboard(
    item: WorkItemRow,
    column: WorkItemRow[],
    direction: "up" | "down",
    stateName: string,
  ) {
    const from = column.findIndex((candidate) => candidate.id === item.id);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from === -1 || to < 0 || to >= column.length) return;
    pendingFocus.current = { key: item.key, direction };
    void runMove(() => rankWithin(item, column, to, to, stateName));
  }

  /** The Change state select shares the board's one-write guard with drag and rank. */
  async function transitionFromSelect(
    item: WorkItemRow,
    offer: { toStateTemplateId: string; toStateName: string },
  ): Promise<boolean> {
    pendingFocus.current = { key: item.key, direction: "state" };
    const result = await runMove(async () => {
      try {
        await transitionWorkItem({
          key: item.key,
          toStateTemplateId: offer.toStateTemplateId,
        });
        await refreshBoard();
        await queryClient.invalidateQueries({
          queryKey: ["work-items", "transitions", item.key],
        });
        return {
          kind: "status",
          text: t("workItems:board.transitionSaved", {
            key: item.key,
            state: offer.toStateName,
          }),
        };
      } catch (error) {
        await refreshBoard();
        return {
          kind: "error",
          text: describeFailure(
            classifyWorkItemWriteError(error),
            item.key,
            "transition",
          ),
        };
      }
    });
    return result?.kind === "status";
  }

  async function handleDrop(target: ProjectState, targetItem?: WorkItemRow) {
    const item = dragged;
    setDragged(undefined);
    if (!item) return;
    const sourceColumn = itemsByState.get(item.stateId) ?? [];

    if (target.id === item.stateId) {
      if (!canRank || !targetItem || targetItem.id === item.id) return;
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
        const offer = offers.find(
          (candidate) => candidate.toStateId === target.id,
        );
        if (!offer?.available) {
          await refreshBoard();
          const reason = offer?.blockedBy
            .map((entry) => entry.reasonCode)
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
        await transitionWorkItem({
          key: item.key,
          toStateTemplateId: offer.toStateTemplateId,
        });
      } catch (error) {
        await refreshBoard();
        return {
          kind: "error",
          text: describeFailure(
            classifyWorkItemWriteError(error),
            item.key,
            "transition",
          ),
        };
      }

      // The item is now in the target state. Placing it next to the card it was dropped on is
      // a second write; if it fails the move itself still stands and is reported as such.
      const targetColumn = itemsByState.get(target.id) ?? [];
      if (canRank && targetColumn.length > 0) {
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

  if (isError || statesError) {
    return (
      <Alert variant="error">
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
      <Empty>
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
    <div
      ref={boardRef}
      className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3 overflow-hidden"
      data-testid="work-item-board"
      data-primary-content-ready="true"
    >
      <p className="sr-only" role="status" aria-live="polite">
        {notice?.kind === "status" ? notice.text : ""}
      </p>
      {notice?.kind === "error" ? (
        <Alert variant="error" role="alert" data-testid="work-item-board-error">
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      ) : null}
      <div className="relative flex min-h-0 flex-1 gap-4 overflow-x-auto p-4">
        {states.map((state) => {
          const stateItems = itemsByState.get(state.id) ?? [];
          const selectable = stateItems.filter(
            (item) => !item.unavailableFields.includes("key"),
          );
          const headingId = `work-item-board-column-${state.id}`;
          return (
            <fieldset
              key={state.id}
              aria-labelledby={headingId}
              data-testid="work-item-board-column"
              data-state-id={state.id}
              className="m-0 flex min-h-0 min-w-72 flex-1 flex-col gap-3 rounded-lg border border-border bg-muted/24 p-3"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void handleDrop(state);
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 id={headingId} className="font-medium">
                  {state.name}
                </h2>
                <Badge
                  variant="outline"
                  aria-label={t("workItems:board.columnCount", {
                    total: stateItems.length,
                    state: state.name,
                  })}
                >
                  {stateItems.length}
                </Badge>
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
              {stateItems.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                  {t("workItems:board.emptyColumn")}
                </p>
              ) : (
                <ul className="flex min-h-24 flex-1 list-none flex-col gap-2 overflow-y-auto p-0">
                  {stateItems.map((item, index) => (
                    <BoardCard
                      key={item.id}
                      item={item}
                      state={state}
                      index={index}
                      count={stateItems.length}
                      busy={busy}
                      canSelect={canSelect}
                      canTransition={canTransition}
                      canRank={canRank}
                      selected={selectedKeys.includes(item.key)}
                      onSelectionChange={onSelectionChange}
                      onMove={(direction) =>
                        moveByKeyboard(item, stateItems, direction, state.name)
                      }
                      onDragStart={() => setDragged(item)}
                      onDrop={() => {
                        void handleDrop(state, item);
                      }}
                      onTransition={(offer) =>
                        transitionFromSelect(item, offer)
                      }
                    />
                  ))}
                </ul>
              )}
            </fieldset>
          );
        })}
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
  );
}

function BoardCard({
  item,
  state,
  index,
  count,
  busy,
  canSelect,
  canTransition,
  canRank,
  selected,
  onSelectionChange,
  onMove,
  onDragStart,
  onDrop,
  onTransition,
}: {
  item: WorkItemRow;
  state: ProjectState;
  index: number;
  count: number;
  busy: boolean;
  canSelect: boolean;
  canTransition: boolean;
  canRank: boolean;
  selected: boolean;
  onSelectionChange: (key: string, checked: boolean) => void;
  onMove: (direction: "up" | "down") => void;
  onDragStart: () => void;
  onDrop: () => void;
  onTransition: (offer: {
    toStateTemplateId: string;
    toStateName: string;
  }) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const actionable = !item.unavailableFields.includes("key");
  const [isChangingState, setIsChangingState] = useState(false);
  const [transitionId, setTransitionId] = useState("");
  const [isMoving, setIsMoving] = useState(false);
  const transitions = useQuery({
    queryKey: ["work-items", "transitions", item.key],
    queryFn: () => getWorkItemTransitions(item.key),
    enabled: isChangingState && canTransition && actionable,
  });
  const offered = transitions.data?.filter((entry) => entry.available) ?? [];
  const chosen = offered.find((entry) => entry.transitionId === transitionId);

  async function move() {
    if (!chosen) return;
    setIsMoving(true);
    const done = await onTransition(chosen);
    setIsMoving(false);
    setTransitionId("");
    if (done) setIsChangingState(false);
  }

  const draggable = actionable && (canTransition || canRank);
  return (
    <li
      draggable={draggable}
      data-testid="work-item-board-card"
      data-work-item-key={item.key}
      className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 shadow-xs/5"
      onDragStart={(event) => {
        event.dataTransfer?.setData("text/plain", item.key);
        onDragStart();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDrop();
      }}
    >
      <div className="flex items-start gap-2">
        {canSelect && (
          <Checkbox
            aria-label={t("workItems:bulk.selectItem", { key: item.key })}
            checked={selected}
            disabled={!actionable}
            onCheckedChange={(checked) =>
              onSelectionChange(item.key, Boolean(checked))
            }
          />
        )}
        {actionable ? (
          <a
            className="min-w-0 flex-1 font-medium hover:underline"
            href={routes.workItemDetail.build({ key: item.key })}
          >
            <span>{item.key}</span>
            <span className="ml-2">{item.title}</span>
          </a>
        ) : (
          <Badge
            variant="outline"
            aria-label={t("workItems:list.unavailableFieldLabel", {
              field: t("workItems:list.columnKey"),
            })}
          >
            {t("workItems:list.unavailable")}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
        <Badge variant="outline">
          {item.priority
            ? t(`workItems:list.priority.${item.priority}`)
            : t("workItems:list.noPriority")}
        </Badge>
        <span>
          {item.assigneeName ??
            (item.assigneeId
              ? t("workItems:list.assigneeInactive")
              : t("workItems:list.unassigned"))}
        </span>
      </div>
      {actionable && canRank && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            data-rank-button={`${item.key}:up`}
            disabled={busy || index === 0}
            aria-label={t("workItems:board.moveUp", {
              key: item.key,
              state: state.name,
            })}
            onClick={() => onMove("up")}
          >
            {t("workItems:board.moveUpShort")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-rank-button={`${item.key}:down`}
            disabled={busy || index === count - 1}
            aria-label={t("workItems:board.moveDown", {
              key: item.key,
              state: state.name,
            })}
            onClick={() => onMove("down")}
          >
            {t("workItems:board.moveDownShort")}
          </Button>
        </div>
      )}
      {actionable && canTransition && (
        <div className="flex flex-col gap-2">
          <Button
            data-change-state-button={item.key}
            variant="outline"
            size="sm"
            aria-expanded={isChangingState}
            aria-label={t("workItems:board.changeStateFor", { key: item.key })}
            onClick={() => setIsChangingState((open) => !open)}
          >
            {t("workItems:board.changeState")}
          </Button>
          {isChangingState && (
            <>
              {transitions.isLoading ? (
                <p role="status">{t("workItems:board.loadingTransitions")}</p>
              ) : null}
              {transitions.isError ? (
                <p role="alert">{t("workItems:board.transitionLoadError")}</p>
              ) : null}
              <Select
                value={transitionId}
                onValueChange={(value) => setTransitionId(value ?? "")}
              >
                <SelectTrigger
                  aria-label={t("workItems:board.chooseState", {
                    key: item.key,
                  })}
                  data-testid="work-item-state-select"
                >
                  <SelectValue
                    placeholder={t("workItems:board.chooseStatePlaceholder")}
                  >
                    {chosen?.toStateName}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {offered.map((offer) => (
                    <SelectItem
                      key={offer.transitionId}
                      value={offer.transitionId}
                    >
                      {offer.toStateName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!chosen || isMoving || busy}
                aria-label={t("workItems:board.moveStateFor", {
                  key: item.key,
                })}
                onClick={() => void move()}
              >
                {t("workItems:board.moveState")}
              </Button>
            </>
          )}
        </div>
      )}
      <span className="sr-only">
        {t("workItems:board.currentState", { state: state.name })}
      </span>
    </li>
  );
}
