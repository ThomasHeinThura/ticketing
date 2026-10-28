import { Button } from "@taskdesk/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/format";
import { CALENDAR_VIEWS, type CalendarView } from "@/lib/project-board-search";

type CalendarToolbarProps = {
  /** The month shown in month view; in the week and day views it is the anchor's month. */
  visibleMonth: Date;
  /** The week or day the range is anchored on (`VW-25`). */
  anchor?: Date;
  /** The Monday-or-Sunday-first days of the visible week, for the week range label. */
  rangeDays?: Date[];
  view?: CalendarView;
  onViewChange?: (view: CalendarView) => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  /** Extra controls placed before the range navigation (the selection switch). */
  actions?: ReactNode;
};

function rangeLabel(
  view: CalendarView,
  visibleMonth: Date,
  anchor: Date | undefined,
  rangeDays: Date[] | undefined,
): string {
  if (view === "month" || !anchor)
    return formatDate(visibleMonth, { month: "long", year: "numeric" });
  if (view === "day")
    return formatDate(anchor, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  const first = rangeDays?.[0] ?? anchor;
  const last = rangeDays?.at(-1) ?? anchor;
  return `${formatDate(first, { day: "numeric", month: "short" })} – ${formatDate(
    last,
    { day: "numeric", month: "short", year: "numeric" },
  )}`;
}

export default function CalendarToolbar({
  visibleMonth,
  anchor,
  rangeDays,
  view = "month",
  onViewChange,
  onPreviousMonth,
  onNextMonth,
  onToday,
  actions,
}: CalendarToolbarProps): JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="border-b border-border/80 px-3 py-3 sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-sm font-semibold text-foreground">
            {t("tasks:calendar.title")}
          </h1>
          <span
            className="truncate text-sm text-muted-foreground"
            data-testid="calendar-month-label"
          >
            {rangeLabel(view, visibleMonth, anchor, rangeDays)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {onViewChange ? (
            <fieldset
              aria-label={t("tasks:calendar.viewGroup")}
              className="m-0 inline-flex min-w-0 items-center gap-1 border-0 p-0"
            >
              {CALENDAR_VIEWS.map((mode) => (
                <Button
                  key={mode}
                  variant="ghost"
                  type="button"
                  className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors ${view === mode ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
                  aria-pressed={view === mode}
                  onClick={() => onViewChange(mode)}
                >
                  {t(`tasks:calendar.view.${mode}`)}
                </Button>
              ))}
            </fieldset>
          ) : null}
          <Button
            variant="outline"
            size="icon-xs"
            className="min-h-11 touch-manipulation sm:min-h-0"
            aria-label={t(
              view === "month"
                ? "tasks:calendar.previousMonth"
                : view === "week"
                  ? "tasks:calendar.previousWeek"
                  : "tasks:calendar.previousDay",
            )}
            onClick={onPreviousMonth}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="xs"
            className="min-h-11 touch-manipulation sm:min-h-0"
            onClick={onToday}
          >
            {t("tasks:calendar.today")}
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            className="min-h-11 touch-manipulation sm:min-h-0"
            aria-label={t(
              view === "month"
                ? "tasks:calendar.nextMonth"
                : view === "week"
                  ? "tasks:calendar.nextWeek"
                  : "tasks:calendar.nextDay",
            )}
            onClick={onNextMonth}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
