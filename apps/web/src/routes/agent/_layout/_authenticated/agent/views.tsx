import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { Button, Card, CardContent, Input, Skeleton } from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { SavedViewAudienceFields } from "@/components/saved-view/saved-view-audience-fields";
import {
  countSavedView,
  createSavedView,
  getSavedViews,
  getShareableViewTeams,
  requestSavedViewDeletion,
  type SavedView,
  type SavedViewVisibility,
  toggleSavedViewPin,
} from "@/fetchers/saved-views";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import { parseSavedViewsSearch, routes } from "@/lib/routes";
import { savedViewKeys } from "@/lib/saved-view-keys";
import {
  cloneSavedViewName,
  isSavedViewLayout,
  savedViewStoredSearch,
} from "@/lib/saved-view-query";

/**
 * `docs/02-design/screen-inventory.md` "Saved views index" (`/agent/views`), and the layout
 * of the saved-view detail route below it (`SV-14`..`SV-21`). Team-lead editing and automatic
 * ownership transfer are held for a later release (decision log 2026-10-11); editing and
 * deleting another person's view stay with its owner and workspace managers, which only the
 * server can decide, so a refusal is shown rather than predicted.
 */
export const Route = createFileRoute("/_layout/_authenticated/agent/views")({
  validateSearch: parseSavedViewsSearch,
  component: SavedViewsRoute,
});

function SavedViewsRoute() {
  const location = useLocation();
  return location.pathname.startsWith(`${routes.savedViews.path}/`) ? (
    <Outlet />
  ) : (
    <SavedViewsIndexRoute />
  );
}

function SavedViewsIndexRoute() {
  const { t } = useTranslation("savedViews");
  const { user } = useAuth();
  const { data: workspace, isLoading: isWorkspaceLoading } =
    useActiveWorkspace();
  const permissions = useWorkspacePermission();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newVisibility, setNewVisibility] =
    useState<SavedViewVisibility>("private");
  const [newTeamId, setNewTeamId] = useState("");
  const navigate = useNavigate({ from: Route.fullPath });
  const { query } = Route.useSearch();
  const workspaceId = workspace?.id;
  const views = useQuery({
    queryKey: savedViewKeys.list(workspaceId, user?.id),
    queryFn: () => getSavedViews(workspaceId ?? ""),
    enabled: Boolean(workspaceId && user?.id),
  });
  const teamAudiences = useQuery({
    queryKey: savedViewKeys.teamAudiences(workspaceId, user?.id),
    queryFn: () => getShareableViewTeams(workspaceId ?? ""),
    enabled: Boolean(
      workspaceId &&
        user?.id &&
        permissions.canShareSavedViews() &&
        newVisibility === "team",
    ),
  });
  const refreshViews = () =>
    queryClient.invalidateQueries({ queryKey: savedViewKeys.all });
  const create = useMutation({
    mutationFn: () =>
      createSavedView({
        workspaceId: workspaceId ?? "",
        name: newName.trim(),
        scope: "workspace",
        scopeId: workspaceId ?? "",
        visibility: newVisibility,
        ...(newVisibility === "team" && newTeamId.trim()
          ? { sharedWithTeamId: newTeamId.trim() }
          : {}),
        layout: "list",
        query: { entity: "work_item" },
      }),
    onSuccess: async (view) => {
      setNewName("");
      setNewVisibility("private");
      setNewTeamId("");
      await refreshViews();
      await navigate({
        to: routes.savedView.path,
        params: { id: view.id },
        search: savedViewStoredSearch(view),
      });
    },
  });
  const duplicate = useMutation({
    mutationFn: (view: SavedView) =>
      createSavedView({
        workspaceId: view.workspaceId,
        name: cloneSavedViewName(view.name),
        scope: view.scope === "project" ? "project" : "workspace",
        scopeId: view.scopeId,
        visibility: "private",
        layout: isSavedViewLayout(view.layout) ? view.layout : "list",
        query:
          view.query && typeof view.query === "object"
            ? (view.query as Record<string, unknown>)
            : { entity: "work_item" },
      }),
    onSuccess: async (view) => {
      await refreshViews();
      await navigate({
        to: routes.savedView.path,
        params: { id: view.id },
        search: savedViewStoredSearch(view),
      });
    },
  });
  const pin = useMutation({
    mutationFn: toggleSavedViewPin,
    onSuccess: refreshViews,
  });
  const deletion = useMutation({
    mutationFn: requestSavedViewDeletion,
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["me", "pending-actions"] }),
  });

  const visibleViews = (views.data ?? []).filter((view) =>
    view.name.toLocaleLowerCase().includes(query?.toLocaleLowerCase() ?? ""),
  );
  const counts = useQueries({
    queries: visibleViews.map((view) => ({
      queryKey: savedViewKeys.count(user?.id, view.id, view.updatedAt),
      queryFn: () => countSavedView(view.id),
      staleTime: 30_000,
      // A view the server cannot execute answers 422; its count is simply not shown.
      retry: false,
    })),
  });

  const visibilityLabel = (visibility: string) =>
    visibility === "private" ||
    visibility === "team" ||
    visibility === "workspace"
      ? t(`visibility.${visibility}`)
      : visibility;
  const pendingDelete =
    deletion.isPending && typeof deletion.variables === "string"
      ? deletion.variables
      : undefined;

  return (
    <main className="flex min-h-full w-full flex-col gap-5 p-5 lg:p-8">
      <PageTitle title={t("title")} />
      <header className="space-y-1">
        <h1 className="font-semibold text-2xl">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </header>
      <Input
        aria-label={t("search")}
        placeholder={t("search")}
        value={query ?? ""}
        onChange={(event) =>
          void navigate({
            search: { query: event.target.value || undefined },
            replace: true,
          })
        }
      />
      <form
        className="flex flex-wrap items-end gap-2"
        aria-label={t("createForm")}
        onSubmit={(event) => {
          event.preventDefault();
          if (
            newName.trim() &&
            (newVisibility !== "team" || newTeamId.trim()) &&
            !create.isPending
          ) {
            create.mutate();
          }
        }}
      >
        <Input
          aria-label={t("name")}
          placeholder={t("name")}
          maxLength={200}
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <SavedViewAudienceFields
          visibility={newVisibility}
          teamId={newTeamId}
          onVisibilityChange={(value) => {
            setNewVisibility(value);
            if (value !== "team") setNewTeamId("");
          }}
          onTeamChange={setNewTeamId}
          canShare={permissions.canShareSavedViews()}
          canManageSettings={permissions.canManageWorkspaceSettings()}
          teams={teamAudiences}
        />
        <Button
          type="submit"
          disabled={
            !workspaceId ||
            permissions.isCheckingPermissions ||
            !newName.trim() ||
            (newVisibility === "team" && !newTeamId.trim()) ||
            create.isPending
          }
        >
          {create.isPending ? t("creating") : t("create")}
        </Button>
      </form>
      {create.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {create.error instanceof HttpError && create.error.status === 403
            ? t("createForbidden")
            : t("createError")}
        </p>
      ) : null}
      {isWorkspaceLoading || views.isLoading ? (
        <div className="space-y-3" role="status" aria-label={t("loading")}>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : views.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-destructive">{t("loadError")}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void views.refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : visibleViews.length ? (
        <section className="grid gap-3" aria-label={t("title")}>
          {visibleViews.map((view, index) => {
            const count = counts[index]?.data;
            return (
              <Card key={view.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div className="space-y-1">
                    <h2 className="font-medium">
                      {/* The link carries the whole definition (SV-19), so what is copied
                          from here can be shared with someone who cannot open the view. */}
                      <Link
                        to={routes.savedView.path}
                        params={{ id: view.id }}
                        search={savedViewStoredSearch(view)}
                      >
                        {view.name}
                      </Link>
                    </h2>
                    <p className="text-muted-foreground text-sm">
                      {view.isPinned ? `${t("pinned")} · ` : ""}
                      {t("summary", {
                        visibility: visibilityLabel(view.visibility),
                      })}
                      {count === undefined ? "" : ` · ${t("count", { count })}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      aria-label={
                        view.isPinned
                          ? t("unpinNamed", { name: view.name })
                          : t("pinNamed", { name: view.name })
                      }
                      disabled={pin.isPending}
                      onClick={() => pin.mutate(view.id)}
                    >
                      {view.isPinned ? t("unpin") : t("pin")}
                    </Button>
                    <Button
                      variant="outline"
                      aria-label={t("duplicateNamed", { name: view.name })}
                      disabled={duplicate.isPending}
                      onClick={() => duplicate.mutate(view)}
                    >
                      {t("duplicate")}
                    </Button>
                    <Button
                      variant="outline"
                      aria-label={t("requestDeleteNamed", { name: view.name })}
                      disabled={deletion.isPending}
                      onClick={async () => {
                        try {
                          const result = await deletion.mutateAsync(view.id);
                          void navigate({
                            to: routes.pendingAction.path,
                            params: { id: result.pendingActionId },
                          });
                        } catch {
                          // The inline error below keeps the list and its URL intact.
                        }
                      }}
                    >
                      {pendingDelete === view.id
                        ? t("requesting")
                        : t("requestDelete")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      ) : (
        <Card>
          <CardContent className="py-8 text-muted-foreground text-sm">
            {query ? t("emptySearch") : t("empty")}
          </CardContent>
        </Card>
      )}
      {pin.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {t("pinError")}
        </p>
      ) : null}
      {duplicate.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {t("duplicateError")}
        </p>
      ) : null}
      {deletion.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {deletion.error instanceof HttpError && deletion.error.status === 403
            ? t("deleteForbidden")
            : deletion.error instanceof HttpError &&
                deletion.error.status === 409
              ? t("deleteAlreadyRequested")
              : t("deleteError")}
        </p>
      ) : null}
    </main>
  );
}
