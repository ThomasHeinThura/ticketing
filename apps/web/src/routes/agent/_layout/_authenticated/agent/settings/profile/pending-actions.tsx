import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { Badge, Button, Card, CardContent, Skeleton } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  cancelOwnPendingAction,
  getOwnPendingActions,
} from "@/fetchers/pending-actions";
import { parsePendingActionsSearch, routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/profile/pending-actions",
)({
  validateSearch: parsePendingActionsSearch,
  component: PendingActionsRoute,
});

function PendingActionsRoute() {
  const location = useLocation();
  if (location.pathname.startsWith(`${routes.pendingActions.path}/`)) {
    return <Outlet />;
  }
  return <PendingActionsList />;
}

function PendingActionsList() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const pendingActions = useQuery({
    queryKey: ["me", "pending-actions", search.cursor ?? null],
    queryFn: () => getOwnPendingActions(search.cursor),
    staleTime: 0,
  });
  const cancel = useMutation({
    mutationFn: cancelOwnPendingAction,
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["me", "pending-actions"] }),
  });
  const page = pendingActions.data;

  return (
    <main className="flex min-h-full flex-col gap-5 p-5 lg:p-8">
      <PageTitle title={t("pendingActions:copy.8008829bb5ed")} />
      <header>
        <h1 className="text-2xl font-semibold">
          {t("pendingActions:copy.8008829bb5ed")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("pendingActions:copy.eeab44be9789")}
        </p>
      </header>
      {pendingActions.isLoading ? (
        <div
          className="space-y-3"
          role="status"
          aria-label={t("pendingActions:copy.f6f50d54eb36")}
        >
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : pendingActions.isError || !page ? (
        <p role="alert" className="text-sm text-destructive">
          {t("pendingActions:copy.3ccd9fbc7f89")}
        </p>
      ) : page.data.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            {t("pendingActions:copy.68f8856d348a")}
          </CardContent>
        </Card>
      ) : (
        <section
          aria-label={t("pendingActions:copy.bc2597b55c34")}
          className="grid gap-3"
        >
          {page.data.map((item) => {
            const email =
              typeof item.summary.email === "string"
                ? item.summary.email
                : null;
            return (
              <Card key={item.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium">
                        {item.action === "user_deactivation"
                          ? t("pendingActions:dynamic.deactivatePerson", {
                              email: email ? ` · ${email}` : "",
                            })
                          : t("pendingActions:dynamic.genericAction", {
                              action: item.action.replaceAll("_", " "),
                              targetType: item.targetType,
                            })}
                      </h2>
                      <Badge variant="outline">{item.origin}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Expires{" "}
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(item.expiresAt))}
                    </p>
                    {item.action === "user_deactivation" && (
                      <p className="text-sm text-muted-foreground">
                        {t("pendingActions:copy.b7bd2b2fc798")}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      render={
                        <Link
                          to={
                            routes.pendingAction.build({ id: item.id }) as never
                          }
                        />
                      }
                    >
                      {t("pendingActions:review")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(item.id)}
                    >
                      {t("pendingActions:copy.77dfd2135f4d")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}
      {page?.page.hasMore && page.page.nextCursor && (
        <nav
          aria-label={t("pendingActions:copy.8a1657ab9e97")}
          className="flex justify-end"
        >
          <Button
            variant="outline"
            onClick={() =>
              void navigate({
                search: { cursor: page.page.nextCursor ?? undefined },
              })
            }
          >
            {t("pendingActions:copy.4bfc194b68a3")}
          </Button>
        </nav>
      )}
      {cancel.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("pendingActions:copy.3b04d7a51cb2")}
        </p>
      )}
    </main>
  );
}
