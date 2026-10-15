import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { identityAdminFailureKind } from "@/fetchers/god-mode/identity-admin-error";
import { useIdentityConnections } from "@/hooks/queries/god-mode/use-identity-connections";
import { routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/god-mode/authentication",
)({ component: IdentityConnectionsRoute });

function IdentityConnectionsRoute() {
  const { t } = useTranslation("identityConnections");
  const location = useLocation();
  const connections = useIdentityConnections();

  if (location.pathname.startsWith(`${routes.identityConnections.path}/`))
    return <Outlet />;

  const kind = connections.isError
    ? identityAdminFailureKind(connections.error)
    : null;

  return (
    <>
      <PageTitle title={t("list.title")} />
      <main className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{t("list.title")}</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {t("list.description")}
            </p>
          </div>
          {connections.isSuccess ? (
            <Button
              render={
                <Link
                  params={{ id: "new" }}
                  to="/agent/god-mode/authentication/$id"
                />
              }
            >
              {t("list.add")}
            </Button>
          ) : null}
        </header>

        {connections.isPending ? (
          <div
            aria-label={t("list.loading")}
            className="space-y-3"
            role="status"
          >
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : null}

        {connections.isError ? (
          <Alert variant="error">
            <AlertTitle>
              {kind === "denied"
                ? t("list.deniedTitle")
                : t("list.unavailable")}
            </AlertTitle>
            <AlertDescription>
              <p>
                {kind === "denied"
                  ? t("errors.denied")
                  : kind === "unavailable"
                    ? t("list.storedInvalid")
                    : t("list.loadFailed")}
              </p>
              {kind !== "denied" ? (
                <Button
                  onClick={() => void connections.refetch()}
                  type="button"
                  variant="outline"
                >
                  {t("common.retry")}
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {connections.isSuccess && connections.data.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("list.emptyTitle")}</EmptyTitle>
              <EmptyDescription>{t("list.empty")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {connections.isSuccess && connections.data.length > 0 ? (
          <section aria-label={t("list.configured")} className="grid gap-3">
            {connections.data.map((connection) => {
              const staff = connection.portalScope === "agent";
              return (
                <Card key={connection.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                    <div className="min-w-0 space-y-1">
                      <h2 className="font-medium">{connection.displayName}</h2>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>{t("list.provider")}</span>
                        <Badge variant="outline">
                          {staff
                            ? t("list.staffPortal")
                            : t("list.customerPortal")}
                        </Badge>
                        <Badge
                          variant={connection.enabled ? "success" : "outline"}
                        >
                          {connection.enabled
                            ? t("list.enabled")
                            : t("list.disabled")}
                        </Badge>
                        {connection.healthState === "invalid" ? (
                          <Badge variant="error">
                            {t("list.healthInvalid")}
                          </Badge>
                        ) : null}
                      </div>
                      {staff ? null : (
                        <p className="text-sm text-muted-foreground">
                          {t("list.customerManaged")}
                        </p>
                      )}
                    </div>
                    <Button
                      render={
                        <Link
                          params={{ id: connection.id }}
                          to="/agent/god-mode/authentication/$id"
                        />
                      }
                      variant="outline"
                    >
                      {staff ? t("list.manage") : t("list.view")}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </section>
        ) : null}
      </main>
    </>
  );
}
