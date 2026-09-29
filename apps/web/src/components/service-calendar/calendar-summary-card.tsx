import { Link } from "@tanstack/react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@taskdesk/ui";
import type { ServiceCalendar } from "@/fetchers/service-calendar";
import { routes } from "@/lib/routes";
import { WEEKDAYS, weeklyCoverHours } from "@/lib/service-calendar-form";

export function CalendarSummaryCard({
  calendar,
}: {
  calendar: ServiceCalendar;
}) {
  const weeklyMinutes = WEEKDAYS.reduce(
    (sum, day) =>
      sum +
      (calendar.windows[day.key] ?? []).reduce(
        (daySum, window) => daySum + window.to - window.from,
        0,
      ),
    0,
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <CardTitle className="truncate">
            <Link
              className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={routes.serviceCalendarEditor.path}
              params={{ calendarId: calendar.id }}
            >
              {calendar.name}
            </Link>
          </CardTitle>
          <CardDescription className="break-all">
            {calendar.timezone}
          </CardDescription>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-medium tabular-nums">
            {weeklyCoverHours(weeklyMinutes)} h/week
          </div>
          <p className="text-xs text-muted-foreground">
            {calendar.holidays?.length ?? 0} manual holidays
          </p>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground">
          Policy and project usage counts are not available yet.
        </p>
      </CardContent>
    </Card>
  );
}
