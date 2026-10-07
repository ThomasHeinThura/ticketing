import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import WorkItemFilterEditor from "@/components/work-item/work-item-filter-editor";
import WorkItemList from "@/components/work-item/work-item-list";
import getProjects from "@/fetchers/project/get-projects";
import {
  countSavedView,
  createSavedView,
  getSavedView,
  getSavedViews,
  runSavedView,
  runSavedViewUrlQuery,
  toggleSavedViewPin,
  updateSavedView,
} from "@/fetchers/saved-views";
import {
  parseSavedViewUrlSearch,
  routes,
  type SavedViewUrlSearch,
  type WorkItemSearchColumn,
  type WorkItemSortDirection,
  type WorkItemSortField,
} from "@/lib/routes";
import {
  cloneSavedViewName,
  isExecutableSavedViewQuery,
  savedViewUrlContextMatches,
} from "@/lib/saved-view-query";
import {
  parseWorkItemFilterText,
  printWorkItemFilterText,
} from "@/lib/work-item-filter";
import { parseWorkItemRow } from "@/types/work-item";

export const Route = createFileRoute("/_layout/_authenticated/agent/views/$id")(
  {
    validateSearch: parseSavedViewUrlSearch,
    component: SavedViewRoute,
  },
);

function storedSearch(
  view: Awaited<ReturnType<typeof getSavedView>>,
): SavedViewUrlSearch {
  const query =
    view.query && typeof view.query === "object"
      ? (view.query as Record<string, unknown>)
      : {};
  const sort = Array.isArray(query.sort)
    ? (query.sort[0] as Record<string, unknown> | undefined)
    : undefined;
  let filter = "";
  try {
    filter =
      typeof query.filter === "string"
        ? query.filter
        : printWorkItemFilterText(
            query.filter as Parameters<typeof printWorkItemFilterText>[0],
          );
  } catch {
    filter = "";
  }
  const columns =
    Array.isArray(query.columns) &&
    query.columns.every(
      (
        item,
      ): item is
        | "key"
        | "title"
        | "state"
        | "assignee"
        | "priority"
        | "dueDate" =>
        typeof item === "string" &&
        ["key", "title", "state", "assignee", "priority", "dueDate"].includes(
          item,
        ),
    )
      ? query.columns
      : undefined;
  return {
    workspaceId: view.workspaceId,
    scope: view.scope === "project" ? "project" : "workspace",
    scopeId: view.scopeId,
    layout: view.layout,
    ...(filter ? { filter } : {}),
    filterMode: "visual",
    sort:
      sort && typeof sort.field === "string"
        ? (sort.field as WorkItemSortField)
        : "key",
    dir: sort?.direction === "desc" ? "desc" : "asc",
    ...(columns ? { columns } : {}),
  };
}

function queryFor(search: Partial<SavedViewUrlSearch>) {
  const filter = search.filter
    ? parseWorkItemFilterText(search.filter)
    : undefined;
  return {
    entity: "work_item",
    ...(filter ? { filter } : {}),
    ...(search.sort && search.dir
      ? { sort: [{ field: search.sort, direction: search.dir }] }
      : {}),
    ...(search.columns ? { columns: search.columns } : {}),
  };
}

function SavedViewRoute() {
  const { t } = useTranslation("savedViews");
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const viewQuery = useQuery({
    queryKey: ["saved-view", user?.id, id],
    queryFn: () => getSavedView(id),
  });
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const [visibility, setVisibility] = useState<
    "private" | "team" | "workspace"
  >("private");
  const [teamAudienceId, setTeamAudienceId] = useState("");
  const [filterMode, setFilterMode] = useState<"visual" | "text">("visual");
  const [isEditing, setIsEditing] = useState(false);
  const snapshotComplete = Boolean(
    search.workspaceId && search.scope && search.scopeId && search.layout,
  );
  const storedQueryIsUnsupported = Boolean(
    viewQuery.data && !isExecutableSavedViewQuery(viewQuery.data.query),
  );
  const workspaceId = search.workspaceId ?? viewQuery.data?.workspaceId;
  const workspaceViews = useQuery({
    queryKey: ["saved-views", workspaceId, user?.id],
    queryFn: () => getSavedViews(workspaceId ?? ""),
    enabled: Boolean(workspaceId && user?.id),
  });
  const isPinned =
    workspaceViews.data?.find((view) => view.id === id)?.isPinned ?? false;
  const projectsQuery = useQuery({
    queryKey: ["saved-view-projects", user?.id, workspaceId],
    queryFn: () => getProjects({ workspaceId: workspaceId ?? "" }),
    enabled: Boolean(workspaceId && user?.id),
  });
  const project =
    search.scope === "project"
      ? projectsQuery.data?.find((item) => item.id === search.scopeId)
      : undefined;

  useEffect(() => {
    setFilterMode(search.filterMode ?? "visual");
  }, [search.filterMode]);

  useEffect(() => {
    if (!viewQuery.data) return;
    const snapshot = storedSearch(viewQuery.data);
    setName(viewQuery.data.name);
    if (
      viewQuery.data.visibility === "private" ||
      viewQuery.data.visibility === "team" ||
      viewQuery.data.visibility === "workspace"
    ) {
      setVisibility(viewQuery.data.visibility);
    }
    setTeamAudienceId(viewQuery.data.sharedWithTeamId ?? "");
    if (!snapshotComplete) {
      setFilter(snapshot.filter ?? "");
      void navigate({ search: snapshot, replace: true });
      return;
    }
    setFilter(search.filter ?? "");
  }, [navigate, search.filter, snapshotComplete, viewQuery.data]);

  const effectiveSearch = snapshotComplete
    ? search
    : viewQuery.data
      ? storedSearch(viewQuery.data)
      : search;
  const savedViewContextMatches = Boolean(
    viewQuery.data &&
      savedViewUrlContextMatches(viewQuery.data, search, snapshotComplete),
  );
  const unsupportedStoredQuery = Boolean(
    storedQueryIsUnsupported ||
      (viewQuery.data &&
        (!savedViewContextMatches || effectiveSearch.layout !== "list")),
  );
  const sort = effectiveSearch.sort ?? "key";
  const dir = effectiveSearch.dir ?? "asc";
  const cloneLayoutIsKnown = [
    "board",
    "list",
    "table",
    "calendar",
    "timeline",
    "chart",
  ].includes(effectiveSearch.layout ?? "");
  const stored = viewQuery.data ? storedSearch(viewQuery.data) : undefined;
  const savedDefinitionMatches = Boolean(
    stored &&
      stored.workspaceId === effectiveSearch.workspaceId &&
      stored.scope === effectiveSearch.scope &&
      stored.scopeId === effectiveSearch.scopeId &&
      stored.layout === effectiveSearch.layout &&
      (stored.filter ?? "") === (effectiveSearch.filter ?? "") &&
      stored.sort === effectiveSearch.sort &&
      stored.dir === effectiveSearch.dir &&
      JSON.stringify(stored.columns ?? null) ===
        JSON.stringify(effectiveSearch.columns ?? null),
  );
  const queryKey = useMemo(
    () => [
      "saved-view-run",
      user?.id,
      id,
      viewQuery.data?.updatedAt,
      effectiveSearch,
    ],
    [effectiveSearch, id, user?.id, viewQuery.data?.updatedAt],
  );
  const results = useInfiniteQuery({
    queryKey,
    enabled: Boolean(
      viewQuery.data &&
        !unsupportedStoredQuery &&
        effectiveSearch.layout === "list" &&
        effectiveSearch.workspaceId &&
        (effectiveSearch.scope !== "project" || project),
    ),
    initialPageParam: effectiveSearch.cursor,
    queryFn: async ({ pageParam }) => {
      if (savedDefinitionMatches) {
        const result = await runSavedView({ id, cursor: pageParam });
        const items = result.data.map(parseWorkItemRow);
        return {
          items,
          hasPartialFailure: items.some(
            (item) => item.unavailableFields.length > 0,
          ),
          hasMore: result.page.hasMore,
          nextCursor: result.page.nextCursor,
          total: result.meta.total,
        };
      }
      return runSavedViewUrlQuery({
        workspaceId: effectiveSearch.workspaceId as string,
        filter: effectiveSearch.filter,
        ...(effectiveSearch.scope === "project" && project
          ? { projectSlug: project.slug }
          : {}),
        sort,
        dir,
        columns: effectiveSearch.columns,
        cursor: pageParam,
      });
    },
    getNextPageParam: (last) =>
      last.hasMore ? (last.nextCursor ?? undefined) : undefined,
  });
  const countQuery = useQuery({
    queryKey: ["saved-view-count", user?.id, id, viewQuery.data?.updatedAt],
    queryFn: () => countSavedView(id),
    enabled: Boolean(
      viewQuery.data && savedDefinitionMatches && !unsupportedStoredQuery,
    ),
    staleTime: 30_000,
  });

  const pin = useMutation({
    mutationFn: () => toggleSavedViewPin(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["saved-views"] }),
  });
  const save = useMutation({
    mutationFn: () =>
      updateSavedView({
        id,
        name,
        visibility,
        sharedWithTeamId: visibility === "team" ? teamAudienceId.trim() : null,
        layout: effectiveSearch.layout,
        query: queryFor(effectiveSearch),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["saved-view", user?.id, id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["saved-view-count", user?.id, id],
        }),
        queryClient.invalidateQueries({ queryKey: ["saved-views"] }),
      ]);
      setIsEditing(false);
    },
  });
  const clone = useMutation({
    mutationFn: () =>
      createSavedView({
        workspaceId: effectiveSearch.workspaceId as string,
        name: cloneSavedViewName(viewQuery.data?.name ?? t("title")),
        scope: effectiveSearch.scope as "workspace" | "project",
        scopeId: effectiveSearch.scopeId as string,
        visibility: "private",
        layout: effectiveSearch.layout as
          | "board"
          | "list"
          | "table"
          | "calendar"
          | "timeline"
          | "chart",
        query: queryFor(effectiveSearch),
      }),
    onSuccess: (view) =>
      void navigate({
        to: routes.savedView.path,
        params: { id: view.id },
        search: { ...effectiveSearch, cursor: undefined },
      }),
  });

  const allItems = results.data?.pages.flatMap((page) => page.items) ?? [];
  const currentCount = savedDefinitionMatches
    ? countQuery.data
    : results.data?.pages[0]?.total;
  const updateSearch = (changes: Partial<SavedViewUrlSearch>) =>
    void navigate({
      search: { ...effectiveSearch, ...changes },
      replace: true,
    });
  const handleSortChange = (
    nextSort: WorkItemSortField,
    nextDir: WorkItemSortDirection,
  ) => updateSearch({ sort: nextSort, dir: nextDir, cursor: undefined });

  return (
    <main className="flex min-h-full flex-col gap-5 p-5 lg:p-8">
      <PageTitle title={viewQuery.data?.name ?? t("title")} />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {viewQuery.data?.name ?? t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {currentCount === undefined
              ? t("countLoading")
              : t("count", { count: currentCount })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={pin.isPending}
            onClick={() => pin.mutate()}
          >
            {isPinned ? t("unpin") : t("pin")}
          </Button>
          <Button
            variant="outline"
            disabled={
              clone.isPending ||
              unsupportedStoredQuery ||
              !effectiveSearch.workspaceId ||
              !effectiveSearch.scopeId ||
              !cloneLayoutIsKnown
            }
            onClick={() => clone.mutate()}
          >
            {t("clone")}
          </Button>
          {viewQuery.data && (
            <Button
              variant="outline"
              disabled={unsupportedStoredQuery}
              onClick={() => setIsEditing((value) => !value)}
            >
              {isEditing ? t("cancelEdit") : t("edit")}
            </Button>
          )}
          {isEditing && (
            <Button
              disabled={
                save.isPending ||
                (visibility === "team" && !teamAudienceId.trim())
              }
              onClick={() => save.mutate()}
            >
              {t("save")}
            </Button>
          )}
        </div>
      </header>
      {viewQuery.isLoading && !snapshotComplete ? (
        <p role="status">{t("loadingView")}</p>
      ) : null}
      {viewQuery.isError && !snapshotComplete ? (
        <p role="alert">{t("loadError")}</p>
      ) : null}
      {search.scope === "project" && !project ? (
        <p role="alert">{t("projectUnavailable")}</p>
      ) : null}
      {unsupportedStoredQuery && effectiveSearch.layout === "list" ? (
        <p role="alert">{t("layoutUnavailable")}</p>
      ) : null}
      {effectiveSearch.layout !== "list" ? (
        <p role="alert">{t("layoutUnavailable")}</p>
      ) : null}
      {isEditing ? (
        <Card>
          <CardContent className="grid gap-4 py-4">
            <Input
              aria-label={t("name")}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="grid gap-1 text-sm">
              {t("visibility", { visibility: "" })}
              <Select
                value={visibility}
                onValueChange={(value) => {
                  if (
                    value === "private" ||
                    value === "team" ||
                    value === "workspace"
                  ) {
                    setVisibility(value);
                    if (value !== "team") setTeamAudienceId("");
                  }
                }}
              >
                <SelectTrigger aria-label={t("visibility", { visibility: "" })}>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {(["private", "team", "workspace"] as const).map((value) => (
                    <SelectItem key={value} value={value}>
                      {t("visibility", { visibility: value })}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            {visibility === "team" ? (
              <Input
                aria-label={t("visibility", { visibility: "team audience ID" })}
                placeholder={t("visibility", {
                  visibility: "team audience ID",
                })}
                value={teamAudienceId}
                onChange={(event) => setTeamAudienceId(event.target.value)}
              />
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Select
                value={sort}
                onValueChange={(value) =>
                  value && handleSortChange(value as WorkItemSortField, dir)
                }
              >
                <SelectTrigger aria-label={t("sort")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {["key", "title", "priority", "dueDate"].map((field) => (
                    <SelectItem key={field} value={field}>
                      {field}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Select
                value={dir}
                onValueChange={(value) =>
                  value &&
                  handleSortChange(sort, value as WorkItemSortDirection)
                }
              >
                <SelectTrigger aria-label={t("direction")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="asc">Ascending</SelectItem>
                  <SelectItem value="desc">Descending</SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <WorkItemFilterEditor
              filter={filter}
              mode={filterMode}
              fallbackSurface="card"
              onModeChange={(mode) => {
                setFilterMode(mode);
                updateSearch({ filterMode: mode });
              }}
              onApply={(value) => {
                setFilter(value);
                updateSearch({
                  filter: value || undefined,
                  filterMode,
                  cursor: undefined,
                });
              }}
            />
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">{t("columns")}</legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    "key",
                    "title",
                    "state",
                    "assignee",
                    "priority",
                    "dueDate",
                  ] as const
                ).map((column) => {
                  const selected: WorkItemSearchColumn[] =
                    effectiveSearch.columns ?? [
                      "key",
                      "title",
                      "priority",
                      "dueDate",
                      "state",
                      "assignee",
                    ];
                  const pressed = selected.includes(column);
                  return (
                    <Button
                      key={column}
                      type="button"
                      variant={pressed ? "default" : "outline"}
                      aria-pressed={pressed}
                      disabled={pressed && selected.length === 1}
                      onClick={() =>
                        updateSearch({
                          columns: pressed
                            ? selected.filter((value) => value !== column)
                            : [...selected, column],
                          cursor: undefined,
                        })
                      }
                    >
                      {t(
                        `workItems:list.column${column[0]?.toUpperCase()}${column.slice(1)}`,
                      )}
                    </Button>
                  );
                })}
              </div>
            </fieldset>
          </CardContent>
        </Card>
      ) : null}
      {results.isError ? <p role="alert">{t("runError")}</p> : null}
      <WorkItemList
        workItems={allItems}
        hasPartialFailure={
          results.data?.pages.some((page) => page.hasPartialFailure) ?? false
        }
        isLoading={results.isLoading}
        isError={false}
        sort={sort}
        dir={dir}
        onSortChange={handleSortChange}
        onRetry={() => void results.refetch()}
        columns={effectiveSearch.columns}
      />
      {results.hasNextPage ? (
        <Button
          variant="outline"
          disabled={results.isFetchingNextPage}
          onClick={() => void results.fetchNextPage()}
        >
          {results.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
        </Button>
      ) : null}
      {save.isError || pin.isError || clone.isError ? (
        <p role="alert">{t("saveError")}</p>
      ) : null}
    </main>
  );
}
