import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { CalendarDays, ChartGantt, TriangleAlert } from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";

/**
 * `VW-7`: the loading, error and empty states of the Calendar and Gantt layouts, built from
 * the same `Skeleton`, `Alert` and `Empty` pieces the list and board use. A failed or pending
 * load must never fall through to the "no scheduled tasks" empty state, and a filtered view
 * must say it is filtered (`VW-34`).
 */
export type ScheduleViewStatus = "loading" | "error" | "empty" | "ready";

export function scheduleViewStatus({
  isLoading,
  isError,
  isEmpty,
}: {
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
}): ScheduleViewStatus {
  if (isError) return "error";
  if (isLoading) return "loading";
  return isEmpty ? "empty" : "ready";
}

type ScheduleViewStateProps = {
  layout: "calendar" | "gantt";
  status: Exclude<ScheduleViewStatus, "ready">;
  /** A filter or search narrows the view, so an empty result means "no match". */
  isFiltered: boolean;
  onRetry: () => void;
  /** Sits above content that stays on screen instead of filling the view. */
  compact?: boolean;
};

export default function ScheduleViewState({
  layout,
  status,
  isFiltered,
  onRetry,
  compact = false,
}: ScheduleViewStateProps): JSX.Element {
  const { t } = useTranslation();

  if (status === "loading") {
    return (
      <div
        className="flex flex-col gap-2 p-4"
        data-testid={`${layout}-loading`}
        aria-busy="true"
        aria-live="polite"
      >
        <span className="sr-only">{t("workItems:list.loading")}</span>
        {layout === "calendar" ? (
          <>
            <Skeleton className="h-8 w-full" />
            {["one", "two", "three", "four", "five"].map((key) => (
              <Skeleton key={key} className="h-24 w-full" />
            ))}
          </>
        ) : (
          ["one", "two", "three", "four", "five", "six"].map((key) => (
            <Skeleton key={key} className="h-11 w-full" />
          ))
        )}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="p-4" data-testid={`${layout}-error`}>
        <Alert variant="error">
          <TriangleAlert />
          <AlertTitle>{t("workItems:list.errorTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("workItems:list.errorDescription")}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t("workItems:list.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const Icon = layout === "calendar" ? CalendarDays : ChartGantt;
  return (
    <Empty
      data-testid={`${layout}-empty`}
      className={
        compact ? "flex-none border-b border-border/80 py-6 md:py-6" : undefined
      }
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>
          {isFiltered
            ? t("workItems:list.emptyFilteredTitle")
            : t(`tasks:${layout}.noTasks`)}
        </EmptyTitle>
        <EmptyDescription>
          {isFiltered
            ? t("workItems:list.emptyFilteredDescription")
            : t(`tasks:${layout}.noTasksSubtitle`)}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
