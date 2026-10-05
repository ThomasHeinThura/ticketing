import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { Badge, Button, Card, CardContent, Skeleton } from "@taskdesk/ui";
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
      <PageTitle title="My pending actions" />
      <header>
        <h1 className="text-2xl font-semibold">My pending actions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review requests made by your account. Each action expires after its
          listed time.
        </p>
      </header>
      {pendingActions.isLoading ? (
        <div
          className="space-y-3"
          role="status"
          aria-label="Loading pending actions"
        >
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : pendingActions.isError || !page ? (
        <p role="alert" className="text-sm text-destructive">
          Pending actions could not be loaded. Refresh the page to try again.
        </p>
      ) : page.data.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            You have no pending actions.
          </CardContent>
        </Card>
      ) : (
        <section aria-label="Pending actions" className="grid gap-3">
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
                          ? `Deactivate person${email ? ` · ${email}` : ""}`
                          : `${item.action.replaceAll("_", " ")} · ${item.targetType}`}
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
                        Requires the exact current email and fresh
                        authentication.
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Link
                      className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium"
                      to={routes.pendingAction.build({ id: item.id }) as never}
                    >
                      Review
                    </Link>
                    <Button
                      variant="outline"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(item.id)}
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}
      {page?.page.hasMore && page.page.nextCursor && (
        <nav aria-label="Pending action pages" className="flex justify-end">
          <Button
            variant="outline"
            onClick={() =>
              void navigate({
                search: { cursor: page.page.nextCursor ?? undefined },
              })
            }
          >
            Next page
          </Button>
        </nav>
      )}
      {cancel.isError && (
        <p role="alert" className="text-sm text-destructive">
          This action could not be cancelled. Refresh and check its current
          state.
        </p>
      )}
    </main>
  );
}
