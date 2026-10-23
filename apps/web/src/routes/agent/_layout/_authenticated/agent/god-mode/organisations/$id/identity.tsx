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
import { useOrganisationIdentityConnection } from "@/hooks/queries/god-mode/use-identity-connections";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";
import {
  type IdentityConnectionEditorSearch,
  type IdentityConnectionTab,
  parseIdentityConnectionEditorSearch,
} from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/god-mode/organisations/$id/identity",
)({
  validateSearch: parseIdentityConnectionEditorSearch,
  component: OrganisationIdentityRoute,
});

/**
 * God Mode, organisation "Identity" tab (CP-17, IP-5): the customer organisation's own Entra
 * connection and its SCIM provisioning. It composes the same editor, SCIM and history panels as
 * the instance authentication provider screen; only the binding (one organisation, customer
 * portal) differs. Customers cannot reach it: instance administrators configure it.
 */
function OrganisationIdentityRoute() {
  const { t } = useTranslation("identityConnections");
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const isAdmin = useInstanceAdminSignal();
  const query = useOrganisationIdentityConnection(id, isAdmin);

  const tab: IdentityConnectionTab = search.tab ?? "connection";
  const go = (next: IdentityConnectionEditorSearch) =>
    void navigate({ search: () => next });

  const back = (
    <Button
      render={<Link to="/agent/god-mode/authentication" />}
      variant="outline"
    >
      {t("organisation.back")}
    </Button>
  );

  if (!isAdmin)
    return (
      <>
        <PageTitle title={t("organisation.title")} />
        <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
          <div>{back}</div>
          <IdentityAccessDenied />
        </div>
      </>
    );

  const connection = query.data ?? null;
  const kind = query.isError ? identityAdminFailureKind(query.error) : null;

  return (
    <>
      <PageTitle title={connection?.displayName ?? t("organisation.title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div>{back}</div>
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">{t("organisation.title")}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t("organisation.description")}
          </p>
        </header>

        {query.isPending ? (
          <div
            aria-label={t("organisation.loading")}
            className="space-y-3"
            role="status"
          >
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : null}

        {query.isError ? (
          <Alert variant={kind === "not_found" ? "warning" : "error"}>
            <AlertTitle>
              {kind === "denied"
                ? t("list.deniedTitle")
                : kind === "not_found"
                  ? t("organisation.notFoundTitle")
                  : t("organisation.unavailable")}
            </AlertTitle>
            <AlertDescription>
              <p>
                {kind === "denied"
                  ? t("errors.denied")
                  : kind === "not_found"
                    ? t("errors.not_found")
                    : kind === "unavailable"
                      ? t("list.storedInvalid")
                      : t("organisation.loadFailed")}
              </p>
              {kind !== "denied" && kind !== "not_found" ? (
                <Button
                  onClick={() => void query.refetch()}
                  type="button"
                  variant="outline"
                >
                  {t("common.retry")}
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {query.isSuccess && !connection ? (
          <IdentityConnectionEditor
            connection={null}
            customerOrganisationId={id}
            onReload={() => void query.refetch()}
          />
        ) : null}

        {connection ? (
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
                onReload={() => void query.refetch()}
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
        ) : null}
      </div>
    </>
  );
}
