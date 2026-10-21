import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Button,
  CircularProgress,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Skeleton,
} from "@taskdesk/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useGetHierarchyChildren } from "@/hooks/queries/work-item/use-get-hierarchy-children";
import { getColumnIcon } from "@/lib/column";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";
import {
  HIERARCHY_AUTO_RESTORE_PAGES,
  HIERARCHY_URL_MAX_ENTRIES,
  type HierarchyUrlState,
  parseWorkItemHierarchySearch,
} from "@/lib/work-item-hierarchy-search";

type Query = ReturnType<typeof useGetHierarchyChildren>;
type Page = NonNullable<Query["data"]>["pages"][number];
type Node = Page["data"][number];
type Context = {
  currentKey: string;
  currentQuery: Query;
  path: Node[];
  state: HierarchyUrlState;
  expanded: string[];
  update: (state: HierarchyUrlState) => void;
};

/** Kaneo task/task-subtasks.tsx composition: same disclosure, compact rows and progress. */
export default function WorkItemHierarchy({
  workItemKey,
  onAccessLost,
}: {
  workItemKey: string;
  onAccessLost: () => void;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const search = location.search;
  const navigate = useNavigate();
  const parsed = parseWorkItemHierarchySearch(search).hierarchy;
  const state =
    parsed?.itemKey === workItemKey ? parsed : { itemKey: workItemKey };
  const currentQuery = useGetHierarchyChildren(workItemKey);
  const currentFatal =
    currentQuery.isError && !currentQuery.isFetchNextPageError;
  const first = currentFatal ? undefined : currentQuery.data?.pages[0];
  useEffect(() => {
    if (
      currentQuery.error instanceof HttpError &&
      (currentQuery.error.status === 404 || currentQuery.error.status === 403)
    )
      onAccessLost();
  }, [currentQuery.error, onAccessLost]);
  const update = (next: HierarchyUrlState) => {
    const params = new URLSearchParams(location.searchStr);
    const retained = [...(next.expanded ?? expanded), workItemKey];
    const bounded = {
      ...next,
      pages: next.pages
        ? Object.fromEntries(
            Object.entries(next.pages).filter(([key]) =>
              retained.includes(key),
            ),
          )
        : undefined,
    };
    params.set("hierarchy", JSON.stringify(bounded));
    void navigate({
      href: `${location.pathname}?${params}${location.hash ? `#${location.hash}` : ""}`,
      replace: true,
    });
  };
  const path: Node[] = first
    ? [...first.ancestors, first.parent].map((node) => ({
        ...node,
        hasChildren: true,
      }))
    : [];
  const expanded = state.expanded ?? [
    ...path.map((node) => node.key),
    workItemKey,
  ];
  const context: Context = {
    currentKey: workItemKey,
    currentQuery,
    path,
    state,
    expanded,
    update,
  };
  const open = !state.collapsed;
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) =>
        update({ ...state, collapsed: next ? undefined : true })
      }
      className="w-full bg-background"
      data-testid="work-item-hierarchy"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                type="button"
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              />
            }
          >
            {open ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            {t("workItems:hierarchy.title")}
          </CollapsibleTrigger>
          {first && first.progress.total > 0 ? (
            <span className="flex items-center gap-1.5 ml-0.5">
              <span className="sr-only">
                {t("workItems:hierarchy.progress", first.progress)}
              </span>
              <CircularProgress
                completed={first.progress.completed}
                total={first.progress.total}
              />
              <span
                className="text-xs text-muted-foreground"
                aria-hidden="true"
              >
                {first.progress.completed}/{first.progress.total}
              </span>
            </span>
          ) : null}
        </div>
      </div>
      <CollapsibleContent>
        {expanded.length >= HIERARCHY_URL_MAX_ENTRIES ? (
          <p role="status" className="text-xs text-muted-foreground px-2 py-1">
            {t("workItems:hierarchy.disclosureLimit")}
          </p>
        ) : null}
        {currentQuery.isPending ? (
          <Skeleton className="h-8 w-full" />
        ) : currentFatal ? (
          <HierarchyError onRetry={() => void currentQuery.refetch()} />
        ) : path[0] ? (
          <HierarchyNode
            key={`${workItemKey}:${path[0].key}`}
            node={path[0]}
            context={context}
            ancestors={[]}
          />
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

function HierarchyError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex items-center gap-2 px-2 py-1 bg-background"
    >
      <span className="text-xs text-muted-foreground">
        {t("workItems:hierarchy.error")}
      </span>
      <Button variant="ghost" size="xs" onClick={onRetry}>
        {t("workItems:hierarchy.retry")}
      </Button>
    </div>
  );
}

function HierarchyNode({
  node,
  context,
  ancestors,
}: {
  node: Node;
  context: Context;
  ancestors: string[];
}) {
  const { t } = useTranslation();
  const { currentKey, currentQuery, path, state, expanded, update } = context;
  const isCurrent = node.key === currentKey;
  const open = expanded.includes(node.key);
  const otherQuery = useGetHierarchyChildren(
    node.key,
    !isCurrent && open && node.hasChildren,
  );
  const query = isCurrent ? currentQuery : otherQuery;
  const fatalError = query.isError && !query.isFetchNextPageError;
  const data = fatalError ? undefined : query.data;
  const desiredPages = state.pages?.[node.key] ?? 1;
  useEffect(() => {
    if (
      open &&
      data &&
      data.pages.length <
        Math.min(desiredPages, HIERARCHY_AUTO_RESTORE_PAGES) &&
      query.hasNextPage &&
      !query.isFetching &&
      !query.isError
    )
      void query.fetchNextPage();
  }, [
    open,
    data,
    desiredPages,
    query.hasNextPage,
    query.isFetching,
    query.isError,
    query.fetchNextPage,
  ]);
  const rows = [
    ...new Map(
      data?.pages.flatMap((page) => page.data).map((row) => [row.id, row]) ??
        [],
    ).values(),
  ];
  const pathIndex = path.findIndex((candidate) => candidate.key === node.key);
  const nextPathNode = pathIndex >= 0 ? path[pathIndex + 1] : undefined;
  const outsidePage =
    nextPathNode && !rows.some((row) => row.id === nextPathNode.id)
      ? nextPathNode
      : undefined;
  const toggle = () =>
    update({
      ...state,
      expanded: open
        ? expanded.filter((key) => key !== node.key)
        : [...expanded, node.key],
    });
  const complete =
    node.stateCategory === "completed" || node.stateCategory === "cancelled";
  const nextAncestors = [...ancestors, node.key];
  return (
    <div
      className="flex flex-col mt-1 bg-background"
      data-hierarchy-key={node.key}
    >
      <div
        className={`group flex items-center gap-2 py-1 px-2 rounded-md transition-colors ${isCurrent ? "bg-primary/10" : "hover:bg-accent/50"}`}
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          aria-label={t(
            open
              ? "workItems:hierarchy.collapse"
              : "workItems:hierarchy.expand",
            { key: node.key },
          )}
          aria-expanded={node.hasChildren ? open : undefined}
          disabled={
            !node.hasChildren ||
            (!open && expanded.length >= HIERARCHY_URL_MAX_ENTRIES)
          }
          onClick={toggle}
        >
          {node.hasChildren ? (
            open ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )
          ) : (
            getColumnIcon(node.stateCategory, complete)
          )}
        </Button>
        <Button
          variant="ghost"
          className="flex-1 min-w-0 justify-start text-left outline-none"
          render={
            <Link
              to={routes.workItemDetail.path}
              params={{ key: node.key }}
              search={{}}
              aria-current={isCurrent ? "page" : undefined}
              activeOptions={{ exact: true, includeSearch: false }}
            />
          }
        >
          <span
            className={`text-sm truncate block ${complete ? "line-through text-muted-foreground" : "text-foreground"}`}
          >
            {node.key} · {node.title}
          </span>
        </Button>
        <span className="text-xs text-muted-foreground">{node.stateName}</span>
      </div>
      {open && node.hasChildren ? (
        <div className="ml-4">
          {query.isPending ? (
            <Skeleton className="h-8 w-full" />
          ) : fatalError ? (
            <HierarchyError onRetry={() => void query.refetch()} />
          ) : (
            <>
              {nextPathNode ? (
                <div>
                  {outsidePage ? (
                    <p className="text-xs text-muted-foreground px-2 py-1">
                      {t("workItems:hierarchy.currentBranch")}
                    </p>
                  ) : null}
                  <HierarchyNode
                    node={nextPathNode}
                    context={context}
                    ancestors={nextAncestors}
                  />
                </div>
              ) : null}
              {rows
                .filter(
                  (row) =>
                    !nextAncestors.includes(row.key) &&
                    row.id !== nextPathNode?.id,
                )
                .map((row) => (
                  <HierarchyNode
                    key={row.id}
                    node={row}
                    context={context}
                    ancestors={nextAncestors}
                  />
                ))}
              {query.isFetchNextPageError ? (
                <HierarchyError onRetry={() => void query.fetchNextPage()} />
              ) : null}
              {desiredPages > HIERARCHY_AUTO_RESTORE_PAGES &&
              (data?.pages.length ?? 0) >= HIERARCHY_AUTO_RESTORE_PAGES &&
              (data?.pages.length ?? 0) < desiredPages ? (
                <p className="text-xs text-muted-foreground px-2 py-1">
                  {t("workItems:hierarchy.restoreLimit", {
                    count: HIERARCHY_AUTO_RESTORE_PAGES,
                  })}
                </p>
              ) : null}
              {query.hasNextPage && !query.isFetchNextPageError ? (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={query.isFetchingNextPage}
                  onClick={() => {
                    update({
                      ...state,
                      pages: {
                        ...state.pages,
                        [node.key]: (data?.pages.length ?? 1) + 1,
                      },
                    });
                    void query.fetchNextPage();
                  }}
                >
                  {t(
                    query.isFetchingNextPage
                      ? "workItems:hierarchy.loading"
                      : "workItems:hierarchy.more",
                    { key: node.key },
                  )}
                </Button>
              ) : null}
              {data && rows.length === 0 && !outsidePage ? (
                <p className="text-xs text-muted-foreground px-2 py-1">
                  {t("workItems:hierarchy.empty")}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
