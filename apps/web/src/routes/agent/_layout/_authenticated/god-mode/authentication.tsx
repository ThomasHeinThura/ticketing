import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { apiFetch } from "@taskdesk/libs";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Skeleton,
} from "@taskdesk/ui";
import { useCallback, useEffect, useState } from "react";
import PageTitle from "@/components/page-title";
import { getApiUrl } from "@/fetchers/get-api-url";
import { routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/god-mode/authentication",
)({ component: IdentityConnectionsRoute });

type IdentityConnection = {
  id: string;
  providerType: "entra";
  portalScope: "agent" | "customer";
  organisationId: string | null;
  displayName: string;
  enabled: boolean;
  configVersion: number;
};
type ConnectionList = { data: IdentityConnection[] };

function IdentityConnectionsRoute() {
  const location = useLocation();
  const isDetailRoute = location.pathname.startsWith(
    `${routes.identityConnections.path}/`,
  );
  const [connections, setConnections] = useState<IdentityConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await apiFetch(
        getApiUrl("instance/identity-connections"),
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) throw new Error("Unavailable");
      const body = (await response.json()) as ConnectionList;
      setConnections(body.data);
    } catch {
      setError(true);
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isDetailRoute) return;
    void refresh();
  }, [isDetailRoute, refresh]);

  if (isDetailRoute) return <Outlet />;

  return (
    <>
      <PageTitle title="Identity connections" />
      <main className="mx-auto flex h-full max-w-5xl flex-col gap-6 overflow-y-auto p-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">Identity connections</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Configure Microsoft Entra sign-in, review safe connection metadata,
            and manage the associated SCIM settings.
          </p>
          <Button render={<a href={routes.identityConnectionCreate.build()} />}>
            Add identity connection
          </Button>
        </header>

        {error ? (
          <Alert variant="error">
            <AlertTitle>Identity connections unavailable</AlertTitle>
            <AlertDescription>
              The list could not be loaded. Your session may not have instance
              administrator access.
              <Button onClick={() => void refresh()}>Retry</Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <div
            className="space-y-3"
            role="status"
            aria-label="Loading identity connections"
          >
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : connections.length ? (
          <section
            aria-label="Configured identity connections"
            className="grid gap-3"
          >
            {connections.map((connection) => (
              <Card key={connection.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                  <div className="space-y-1">
                    <h2 className="font-medium">{connection.displayName}</h2>
                    <p className="text-sm text-muted-foreground">
                      Microsoft Entra ·{" "}
                      {connection.portalScope === "agent"
                        ? "Staff portal"
                        : "Customer portal"}
                      {connection.organisationId ? " · Organisation-bound" : ""}
                      {connection.enabled ? " · Enabled" : " · Disabled"}
                    </p>
                  </div>
                  <Button
                    render={
                      <a
                        href={routes.identityConnectionSettings.build({
                          id: connection.id,
                        })}
                      />
                    }
                    variant="outline"
                  >
                    Manage settings
                  </Button>
                </CardContent>
              </Card>
            ))}
          </section>
        ) : !error ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              No identity connections are configured.
            </CardContent>
          </Card>
        ) : null}
      </main>
    </>
  );
}
