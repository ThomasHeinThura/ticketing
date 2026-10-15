import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Skeleton,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { IdentityAccessDenied } from "@/components/god-mode/identity-access-denied";
import { IdentityConnectionEditor } from "@/components/god-mode/identity-connection-editor";
import { IdentityConnectionEvents } from "@/components/god-mode/identity-connection-events";
import { ScimPanel } from "@/components/god-mode/scim-panel";
import PageTitle from "@/components/page-title";
import { identityAdminFailureKind } from "@/fetchers/god-mode/identity-admin-error";
import { useIdentityConnections } from "@/hooks/queries/god-mode/use-identity-connections";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";
import {
  type IdentityConnectionEditorSearch,
  type IdentityConnectionTab,
  parseIdentityConnectionEditorSearch,
  routes,
} from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/god-mode/authentication/$id",
)({
  validateSearch: parseIdentityConnectionEditorSearch,
  component: IdentityConnectionEditorRoute,
});

function BackLink() {
  const { t } = useTranslation("identityConnections");
  return (
    <Button
      render={<Link to="/agent/god-mode/authentication" />}
      variant="outline"
    >
      {t("detail.back")}
    </Button>
  );
}

function IdentityConnectionEditorRoute() {
  const { t } = useTranslation("identityConnections");
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const creating = id === "new";
  const isAdmin = useInstanceAdminSignal();
  const connections = useIdentityConnections(!creating && isAdmin);

  const tab: IdentityConnectionTab = search.tab ?? "connection";
  const go = (next: IdentityConnectionEditorSearch, replace = false) =>
    void navigate({ search: () => next, replace });

  if (!isAdmin)
    return (
      <>
        <PageTitle title={t("detail.title")} />
        <main className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
          <div>
            <BackLink />
          </div>
          <IdentityAccessDenied />
        </main>
      </>
    );

  if (creating) {
    return (
      <>
        <PageTitle title={t("detail.createTitle")} />
        <main className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
          <div>
            <BackLink />
          </div>
          <h1 className="text-2xl font-semibold">{t("detail.createTitle")}</h1>
          <IdentityConnectionEditor
            connection={null}
            onCreated={(createdId) =>
              void navigate({
                to: routes.identityConnectionEditor.path,
                params: { id: createdId },
                search: {},
              })
            }
            onReload={() => {}}
          />
        </main>
      </>
    );
  }

  const connection = connections.data?.find((item) => item.id === id);
  const kind = connections.isError
    ? identityAdminFailureKind(connections.error)
    : null;

  return (
    <>
      <PageTitle title={connection?.displayName ?? t("detail.title")} />
      <main className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div>
          <BackLink />
        </div>

        {connections.isPending ? (
          <div
            aria-label={t("detail.loading")}
            className="space-y-3"
            role="status"
          >
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : null}

        {connections.isError ? (
          <Alert variant="error">
            <AlertTitle>
              {kind === "denied"
                ? t("list.deniedTitle")
                : t("detail.unavailable")}
            </AlertTitle>
            <AlertDescription>
              <p>
                {kind === "denied"
                  ? t("errors.denied")
                  : t("detail.loadFailed")}
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

        {connections.isSuccess && !connection ? (
          <Alert variant="warning">
            <AlertTitle>{t("detail.notFoundTitle")}</AlertTitle>
            <AlertDescription>
              <p>{t("errors.not_found")}</p>
              <Button
                onClick={() => void connections.refetch()}
                type="button"
                variant="outline"
              >
                {t("common.reload")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {connection && connection.portalScope === "customer" ? (
          <>
            <h1 className="text-2xl font-semibold">{connection.displayName}</h1>
            <Alert variant="info">
              <AlertTitle>{t("detail.customerTitle")}</AlertTitle>
              <AlertDescription>{t("detail.customerManaged")}</AlertDescription>
            </Alert>
          </>
        ) : null}

        {connection && connection.portalScope === "agent" ? (
          <>
            <h1 className="text-2xl font-semibold">{connection.displayName}</h1>
            <Tabs
              onValueChange={(value) => {
                if (value === "scim") go({ tab: "scim" });
                else if (value === "events") go({ tab: "events" });
                else go({});
              }}
              value={tab}
            >
              <TabsList variant="underline">
                <TabsTab value="connection">
                  {t("detail.tabs.connection")}
                </TabsTab>
                <TabsTab value="scim">{t("detail.tabs.scim")}</TabsTab>
                <TabsTab value="events">{t("detail.tabs.events")}</TabsTab>
              </TabsList>
              <TabsPanel value="connection">
                <IdentityConnectionEditor
                  connection={connection}
                  onReload={() => void connections.refetch()}
                />
              </TabsPanel>
              <TabsPanel value="scim">
                <ScimPanel
                  connectionId={connection.id}
                  onOpenMapping={(mapping) =>
                    go({ tab: "scim", ...(mapping ? { mapping } : {}) })
                  }
                  openMapping={search.mapping}
                />
              </TabsPanel>
              <TabsPanel value="events">
                <IdentityConnectionEvents
                  connectionId={connection.id}
                  cursor={search.eventsCursor}
                  onCursorChange={(cursor) =>
                    go({
                      tab: "events",
                      ...(cursor ? { eventsCursor: cursor } : {}),
                    })
                  }
                />
              </TabsPanel>
            </Tabs>
          </>
        ) : null}
      </main>
    </>
  );
}
