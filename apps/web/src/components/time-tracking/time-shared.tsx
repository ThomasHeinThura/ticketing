import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Alert, AlertDescription, Button } from "@taskdesk/ui";
import { Square } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PickerPopover } from "@/components/common/picker-popover";
import {
  stopTimer,
  type TimeActivity,
  TimeRuleError,
  type TimerState,
} from "@/fetchers/time-tracking";
import { timeKeys } from "@/hooks/queries/time-tracking/use-time-tracking";
import { elapsedMinutes, formatMinutes } from "@/lib/time-minutes";
import { toast } from "@/lib/toast";

/** One place that words the API's time rules; anything else falls back to the server's message. */
export function useTimeErrorMessage() {
  const { t } = useTranslation();
  return (error: unknown) => {
    if (error instanceof TimeRuleError)
      return t(`timeTracking:errors.${error.code}`);
    return error instanceof Error
      ? error.message
      : t("timeTracking:errors.generic");
  };
}

export function useInvalidateTime() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: timeKeys.all });
}

/** A ticking clock that follows the server's, so a skewed browser clock does not skew the timer. */
export function useServerNow(
  state: TimerState | undefined,
  dataUpdatedAt: number,
) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(handle);
  }, []);
  const offset = state ? Date.parse(state.serverNow) - dataUpdatedAt : 0;
  return now + offset;
}

export function ActivitySelect({
  id,
  activities,
  value,
  onChange,
  disabled,
  label,
}: {
  id?: string;
  activities: TimeActivity[];
  value: string | null;
  onChange: (activityId: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <PickerPopover
      id={id}
      value={value ?? undefined}
      disabled={disabled}
      ariaLabel={label}
      placeholder={label ?? ""}
      className="w-full"
      options={activities.map((activity) => ({
        value: activity.id,
        label: activity.name,
      }))}
      onChange={onChange}
    />
  );
}

/** The running timer, anywhere it is shown: what it is on, how long, and Stop. */
export function RunningTimerBar({
  state,
  dataUpdatedAt,
}: {
  state: TimerState;
  dataUpdatedAt: number;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const now = useServerNow(state, dataUpdatedAt);
  const stop = useMutation({
    // The timer's own workspace: a timer started in another workspace is shown here too.
    mutationFn: () =>
      stopTimer({ workspaceId: state.timer?.workspaceId ?? "" }),
    onSuccess: async (result) => {
      await invalidate();
      toast.success(t("timeTracking:timer.stopped"));
      if (result.capped) toast.warning(t("timeTracking:timer.cappedNotice"));
    },
    onError: (error) => toast.error(message(error)),
  });
  const timer = state.timer;
  if (!timer) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
      data-testid="running-timer"
    >
      <span className="font-medium tabular-nums" aria-live="off">
        {formatMinutes(elapsedMinutes(timer.startedAt, now))}
      </span>
      <span className="text-muted-foreground">
        {t("timeTracking:timer.runningOn")}
      </span>
      {timer.workItemKey ? (
        <Link
          to="/agent/work-items/$key"
          params={{ key: timer.workItemKey }}
          className="font-medium underline-offset-2 hover:underline"
        >
          {timer.workItemKey}
        </Link>
      ) : null}
      <span className="min-w-0 truncate text-muted-foreground">
        {timer.workItemTitle}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto"
        disabled={stop.isPending}
        onClick={() => stop.mutate()}
      >
        <Square aria-hidden="true" />
        {t("timeTracking:timer.stop")}
      </Button>
    </div>
  );
}

/** A capped timer asks what actually happened: shown on every screen that lists the person's entries. */
export function ReviewNotice({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <Alert variant="warning" data-testid="time-review-notice">
      <AlertDescription>
        {t("timeTracking:review.notice", { count })}
      </AlertDescription>
    </Alert>
  );
}
