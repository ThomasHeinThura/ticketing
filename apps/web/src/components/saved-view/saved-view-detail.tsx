import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Alert, AlertDescription, Button } from "@taskdesk/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { SavedViewEditor } from "@/components/saved-view/saved-view-editor";
import WorkItemList from "@/components/work-item/work-item-list";
import {
  countSavedView,
  createSavedView,
  getSavedView,
  getSavedViews,
  getShareableViewTeams,
  runSavedView,
  runSavedViewUrlQuery,
  type SavedViewVisibility,
  toggleSavedViewPin,
  updateSavedView,
} from "@/fetchers/saved-views";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import type {
  SavedViewUrlSearch,
  WorkItemSearchSortField,
  WorkItemSortDirection,
  WorkItemSortField,
} from "@/lib/routes";
import { savedViewKeys } from "@/lib/saved-view-keys";
import {
  cloneSavedViewName,
  isExecutableSavedViewQuery,
  isSavedViewLayout,
  isSavedViewSnapshotComplete,
  savedViewDefinitionMatches,
  savedViewQueryDocument,
  savedViewSort,
  savedViewStoredSearch,
  savedViewUrlContextMatches,
} from "@/lib/saved-view-query";

/**
 * `docs/02-design/screen-inventory.md` "Saved view" (`/agent/views/{id}`), `SV-14`..`SV-21`.
 *
 * The URL fully encodes the view (`SV-19`): its workspace, scope, layout and query are search
 * parameters. Three cases follow from that, all decided here:
 *
 * 1. The viewer can read the view and the URL is its stored definition: the server runs the
 *    stored view (`POST /api/views/{id}/run`) and counts it.
 * 2. The viewer can read the view but the URL differs (an edit in progress, a changed link):
 *    the URL's definition runs as a direct work-item search, with the same validator and the
 *    same reach, and the screen says it is not the saved definition.
 * 3. The viewer cannot read the view (`403`/`404`) but the URL is a complete snapshot: that
 *    snapshot runs as the viewer, so a link to someone else's view still works for them and
 *    shows only what they may see. An incomplete snapshot runs nothing.
 */
function isUnreadable(error: unknown): boolean {
  return (
    error instanceof HttpError && (error.status === 403 || error.status === 404)
  );
}

export default function SavedViewDetail({
  id,
  search,
  onReplaceSearch,
  onOpenView,
}: {
  id: string;
  search: SavedViewUrlSearch;
  /** Replaces the URL's query (no history entry): an edit, a sort, a normalised link. */
  onReplaceSearch: (search: SavedViewUrlSearch) => void;
  /** Opens another saved view, with its full definition in the URL. */
  onOpenView: (id: string, search: SavedViewUrlSearch) => void;
}) {
  const { t } = useTranslation("savedViews");
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const viewQuery = useQuery({
    queryKey: savedViewKeys.detail(user?.id, id),
    queryFn: () => getSavedView(id),
    // A view that is missing or out of reach answers 403/404 and will not change on retry.
    retry: (count, error) => !isUnreadable(error) && count < 2,
  });
  const view = viewQuery.data;
  const viewSettled = viewQuery.isSuccess || viewQuery.isError;
  const viewUnreadable = viewQuery.isError && isUnreadable(viewQuery.error);
  const snapshotComplete = isSavedViewSnapshotComplete(search);

  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<SavedViewVisibility>("private");
  const [teamAudienceId, setTeamAudienceId] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const workspaceId = view?.workspaceId ?? search.workspaceId;
  const permissions = useWorkspacePermission(workspaceId);
  const canShare = Boolean(workspaceId) && permissions.canShareSavedViews();
  const canManageSettings =
    Boolean(workspaceId) && permissions.canManageWorkspaceSettings();

  const workspaceViews = useQuery({
    queryKey: savedViewKeys.list(workspaceId, user?.id),
    queryFn: () => getSavedViews(workspaceId ?? ""),
    enabled: Boolean(workspaceId && user?.id && view),
  });
  const teamAudiences = useQuery({
    queryKey: savedViewKeys.teamAudiences(workspaceId, user?.id),
    queryFn: () => getShareableViewTeams(workspaceId ?? ""),
    enabled: Boolean(
      workspaceId && user?.id && isEditing && visibility === "team" && canShare,
    ),
  });
  const isPinned =
    workspaceViews.data?.find((candidate) => candidate.id === id)?.isPinned ??
    false;

  // A readable view's own definition replaces a URL that is incomplete or names another
  // workspace, scope or layout, so what is shown is never another view's query under this
  // view's name. An unreadable view has no definition to compare with.
  const stored = useMemo(
    () => (view ? savedViewStoredSearch(view) : undefined),
    [view],
  );
  const contextMatches =
    !stored || savedViewUrlContextMatches(stored, search, snapshotComplete);
  useEffect(() => {
    if (!view || !stored) return;
    setName(view.name);
    if (
      view.visibility === "private" ||
      view.visibility === "team" ||
      view.visibility === "workspace"
    )
      setVisibility(view.visibility);
    setTeamAudienceId(view.sharedWithTeamId ?? "");
  }, [view, stored]);
  // At most one replacement per URL context: a stored definition the URL parser cannot carry
  // (an unknown layout, an oversized id) is shown from the stored view and never loops.
  const normalizedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!stored || (snapshotComplete && contextMatches)) return;
    if (!isSavedViewLayout(stored.layout)) return;
    const signature = [
      id,
      search.workspaceId,
      search.scope,
      search.scopeId,
      search.layout,
    ].join("|");
    if (normalizedFor.current === signature) return;
    normalizedFor.current = signature;
    onReplaceSearch({ ...stored, filterMode: search.filterMode });
  }, [
    contextMatches,
    id,
    onReplaceSearch,
    search.filterMode,
    search.layout,
    search.scope,
    search.scopeId,
    search.workspaceId,
    snapshotComplete,
    stored,
  ]);

  const effective: SavedViewUrlSearch =
    view && stored && !(snapshotComplete && contextMatches) ? stored : search;
  const storedQueryExecutable = view
    ? isExecutableSavedViewQuery(view.query)
    : true;
  const layoutIsList = effective.layout === "list";
  const isFallback = viewUnreadable && snapshotComplete;
  const canRun = Boolean(
    viewSettled &&
      layoutIsList &&
      effective.workspaceId &&
      ((view && storedQueryExecutable) || isFallback),
  );
  const unsupported = Boolean(
    view && (!storedQueryExecutable || effective.layout !== "list"),
  );

  const projectsQuery = useGetProjects(
    { workspaceId: effective.workspaceId ?? "" },
    effective.scope === "project",
  );
  const project =
    effective.scope === "project"
      ? projectsQuery.data?.find((item) => item.id === effective.scopeId)
      : undefined;
  const projectPending =
    effective.scope === "project" &&
    !project &&
    (projectsQuery.isLoading || !projectsQuery.data);
  const projectUnavailable =
    effective.scope === "project" && !project && !projectPending;

  const definitionMatches = Boolean(
    view && savedViewDefinitionMatches(view, effective),
  );
  const sort: WorkItemSearchSortField =
    savedViewSort(effective)?.field ?? "key";
  const dir: WorkItemSortDirection = savedViewSort(effective)?.order ?? "asc";

  const { filterMode: _mode, ...runIdentity } = effective;
  const results = useInfiniteQuery({
    queryKey: [
      "saved-view-run",
      user?.id,
      id,
      view?.updatedAt,
      definitionMatches ? "stored" : "url",
      runIdentity,
    ],
    enabled: canRun && !projectUnavailable && !projectPending,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      definitionMatches
        ? runSavedView({ id, cursor: pageParam })
        : runSavedViewUrlQuery({
            workspaceId: effective.workspaceId as string,
            filter: effective.filter,
            ...(effective.scope === "project" && project
              ? { projectSlug: project.slug }
              : {}),
            sort: effective.sort,
            dir: effective.dir,
            columns: effective.columns,
            cursor: pageParam,
          }),
    getNextPageParam: (last) =>
      last.hasMore ? (last.nextCursor ?? undefined) : undefined,
  });
  const countQuery = useQuery({
    queryKey: savedViewKeys.count(user?.id, id, view?.updatedAt),
    queryFn: () => countSavedView(id),
    enabled: Boolean(view && definitionMatches && storedQueryExecutable),
    staleTime: 30_000,
    retry: false,
  });

  const refreshViews = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: savedViewKeys.all }),
      queryClient.invalidateQueries({
        queryKey: savedViewKeys.detail(user?.id, id),
      }),
    ]);
  const pin = useMutation({
    mutationFn: () => toggleSavedViewPin(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: savedViewKeys.all }),
  });
  const save = useMutation({
    mutationFn: () =>
      updateSavedView({
        id,
        name: name.trim(),
        visibility,
        sharedWithTeamId: visibility === "team" ? teamAudienceId.trim() : null,
        // A view this screen cannot run keeps its stored layout and query untouched.
        ...(unsupported
          ? {}
          : {
              layout: isSavedViewLayout(effective.layout)
                ? effective.layout
                : undefined,
              query: savedViewQueryDocument(effective),
            }),
      }),
    onSuccess: async () => {
      await refreshViews();
      setIsEditing(false);
    },
  });
  const cloneLayout = isSavedViewLayout(effective.layout)
    ? effective.layout
    : undefined;
  const clone = useMutation({
    mutationFn: () =>
      createSavedView({
        workspaceId: effective.workspaceId as string,
        name: cloneSavedViewName(view?.name ?? t("sharedViewName")),
        scope: effective.scope === "project" ? "project" : "workspace",
        scopeId: effective.scopeId as string,
        visibility: "private",
        layout: cloneLayout ?? "list",
        query: savedViewQueryDocument(effective),
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: savedViewKeys.all });
      onOpenView(created.id, savedViewStoredSearch(created));
    },
  });

  const allItems = results.data?.pages.flatMap((page) => page.items) ?? [];
  const total = definitionMatches
    ? countQuery.data
    : results.data?.pages[0]?.total;
  const updateSearch = (changes: Partial<SavedViewUrlSearch>) =>
    onReplaceSearch({ ...effective, ...changes });
  const handleSortChange = (
    nextSort: WorkItemSortField,
    nextDir: WorkItemSortDirection,
  ) =>
    updateSearch({
      sort: nextSort === "position" ? "key" : nextSort,
      dir: nextDir,
    });
  const cancelEditing = () => {
    if (stored) onReplaceSearch(stored);
    setIsEditing(false);
    if (view) {
      setName(view.name);
      setTeamAudienceId(view.sharedWithTeamId ?? "");
      if (
        view.visibility === "private" ||
        view.visibility === "team" ||
        view.visibility === "workspace"
      )
        setVisibility(view.visibility);
    }
  };

  const title = view?.name ?? t("sharedViewName");
  const actionsBlocked = !effective.workspaceId || !effective.scopeId;
  const cloneBlocked =
    clone.isPending ||
    actionsBlocked ||
    !cloneLayout ||
    (view ? !storedQueryExecutable : !isFallback) ||
    !viewSettled;
  const showModifiedNotice =
    Boolean(view) && !definitionMatches && !unsupported && snapshotComplete;
  const queryEditable = !unsupported;

  return (
    <main className="flex min-h-full w-full flex-col gap-5 p-5 lg:p-8">
      <PageTitle title={title} />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl">{title}</h1>
          <p className="text-muted-foreground text-sm" role="status">
            {total === undefined
              ? canRun
                ? t("countLoading")
                : ""
              : t("count", { count: total })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {view ? (
            <Button
              variant="outline"
              disabled={pin.isPending}
              aria-pressed={isPinned}
              onClick={() => pin.mutate()}
            >
              {isPinned ? t("unpin") : t("pin")}
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={cloneBlocked}
            onClick={() => clone.mutate()}
          >
            {t("clone")}
          </Button>
          {view ? (
            <Button
              variant="outline"
              aria-pressed={isEditing}
              onClick={() => (isEditing ? cancelEditing() : setIsEditing(true))}
            >
              {isEditing ? t("cancelEdit") : t("edit")}
            </Button>
          ) : null}
          {isEditing ? (
            <Button
              disabled={
                save.isPending ||
                !name.trim() ||
                (visibility === "team" && !teamAudienceId.trim())
              }
              onClick={() => save.mutate()}
            >
              {t("save")}
            </Button>
          ) : null}
        </div>
      </header>
      {viewQuery.isLoading ? <p role="status">{t("loadingView")}</p> : null}
      {viewQuery.isError && !isFallback ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-destructive">
            {viewUnreadable ? t("viewUnavailable") : t("loadError")}
          </span>
          {viewUnreadable ? null : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void viewQuery.refetch()}
            >
              {t("retry")}
            </Button>
          )}
        </div>
      ) : null}
      {isFallback ? (
        <Alert variant="info" role="status" data-testid="saved-view-fallback">
          <AlertDescription>{t("sharedLinkNotice")}</AlertDescription>
        </Alert>
      ) : null}
      {showModifiedNotice ? (
        <Alert variant="info" role="status" data-testid="saved-view-modified">
          <AlertDescription>{t("modifiedNotice")}</AlertDescription>
        </Alert>
      ) : null}
      {projectUnavailable ? (
        <p role="alert" className="text-sm">
          {t("projectUnavailable")}
        </p>
      ) : null}
      {view && unsupported ? (
        <p
          role="alert"
          className="text-sm"
          data-testid="saved-view-unsupported"
        >
          {t("layoutUnavailable")}
        </p>
      ) : null}
      {!view && viewSettled && !layoutIsList && snapshotComplete ? (
        <p
          role="alert"
          className="text-sm"
          data-testid="saved-view-unsupported"
        >
          {t("layoutUnavailable")}
        </p>
      ) : null}
      {isEditing && view ? (
        <SavedViewEditor
          name={name}
          onNameChange={setName}
          visibility={visibility}
          teamId={teamAudienceId}
          onVisibilityChange={(value) => {
            setVisibility(value);
            if (value !== "team") setTeamAudienceId("");
          }}
          onTeamChange={setTeamAudienceId}
          canShare={canShare}
          canManageSettings={canManageSettings}
          currentVisibility={
            view.visibility === "private" ||
            view.visibility === "team" ||
            view.visibility === "workspace"
              ? view.visibility
              : undefined
          }
          teams={teamAudiences}
          query={
            queryEditable
              ? {
                  sort,
                  dir,
                  filter: effective.filter ?? "",
                  filterMode: search.filterMode ?? "visual",
                  columns: effective.columns,
                  onSortChange: (nextSort, nextDir) =>
                    updateSearch({ sort: nextSort, dir: nextDir }),
                  onFilterModeChange: (mode) =>
                    updateSearch({ filterMode: mode }),
                  onFilterApply: (filter) =>
                    updateSearch({ filter: filter || undefined }),
                  onColumnsChange: (columns) => updateSearch({ columns }),
                }
              : undefined
          }
        />
      ) : null}
      {canRun && !projectUnavailable ? (
        <WorkItemList
          workItems={allItems}
          hasPartialFailure={
            results.data?.pages.some((page) => page.hasPartialFailure) ?? false
          }
          isLoading={results.isLoading || projectPending}
          isError={results.isError}
          isFiltered
          sort={sort}
          dir={dir}
          onSortChange={handleSortChange}
          onRetry={() => void results.refetch()}
          columns={effective.columns}
        />
      ) : null}
      {results.hasNextPage ? (
        <Button
          variant="outline"
          disabled={results.isFetchingNextPage}
          onClick={() => void results.fetchNextPage()}
        >
          {results.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
        </Button>
      ) : null}
      {results.error instanceof HttpError &&
      [400, 403, 422].includes(results.error.status) ? (
        <p role="alert" className="text-destructive text-sm">
          {`${results.error.status}: ${results.error.message}`}
        </p>
      ) : null}
      {save.isError || pin.isError || clone.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {[save.error, pin.error, clone.error].some(
            (error) => error instanceof HttpError && error.status === 403,
          )
            ? t("forbidden")
            : t("saveError")}
        </p>
      ) : null}
    </main>
  );
}
