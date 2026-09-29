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
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { CalendarDays, Plus, RefreshCw } from "lucide-react";
import PageTitle from "@/components/page-title";
import { CalendarSummaryCard } from "@/components/service-calendar/calendar-summary-card";
import { useServiceCalendars } from "@/hooks/queries/service-calendar/use-service-calendars";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/calendars",
)({
  component: ServiceCalendarsRoute,
});

function ServiceCalendarsRoute() {
  const location = useLocation();
  const { data: workspace, isLoading: isWorkspaceLoading } =
    useActiveWorkspace();
  const {
    data: calendars,
    isLoading,
    isError,
    refetch,
  } = useServiceCalendars(workspace?.id ?? "");

  if (location.pathname.startsWith(`${routes.serviceCalendars.path}/`)) {
    return <Outlet />;
  }

  const loading = isWorkspaceLoading || isLoading;

  return (
    <>
      <PageTitle title="Service calendars" />
      <main className="flex h-full flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Service calendars</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Set the working hours that SLA clocks count for this workspace.
            </p>
          </div>
          <Button
            render={
              <Link
                to={routes.serviceCalendarEditor.path}
                params={{ calendarId: "new" }}
              />
            }
            disabled={!workspace}
          >
            <Plus aria-hidden="true" />
            New calendar
          </Button>
        </div>

        <Alert variant="info">
          <CalendarDays aria-hidden="true" />
          <AlertTitle>Some calendar tools are not available yet</AlertTitle>
          <AlertDescription>
            Presets, calendar cloning, country holidays, and .ics import are not
            connected. Add holidays manually. Reference counts and safe deletion
            are unavailable until the calendar usage API is implemented.
          </AlertDescription>
        </Alert>

        {loading ? (
          <div
            className="space-y-3"
            role="status"
            aria-label="Loading service calendars"
          >
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : isError ? (
          <Alert variant="error">
            <AlertTitle>Calendars could not be loaded</AlertTitle>
            <AlertDescription>
              Check your connection and workspace access, then try again.
              <Button className="w-fit" onClick={() => void refetch()}>
                <RefreshCw aria-hidden="true" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : calendars?.length ? (
          <section className="grid gap-3" aria-label="Service calendars">
            {calendars.map((calendar) => (
              <CalendarSummaryCard key={calendar.id} calendar={calendar} />
            ))}
          </section>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No service calendars yet</EmptyTitle>
                  <EmptyDescription>
                    Create a calendar to define when SLA time advances.
                  </EmptyDescription>
                </EmptyHeader>
                <Button
                  render={
                    <Link
                      to={routes.serviceCalendarEditor.path}
                      params={{ calendarId: "new" }}
                    />
                  }
                >
                  <Plus aria-hidden="true" />
                  Create calendar
                </Button>
              </Empty>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}
