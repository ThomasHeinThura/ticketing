import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { SlaPolicySummaryCard } from "@/components/sla-policy/sla-policy-summary-card";
import { useSlaPolicies } from "@/hooks/queries/sla-policy/use-sla-policies";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { parseSlaPolicyListSearch, routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/sla-policies",
)({
  validateSearch: parseSlaPolicyListSearch,
  component: SlaPoliciesRoute,
});

function SlaPoliciesRoute() {
  const { t } = useTranslation("slaPolicies");
  const location = useLocation();
  const navigate = useNavigate({ from: Route.fullPath });
  const { cursor } = Route.useSearch();
  const { data: workspace, isLoading: isWorkspaceLoading } =
    useActiveWorkspace();
  const {
    data: policies,
    isLoading,
    isError,
    refetch,
  } = useSlaPolicies(workspace?.id ?? "", cursor);
  const { canManageServiceCalendars, isCheckingPermissions } =
    useWorkspacePermission(workspace?.id ?? null);
  const canManage = canManageServiceCalendars();

  if (location.pathname.startsWith(`${routes.slaPolicies.path}/`)) {
    return <Outlet />;
  }

  const loading = isWorkspaceLoading || isLoading;
  const resetToFirstPage = () =>
    void navigate({
      to: routes.slaPolicies.path,
      search: { cursor: undefined },
    });

  return (
    <>
      <PageTitle title={t("list.title")} />
      <main className="flex h-full flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{t("list.title")}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("list.description")}
            </p>
          </div>
          {canManage && !isCheckingPermissions ? (
            <Button
              render={
                <Link to={routes.slaPolicyEditor.path} params={{ id: "new" }} />
              }
              disabled={!workspace}
            >
              <Plus aria-hidden="true" />
              {t("list.new")}
            </Button>
          ) : null}
        </div>

        {!canManage && !isCheckingPermissions ? (
          <Alert variant="info">
            <AlertTitle>{t("list.readOnlyTitle")}</AlertTitle>
            <AlertDescription>{t("list.readOnlyDescription")}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <div
            className="space-y-3"
            role="status"
            aria-label={t("list.loading")}
          >
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : isError ? (
          <Alert variant="error">
            <AlertTitle>{t("list.loadErrorTitle")}</AlertTitle>
            <AlertDescription>
              {t("list.loadErrorDescription")}
              <Button className="w-fit" onClick={() => void refetch()}>
                <RefreshCw aria-hidden="true" />
                {t("list.retry")}
              </Button>
              {cursor ? (
                <Button
                  className="w-fit"
                  variant="outline"
                  onClick={resetToFirstPage}
                >
                  {t("common:actions.reset")}
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : policies?.data.length ? (
          <section className="grid gap-3" aria-label={t("list.label")}>
            {policies.data.map((policy) => (
              <SlaPolicySummaryCard key={policy.id} policy={policy} />
            ))}
          </section>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t("list.emptyTitle")}</EmptyTitle>
                  <EmptyDescription>
                    {t("list.emptyDescription")}
                  </EmptyDescription>
                </EmptyHeader>
                {canManage && !isCheckingPermissions ? (
                  <Button
                    render={
                      <Link
                        to={routes.slaPolicyEditor.path}
                        params={{ id: "new" }}
                      />
                    }
                  >
                    <Plus aria-hidden="true" />
                    {t("list.new")}
                  </Button>
                ) : null}
              </Empty>
            </CardContent>
          </Card>
        )}
        {!loading && !isError && policies ? (
          <nav
            aria-label={t("common:pagination.label")}
            className="flex items-center justify-between"
          >
            <Button
              variant="outline"
              disabled={!policies.page.previousCursor}
              onClick={() =>
                void navigate({
                  to: routes.slaPolicies.path,
                  search: { cursor: policies.page.previousCursor ?? undefined },
                })
              }
            >
              <ChevronLeft aria-hidden="true" />
              {t("list.previous")}
            </Button>
            <Button
              variant="outline"
              disabled={!policies.page.hasMore || !policies.page.nextCursor}
              onClick={() =>
                void navigate({
                  to: routes.slaPolicies.path,
                  search: { cursor: policies.page.nextCursor ?? undefined },
                })
              }
            >
              {t("list.next")}
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        ) : null}
      </main>
    </>
  );
}
