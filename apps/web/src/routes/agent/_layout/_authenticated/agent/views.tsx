import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button, Card, CardContent, Input, Skeleton } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  getSavedViews,
  requestSavedViewDeletion,
} from "@/fetchers/saved-views";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { parseSavedViewsSearch, routes } from "@/lib/routes";

export const Route = createFileRoute("/_layout/_authenticated/agent/views")({
  validateSearch: parseSavedViewsSearch,
  component: SavedViewsRoute,
});

function SavedViewsRoute() {
  const { t } = useTranslation("savedViews");
  const { data: workspace, isLoading: isWorkspaceLoading } =
    useActiveWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const { query } = Route.useSearch();
  const views = useQuery({
    queryKey: ["saved-views", workspace?.id],
    queryFn: () => getSavedViews(workspace?.id ?? ""),
    enabled: Boolean(workspace?.id),
  });
  const deletion = useMutation({
    mutationFn: requestSavedViewDeletion,
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["me", "pending-actions"] }),
  });

  const visibleViews = (views.data ?? []).filter((view) =>
    view.name.toLocaleLowerCase().includes(query?.toLocaleLowerCase() ?? ""),
  );

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
          {visibleViews.map((view) => (
            <Card key={view.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div className="space-y-1">
                  <h2 className="font-medium">{view.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {view.isPinned
                      ? t("pinned")
                      : t("visibility", { visibility: view.visibility })}
                  </p>
                </div>
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
