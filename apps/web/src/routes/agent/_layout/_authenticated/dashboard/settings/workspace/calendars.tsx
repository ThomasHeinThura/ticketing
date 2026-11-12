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
  PageContainer,
  PageHeader,
  Skeleton,
} from "@taskdesk/ui";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { NoAccessPage } from "@/components/common/page-states";
import PageTitle from "@/components/page-title";
import { CalendarSummaryCard } from "@/components/service-calendar/calendar-summary-card";
import { isForbiddenError } from "@/components/settings/settings-access";
import { WorkspaceFeatureGate } from "@/components/settings/workspace-feature-gate";
import { useServiceCalendars } from "@/hooks/queries/service-calendar/use-service-calendars";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { parseServiceCalendarListSearch, routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/calendars",
)({
  validateSearch: parseServiceCalendarListSearch,
  component: ServiceCalendarsRoute,
});

/** P4R2-M1: the list and its detail routes exist only while `feature.sla` is on. */
function ServiceCalendarsRoute() {
  const { t } = useTranslation("serviceCalendars");
  return (
    <WorkspaceFeatureGate
      feature="feature.sla"
      off="sla"
      title={t("list.title")}
      description={t("list.description")}
    >
      <ServiceCalendarsRouteContent />
    </WorkspaceFeatureGate>
  );
}

function ServiceCalendarsRouteContent() {
  const { t } = useTranslation("serviceCalendars");
  const location = useLocation();
  const navigate = useNavigate({ from: Route.fullPath });
  const { cursor } = Route.useSearch();
  const { data: workspace, isLoading: isWorkspaceLoading } =
    useActiveWorkspace();
  const {
    data: calendars,
    isLoading,
    isError,
    error,
    refetch,
  } = useServiceCalendars(workspace?.id ?? "", cursor);
  const { canManageServiceCalendars, isCheckingPermissions } =
    useWorkspacePermission();
  const canManageCalendars = canManageServiceCalendars();

  if (location.pathname.startsWith(`${routes.serviceCalendars.path}/`)) {
    return <Outlet />;
  }

  if (isForbiddenError(error)) return <NoAccessPage />;
  const loading = isWorkspaceLoading || isLoading;
  const resetToFirstPage = () =>
    void navigate({
      to: routes.serviceCalendars.path,
      search: { cursor: undefined },
    });

  return (
    <>
      <PageTitle title={t("list.title")} />
      <PageContainer>
        <PageHeader
          title={t("list.title")}
          description={t("list.description")}
          actions={
            canManageCalendars && !isCheckingPermissions ? (
              <Button
                render={
                  <Link
                    to={routes.serviceCalendarEditor.path}
                    params={{ id: "new" }}
                  />
                }
                disabled={!workspace}
              >
                <Plus aria-hidden="true" />
                {t("list.new")}
              </Button>
            ) : undefined
          }
        />

        {!canManageCalendars && !isCheckingPermissions ? (
          <Alert variant="info">
            <AlertTitle>{t("editor.readOnlyTitle")}</AlertTitle>
            <AlertDescription>
              {t("editor.readOnlyDescription")}
            </AlertDescription>
          </Alert>
        ) : null}

        <Alert variant="info">
          <CalendarDays aria-hidden="true" />
          <AlertTitle>{t("list.toolsTitle")}</AlertTitle>
          <AlertDescription>{t("list.toolsDescription")}</AlertDescription>
        </Alert>

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
        ) : calendars?.data.length ? (
          <section className="grid gap-3" aria-label={t("list.label")}>
            {calendars.data.map((calendar) => (
              <CalendarSummaryCard key={calendar.id} calendar={calendar} />
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
                {canManageCalendars && !isCheckingPermissions ? (
                  <Button
                    render={
                      <Link
                        to={routes.serviceCalendarEditor.path}
                        params={{ id: "new" }}
                      />
                    }
                  >
                    <Plus aria-hidden="true" />
                    {t("list.create")}
                  </Button>
                ) : null}
                {cursor ? (
                  <Button variant="outline" onClick={resetToFirstPage}>
                    {t("common:actions.reset")}
                  </Button>
                ) : null}
              </Empty>
            </CardContent>
          </Card>
        )}
        {!loading && !isError && calendars ? (
          <nav
            aria-label={t("common:pagination.label")}
            className="flex items-center justify-between"
          >
            <Button
              variant="outline"
              disabled={!calendars.page.previousCursor}
              onClick={() => {
                void navigate({
                  to: routes.serviceCalendars.path,
                  search: {
                    cursor: calendars.page.previousCursor ?? undefined,
                  },
                });
              }}
            >
              <ChevronLeft aria-hidden="true" />
              {t("common:pagination.previous")}
            </Button>
            <Button
              variant="outline"
              disabled={!calendars.page.hasMore || !calendars.page.nextCursor}
              onClick={() => {
                void navigate({
                  to: routes.serviceCalendars.path,
                  search: { cursor: calendars.page.nextCursor ?? undefined },
                });
              }}
            >
              <ChevronRight aria-hidden="true" />
              {t("common:pagination.next")}
            </Button>
          </nav>
        ) : null}
      </PageContainer>
    </>
  );
}
