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
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
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
  Skeleton,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import {
  countSavedView,
  createSavedView,
  getSavedViews,
  requestSavedViewDeletion,
  toggleSavedViewPin,
} from "@/fetchers/saved-views";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { parseSavedViewsSearch, routes } from "@/lib/routes";

export const Route = createFileRoute("/_layout/_authenticated/agent/views")({
  validateSearch: parseSavedViewsSearch,
  component: SavedViewsRoute,
});

function SavedViewsRoute() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  return pathname.startsWith(`${routes.savedViews.path}/`) ? (
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
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newVisibility, setNewVisibility] = useState<
    "private" | "team" | "workspace"
  >("private");
  const [newTeamId, setNewTeamId] = useState("");
  const navigate = useNavigate({ from: Route.fullPath });
  const { query } = Route.useSearch();
  const views = useQuery({
    queryKey: ["saved-views", workspace?.id, user?.id],
    queryFn: () => getSavedViews(workspace?.id ?? ""),
    enabled: Boolean(workspace?.id),
  });
  const deletion = useMutation({
    mutationFn: requestSavedViewDeletion,
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["me", "pending-actions"] }),
  });
  const create = useMutation({
    mutationFn: () =>
      createSavedView({
        workspaceId: workspace?.id ?? "",
        name: newName.trim(),
        scope: "workspace",
        scopeId: workspace?.id ?? "",
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
      await queryClient.invalidateQueries({ queryKey: ["saved-views"] });
      await navigate({ to: routes.savedView.path, params: { id: view.id } });
    },
  });
  const pin = useMutation({
    mutationFn: toggleSavedViewPin,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["saved-views"] }),
  });

  const visibleViews = (views.data ?? []).filter((view) =>
    view.name.toLocaleLowerCase().includes(query?.toLocaleLowerCase() ?? ""),
  );
  const counts = useQueries({
    queries: visibleViews.map((view) => ({
      queryKey: ["saved-view-count", user?.id, view.id, view.updatedAt],
      queryFn: () => countSavedView(view.id),
      staleTime: 30_000,
    })),
  });

  return (
    <main className="flex min-h-full flex-col gap-5 p-5 lg:p-8">
      <PageTitle title={t("title")} />
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
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
        onSubmit={(event) => {
          event.preventDefault();
          if (
            newName.trim() &&
            (newVisibility !== "team" || newTeamId.trim())
          ) {
            create.mutate();
          }
        }}
      >
        <Input
          aria-label={t("name")}
          placeholder={t("name")}
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <div className="grid gap-1 text-sm">
          {t("visibility", { visibility: "" })}
          <Select
            value={newVisibility}
            onValueChange={(value) => {
              if (
                value === "private" ||
                value === "team" ||
                value === "workspace"
              ) {
                setNewVisibility(value);
                if (value !== "team") setNewTeamId("");
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
        {newVisibility === "team" ? (
          <Input
            aria-label={t("visibility", { visibility: "team audience ID" })}
            placeholder={t("visibility", { visibility: "team audience ID" })}
            value={newTeamId}
            onChange={(event) => setNewTeamId(event.target.value)}
          />
        ) : null}
        <Button
          disabled={
            !workspace?.id ||
            !newName.trim() ||
            (newVisibility === "team" && !newTeamId.trim()) ||
            create.isPending
          }
        >
          {create.isPending ? t("creating") : t("create")}
        </Button>
      </form>
      {create.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("createError")}
        </p>
      )}
      {isWorkspaceLoading || views.isLoading ? (
        <div className="space-y-3" role="status" aria-label={t("title")}>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : views.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("loadError")}
        </p>
      ) : visibleViews.length ? (
        <section className="grid gap-3" aria-label={t("title")}>
          {visibleViews.map((view, index) => (
            <Card key={view.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div className="space-y-1">
                  <h2 className="font-medium">
                    <Link to={routes.savedView.path} params={{ id: view.id }}>
                      {view.name}
                    </Link>
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {view.isPinned
                      ? t("pinned")
                      : t("visibility", { visibility: view.visibility })}
                    {counts[index]?.data === undefined
                      ? ""
                      : ` · ${t("count", { count: counts[index]?.data })}`}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={pin.isPending}
                  onClick={() => pin.mutate(view.id)}
                >
                  {view.isPinned ? t("unpin") : t("pin")}
                </Button>
                <Button
                  variant="outline"
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
                  {deletion.isPending ? t("requesting") : t("requestDelete")}
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            {t("empty")}
          </CardContent>
        </Card>
      )}
      {deletion.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("deleteError")}
        </p>
      )}
      {deletion.isSuccess && (
        <p role="status" className="text-sm">
          {t("requestCreated")}{" "}
          <Link to={routes.pendingActions.path as never}>
            {t("pendingActions:copy.8008829bb5ed")}
          </Link>
        </p>
      )}
    </main>
  );
}
