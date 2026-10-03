import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useState } from "react";
import { useTranslation } from "react-i18next";
import getWorkItemTransitions from "@/fetchers/work-item/get-work-item-transitions";
import rankWorkItem from "@/fetchers/work-item/rank-work-item";
import transitionWorkItem from "@/fetchers/work-item/transition-work-item";
import { routes } from "@/lib/routes";
import type { WorkItemRow } from "@/types/work-item";

type ProjectState = {
  id: string;
  stateTemplateId: string;
  name: string;
  group: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
  position: number;
  isDefault: boolean;
};

function comparePosition(left: string, right: string): number {
  const parse = (raw: string) => {
    const negative = raw.startsWith("-");
    const value = negative ? raw.slice(1) : raw;
    const [whole = "0", fraction = ""] = value.split(".");
    return {
      negative,
      whole: whole.replace(/^0+(?=\d)/, ""),
      fraction: fraction.padEnd(10, "0"),
    };
  };
  const a = parse(left);
  const b = parse(right);
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  const wholeOrder =
    a.whole.length - b.whole.length || a.whole.localeCompare(b.whole);
  const fractionOrder = a.fraction.localeCompare(b.fraction);
  const order = wholeOrder || fractionOrder;
  return a.negative ? -order : order;
}

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
  const [message, setMessage] = useState("");
  const itemsByState = new Map<string, WorkItemRow[]>();
  for (const item of workItems ?? []) {
    const items = itemsByState.get(item.stateId) ?? [];
    items.push(item);
    itemsByState.set(item.stateId, items);
  }
  for (const items of itemsByState.values()) {
    items.sort(
      (a, b) =>
        comparePosition(a.position, b.position) || a.id.localeCompare(b.id),
    );
  }

  async function refreshBoard() {
    await queryClient.invalidateQueries({
      queryKey: ["work-items", projectId],
    });
  }

  async function handleDrop(target: ProjectState, targetItem?: WorkItemRow) {
    const item = dragged;
    setDragged(undefined);
    if (!item) return;
    if (target.id === item.stateId) {
      if (!canRank || !targetItem || targetItem.id === item.id) return;
      try {
        await rankWorkItem({ key: item.key, afterId: targetItem.id });
        setMessage(t("workItems:board.rankSaved"));
        await refreshBoard();
      } catch {
        setMessage(t("workItems:board.moveFailed"));
        await refreshBoard();
      }
      return;
    }
    if (!canTransition) {
      setMessage(t("workItems:board.transitionForbidden"));
      return;
    }
    try {
      const offers = await getWorkItemTransitions(item.key);
      const offer = offers.find(
        (candidate) => candidate.toStateId === target.id,
      );
      if (!offer?.available) {
        const reason = offer?.blockedBy
          .map((entry) => entry.reasonCode)
          .join(", ");
        setMessage(
          reason
            ? t("workItems:board.transitionBlocked", { reason })
            : t("workItems:board.transitionUnavailable"),
        );
        await refreshBoard();
        return;
      }
      await transitionWorkItem({
        key: item.key,
        toStateTemplateId: offer.toStateTemplateId,
      });
      if (canRank) {
        const targetItems = itemsByState.get(target.id) ?? [];
        const lastTargetItem = targetItem ?? targetItems.at(-1);
        if (lastTargetItem && lastTargetItem.id !== item.id) {
          await rankWorkItem({ key: item.key, beforeId: lastTargetItem.id });
        }
      }
      setMessage(
        t("workItems:board.transitionSaved", {
          key: item.key,
          state: target.name,
        }),
      );
      await refreshBoard();
    } catch {
      setMessage(t("workItems:board.moveFailed"));
      await refreshBoard();
    }
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
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
      data-testid="work-item-board"
    >
      <p className="sr-only" role="status" aria-live="polite">
        {message}
      </p>
      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-4">
        {states.map((state) => {
          const stateItems = itemsByState.get(state.id) ?? [];
          const selectable = stateItems.filter(
            (item) => !item.unavailableFields.includes("key"),
          );
          return (
            <section
              key={state.id}
              aria-label={state.name}
              data-testid="work-item-board-column"
              data-state-id={state.id}
              className="flex min-h-0 min-w-72 flex-1 flex-col gap-3 rounded-lg border border-border bg-muted/24 p-3"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void handleDrop(state);
              }}
            >
              <header className="flex items-center justify-between gap-2">
                <h2 className="font-medium">{state.name}</h2>
                <Badge variant="outline">{stateItems.length}</Badge>
                {canSelect && selectable.length > 0 && (
                  <Checkbox
                    aria-label={t("workItems:board.selectColumn", {
                      state: state.name,
                    })}
                    checked={selectable.every((item) =>
                      selectedKeys.includes(item.key),
                    )}
                    onCheckedChange={(checked) => {
                      selectable.forEach((item) => {
                        onSelectionChange(item.key, Boolean(checked));
                      });
                    }}
                  />
                )}
              </header>
              <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto">
                {stateItems.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                    {t("workItems:board.emptyColumn")}
                  </p>
                ) : (
                  stateItems.map((item) => (
                    <BoardCard
                      key={item.id}
                      item={item}
                      state={state}
                      canSelect={canSelect}
                      canTransition={canTransition}
                      canRank={canRank}
                      selected={selectedKeys.includes(item.key)}
                      onSelectionChange={onSelectionChange}
                      onDragStart={() => setDragged(item)}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void handleDrop(state, item);
                      }}
                    />
                  ))
                )}
              </div>
            </section>
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
  canSelect,
  canTransition,
  canRank,
  selected,
  onSelectionChange,
  onDragStart,
  onDrop,
}: {
  item: WorkItemRow;
  state: ProjectState;
  canSelect: boolean;
  canTransition: boolean;
  canRank: boolean;
  selected: boolean;
  onSelectionChange: (key: string, checked: boolean) => void;
  onDragStart: () => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [isChangingState, setIsChangingState] = useState(false);
  const [transitionId, setTransitionId] = useState("");
  const [error, setError] = useState("");
  const transitions = useQuery({
    queryKey: ["work-items", "transitions", item.key],
    queryFn: () => getWorkItemTransitions(item.key),
    enabled: isChangingState && canTransition,
  });
  const offered = transitions.data?.filter((entry) => entry.available) ?? [];
  const chosen = offered.find((entry) => entry.transitionId === transitionId);
  const moveMutation = useMutation({
    mutationFn: () =>
      chosen
        ? transitionWorkItem({
            key: item.key,
            toStateTemplateId: chosen.toStateTemplateId,
          })
        : Promise.reject(new Error("No available transition selected")),
    onSuccess: async () => {
      setError("");
      setTransitionId("");
      setIsChangingState(false);
      await queryClient.invalidateQueries({
        queryKey: ["work-items", item.projectId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["work-items", "transitions", item.key],
      });
    },
    onError: () => setError(t("workItems:board.moveFailed")),
  });

  return (
    <article
      draggable={canTransition || canRank}
      data-testid="work-item-board-card"
      data-work-item-key={item.key}
      className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 shadow-xs/5"
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <div className="flex items-start gap-2">
        {canSelect && (
          <Checkbox
            aria-label={t("workItems:bulk.selectItem", { key: item.key })}
            checked={selected}
            disabled={item.unavailableFields.includes("key")}
            onCheckedChange={(checked) =>
              onSelectionChange(item.key, Boolean(checked))
            }
          />
        )}
        <a
          className="min-w-0 flex-1 font-medium hover:underline"
          href={routes.workItemDetail.build({ key: item.key })}
        >
          <span>{item.key}</span>
          <span className="ml-2">{item.title}</span>
        </a>
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
              ? t("workItems:detail.inactiveAssignee")
              : t("workItems:list.unassigned"))}
        </span>
      </div>
      {canTransition && (
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
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
                disabled={!chosen || moveMutation.isPending}
                onClick={() => moveMutation.mutate()}
              >
                {t("workItems:board.moveState")}
              </Button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
      <span className="sr-only">
        {t("workItems:board.currentState", { state: state.name })}
      </span>
    </article>
  );
}
