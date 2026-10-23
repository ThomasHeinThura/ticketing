import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  Button,
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@/components/avatar";
import RelationsSection from "@/components/task/relations-section";
import {
  createWorkItemRelation,
  getRelationCandidates,
  getWorkItemRelations,
  requestWorkItemRelationRemoval,
  type WorkItemRelation,
} from "@/fetchers/work-item/relations";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getColumnIcon } from "@/lib/column";
import { getInitials } from "@/lib/get-initials";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";
import {
  parseWorkItemRelationsSearch,
  RELATION_PICKER_TYPES,
  type RelationPickerType,
  type RelationsUrlState,
} from "@/lib/work-item-relations-search";

export default function WorkItemRelations({
  itemKey,
  workspaceId,
  projectId,
}: {
  itemKey: string;
  workspaceId: string;
  projectId: string;
}) {
  const { t } = useTranslation();
  const permission = useWorkspacePermission(workspaceId, projectId);
  const canEdit = permission.canUpdateTasks();
  const location = useLocation();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const scope = `${workspaceId}:${itemKey}`;
  const activeScope = useRef<string | undefined>(scope);
  activeScope.current = scope;
  useEffect(
    () => () => {
      activeScope.current = undefined;
    },
    [],
  );
  const parsed = parseWorkItemRelationsSearch(location.search).relations;
  const state: RelationsUrlState =
    parsed?.itemKey === itemKey ? parsed : { itemKey };
  const pickerOpen = Boolean(state.picker && canEdit);
  const relationType = state.type ?? "relates";
  const openPendingAction = useOpenPendingAction();
  const update = (next: RelationsUrlState) => {
    const params = new URLSearchParams(location.searchStr);
    params.set("relations", JSON.stringify(next));
    void navigate({
      href: `${location.pathname}?${params}${location.hash ? `#${location.hash}` : ""}`,
      replace: true,
    });
  };
  const relations = useQuery({
    queryKey: ["work-items", "relations", workspaceId, itemKey],
    queryFn: () => getWorkItemRelations(itemKey),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const candidates = useInfiniteQuery({
    queryKey: [
      "work-items",
      "relation-candidates",
      workspaceId,
      itemKey,
      state.query ?? "",
    ],
    queryFn: ({ pageParam }) =>
      getRelationCandidates({
        key: itemKey,
        q: state.query ?? "",
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    enabled: pickerOpen,
  });
  const create = useMutation({
    mutationKey: ["relation-create", itemKey],
    mutationFn: (targetKey: string) =>
      createWorkItemRelation({
        sourceKey: itemKey,
        targetKey,
        type: relationType,
      }),
    onSuccess: async (_result, targetKey) => {
      await Promise.all(
        [itemKey, targetKey].map((key) =>
          cache.invalidateQueries({
            queryKey: ["work-items", "relations", workspaceId, key],
          }),
        ),
      );
      if (activeScope.current === scope)
        update({ ...state, picker: undefined, query: undefined });
    },
  });
  const remove = useMutation({
    mutationKey: ["relation-remove", itemKey],
    mutationFn: (id: string) =>
      requestWorkItemRelationRemoval({ key: itemKey, id }),
    // Nothing is removed yet: the approval opens in place as a confirm dialog.
    onSuccess: (result) => openPendingAction(result),
  });
  const data = relations.isError ? undefined : relations.data;
  const groups = new Map<RelationPickerType, WorkItemRelation[]>();
  for (const relation of data?.data ?? [])
    groups.set(relation.label, [
      ...(groups.get(relation.label) ?? []),
      relation,
    ]);
  const candidateAccessLost =
    candidates.error instanceof HttpError &&
    [403, 404].includes(candidates.error.status);
  const candidateFatal =
    candidates.isError &&
    (!candidates.isFetchNextPageError || candidateAccessLost);
  const results = candidateFatal
    ? []
    : [
        ...new Map(
          (candidates.data?.pages.flatMap((page) => page.data) ?? []).map(
            (item) => [item.id, item],
          ),
        ).values(),
      ];
  const openItem = (key: string) =>
    void navigate({ href: routes.workItemDetail.build({ key }) });

  return (
    <>
      <RelationsSection
        open={!state.collapsed}
        onOpenChange={(open) =>
          update({ ...state, collapsed: open ? undefined : true })
        }
        count={(data?.data.length ?? 0) + (data?.hiddenCount ?? 0)}
        title={t("tasks:relations.title")}
        canEdit={canEdit}
        addLabel={t("workItems:relations.add")}
        onAdd={() => {
          create.reset();
          update({ ...state, picker: true });
        }}
      >
        {relations.isPending ? (
          <Skeleton className="h-8 w-full" />
        ) : relations.isError ? (
          <p role="alert" className="text-xs px-2 py-1">
            {t("workItems:relations.error")}{" "}
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void relations.refetch()}
            >
              {t("workItems:hierarchy.retry")}
            </Button>
          </p>
        ) : (
          <>
            {[...groups].map(([label, items]) => (
              <div key={label} className="mt-1.5">
                <span className="text-xs text-muted-foreground px-2">
                  {t(`workItems:relations.types.${label}`)}
                </span>
                <div className="flex flex-col mt-0.5">
                  {items.map((relation) => {
                    const item = relation.item;
                    const complete =
                      item.stateCategory === "completed" ||
                      item.stateCategory === "cancelled";
                    return (
                      <ContextMenu key={relation.id}>
                        <ContextMenuTrigger asChild>
                          <div className="group flex items-center gap-2 py-1 px-2 rounded-md hover:bg-accent/50 transition-colors cursor-default">
                            <span
                              title={item.stateName}
                              className="shrink-0 flex items-center justify-center rounded p-0.5 text-muted-foreground"
                            >
                              {getColumnIcon(item.stateCategory, complete)}
                            </span>
                            <span className="text-xs text-muted-foreground shrink-0 font-mono">
                              {item.key}
                            </span>
                            <Button
                              variant="ghost"
                              render={
                                <a
                                  href={routes.workItemDetail.build({
                                    key: item.key,
                                  })}
                                />
                              }
                              className="flex-1 min-w-0 justify-start px-0 text-left outline-none"
                            >
                              <span
                                className={`text-sm truncate block ${complete ? "line-through text-muted-foreground" : "text-foreground"}`}
                              >
                                {item.title}
                              </span>
                            </Button>
                            <span className="text-xs text-muted-foreground">
                              {item.stateName}
                            </span>
                            {relation.blockingCycle && (
                              <span className="text-xs text-warning-foreground">
                                {t("workItems:relations.cycle")}
                              </span>
                            )}
                            {item.assigneeName ? (
                              <Avatar
                                className="h-5 w-5"
                                title={item.assigneeName}
                              >
                                <AvatarFallback className="text-xs font-medium border border-border/30">
                                  {getInitials(item.assigneeName)}
                                </AvatarFallback>
                              </Avatar>
                            ) : (
                              <span
                                className="text-xs text-muted-foreground"
                                title={t("tasks:popover.assignee.unassigned")}
                              >
                                ?
                              </span>
                            )}
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-40">
                          <ContextMenuItem onClick={() => openItem(item.key)}>
                            {t("tasks:relations.openTask")}
                          </ContextMenuItem>
                          {canEdit && relation.canRemove && (
                            <>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                disabled={remove.isPending}
                                className="text-destructive"
                                onClick={() => remove.mutate(relation.id)}
                              >
                                {t("tasks:relations.removeRelation")}
                              </ContextMenuItem>
                            </>
                          )}
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
                </div>
              </div>
            ))}
            {data?.hiddenCount ? (
              <p className="text-xs text-muted-foreground px-2 py-1">
                {t("workItems:relations.hidden", { count: data.hiddenCount })}
              </p>
            ) : null}
            {data && data.data.length === 0 && data.hiddenCount === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-1">
                {t("tasks:relations.empty")}
              </p>
            )}
          </>
        )}
        {remove.isError && (
          <p role="alert" className="text-xs px-2 py-1">
            {t("workItems:relations.removeError")}
          </p>
        )}
      </RelationsSection>
      <CommandDialog
        open={pickerOpen}
        onOpenChange={(open) =>
          update({ ...state, picker: open ? true : undefined })
        }
      >
        <CommandDialogPopup aria-label={t("workItems:relations.add")}>
          <Command items={results} filter={null}>
            <CommandInput
              aria-label={t("tasks:relations.searchPlaceholder")}
              placeholder={t("tasks:relations.searchPlaceholder")}
              value={state.query ?? ""}
              maxLength={200}
              onChange={(event) =>
                update({ ...state, query: event.target.value || undefined })
              }
            />
            <CommandPanel>
              {candidates.isPending ? (
                <Skeleton className="h-8 w-full" />
              ) : candidateFatal ? (
                <p role="alert" className="text-xs px-2 py-1">
                  {t("workItems:relations.searchError")}{" "}
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void candidates.refetch()}
                  >
                    {t("workItems:hierarchy.retry")}
                  </Button>
                </p>
              ) : (
                <>
                  <CommandEmpty>
                    {t("tasks:relations.noTasksFound")}
                  </CommandEmpty>
                  <CommandList>
                    {(item) => (
                      <CommandItem
                        key={item.id}
                        value={`${item.key} ${item.title}`}
                        disabled={create.isPending}
                        onClick={() => create.mutate(item.key)}
                        className="flex items-center gap-3 py-2"
                      >
                        <span className="text-xs text-muted-foreground shrink-0 font-mono">
                          {item.key}
                        </span>
                        <span className="text-sm truncate flex-1">
                          {item.title}
                        </span>
                      </CommandItem>
                    )}
                  </CommandList>
                </>
              )}
              {candidates.isFetchNextPageError && !candidateAccessLost && (
                <p role="alert" className="text-xs px-2 py-1">
                  {t("workItems:relations.searchError")}
                </p>
              )}
              {candidates.hasNextPage && (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={candidates.isFetchingNextPage}
                  onClick={() => void candidates.fetchNextPage()}
                >
                  {t("workItems:list.loadMore")}
                </Button>
              )}
              {create.isError && (
                <p role="alert" className="text-xs px-2 py-1">
                  {t("workItems:relations.linkError")}
                </p>
              )}
            </CommandPanel>
            <CommandFooter>
              <Select
                value={relationType}
                onValueChange={(type) => {
                  if (
                    type &&
                    RELATION_PICKER_TYPES.includes(type as RelationPickerType)
                  )
                    update({ ...state, type: type as RelationPickerType });
                }}
              >
                <SelectTrigger aria-label={t("workItems:relations.type")}>
                  <SelectValue>
                    {t(`workItems:relations.types.${relationType}`)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {RELATION_PICKER_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`workItems:relations.types.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">
                {t("tasks:relations.selectTask")}
              </span>
            </CommandFooter>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>
    </>
  );
}
