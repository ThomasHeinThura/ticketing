import {
  Badge,
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@taskdesk/ui";
import { CircleAlert, Pause } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WorkItemSlaMetric } from "@/fetchers/work-item/get-work-item-sla";
import useGetWorkItemSla from "@/hooks/queries/work-item/use-get-work-item-sla";
import { formatDate } from "@/lib/format";
import { HttpError } from "@/lib/http-error";

const STATE_VARIANT: Record<
  WorkItemSlaMetric["state"],
  "secondary" | "info" | "warning" | "error" | "success" | "outline"
> = {
  none: "outline",
  ok: "info",
  at_risk: "warning",
  breached: "error",
  met: "success",
  missed: "error",
};

type SlaPauseRow = {
  metric: WorkItemSlaMetric["metric"];
  startedAt: string | Date;
  endedAt: string | Date | null;
  reason: string;
};

/** `SLA-19`: the due instant with the viewer's own timezone spelled out. */
export function formatSlaInstant(value: string | number | Date): string {
  return formatDate(value, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

const INDICATOR_CLASS: Partial<Record<WorkItemSlaMetric["state"], string>> = {
  at_risk: "bg-warning",
  breached: "bg-destructive",
  missed: "bg-destructive",
};

function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const total = Math.abs(Math.round(minutes));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days > 0) return `${sign}${days}d ${hours}h`;
  if (hours > 0) return `${sign}${hours}h ${mins}m`;
  return `${sign}${mins}m`;
}

function pausedSince(
  pauses: SlaPauseRow[] | undefined,
  metric: WorkItemSlaMetric["metric"],
): SlaPauseRow | undefined {
  return pauses?.find((pause) => pause.metric === metric && !pause.endedAt);
}

/**
 * The work item's first-response and resolution clocks (`GET /work-items/{key}/sla`,
 * `sla.md`). An item with no matching policy shows "no SLA" for both clocks.
 */
export default function WorkItemSla({
  workItemKey,
  compact = false,
}: {
  workItemKey: string;
  /** Inside kaneo's Properties column: a small heading and one column. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const query = useGetWorkItemSla(workItemKey);
  // `calendarName`, `atRiskThresholdPct` and `pauses` come from the staff route; a response
  // without them (an older server) renders the clocks alone.
  const calendarName = query.data?.calendarName ?? null;
  const atRiskThresholdPct = query.data?.atRiskThresholdPct ?? null;
  const pauses: SlaPauseRow[] | undefined = query.data?.pauses;
  // `feature.sla` off: the route answers 404 and the panel is not shown at all (P4R1-M2).
  if (query.error instanceof HttpError && query.error.status === 404)
    return null;
  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="work-item-sla-heading"
      data-testid="work-item-sla"
    >
      <h2
        id="work-item-sla-heading"
        className={compact ? "font-medium text-sm" : "font-medium text-lg"}
      >
        {t("workItems:detail.sla.heading")}
      </h2>
      {query.isLoading ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t("common:empty.loading")}
        </p>
      ) : query.isError || !Array.isArray(query.data?.metrics) ? (
        <p className="text-muted-foreground text-sm">
          {t("workItems:detail.sla.unavailable")}
        </p>
      ) : (
        <>
          {calendarName ? (
            <p
              className="text-muted-foreground text-xs"
              data-testid="work-item-sla-calendar"
            >
              {t("workItems:detail.sla.calendar", { name: calendarName })}
            </p>
          ) : null}
          <ul className={compact ? "grid gap-2" : "grid gap-3 sm:grid-cols-2"}>
            {(query.data?.metrics ?? []).map((metric) => {
              const paused = pausedSince(pauses, metric.metric);
              return (
                <li
                  key={metric.metric}
                  className="flex flex-col gap-2 rounded-lg border border-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">
                      {t(`workItems:detail.sla.metric.${metric.metric}`)}
                    </span>
                    <Badge variant={STATE_VARIANT[metric.state]}>
                      {t(`workItems:detail.sla.state.${metric.state}`)}
                    </Badge>
                  </div>
                  {metric.state === "none" ? null : (
                    <>
                      <div className="relative">
                        <Progress
                          value={Math.min(100, Math.max(0, metric.consumedPct))}
                          aria-label={t(
                            `workItems:detail.sla.metric.${metric.metric}`,
                          )}
                        >
                          <ProgressTrack>
                            <ProgressIndicator
                              className={INDICATOR_CLASS[metric.state]}
                            />
                          </ProgressTrack>
                        </Progress>
                        {atRiskThresholdPct !== null ? (
                          <span
                            role="img"
                            aria-label={t(
                              "workItems:detail.sla.atRiskMarkerAt",
                              {
                                pct: atRiskThresholdPct,
                              },
                            )}
                            title={t("workItems:detail.sla.atRiskMarkerAt", {
                              pct: atRiskThresholdPct,
                            })}
                            className="absolute -top-0.5 h-2.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
                            style={{
                              left: `${Math.min(100, Math.max(0, atRiskThresholdPct))}%`,
                            }}
                            data-testid="work-item-sla-threshold-marker"
                          />
                        ) : null}
                      </div>
                      {metric.state === "at_risk" ? (
                        <p
                          className="flex items-center gap-1 font-medium text-warning-foreground text-xs"
                          data-testid="work-item-sla-at-risk"
                        >
                          <CircleAlert className="size-3" aria-hidden="true" />
                          {atRiskThresholdPct !== null
                            ? t("workItems:detail.sla.atRiskPast", {
                                pct: atRiskThresholdPct,
                              })
                            : t("workItems:detail.sla.atRiskMark")}
                        </p>
                      ) : null}
                      {paused ? (
                        <p
                          className="flex items-center gap-1 text-muted-foreground text-xs"
                          data-testid="work-item-sla-paused"
                        >
                          <Pause className="size-3" aria-hidden="true" />
                          {t("workItems:detail.sla.pausedSince", {
                            reason: t(
                              `workItems:detail.sla.pauseReason.${paused.reason}`,
                              {
                                defaultValue: t(
                                  "workItems:detail.sla.pauseReason.other",
                                ),
                              },
                            ),
                            since: formatSlaInstant(paused.startedAt),
                          })}
                        </p>
                      ) : null}
                      <p className="text-muted-foreground text-xs">
                        {[
                          metric.remainingMinutes !== null
                            ? t("workItems:detail.sla.remaining", {
                                time: formatMinutes(metric.remainingMinutes),
                              })
                            : null,
                          metric.dueAt
                            ? t("workItems:detail.sla.due", {
                                date: formatSlaInstant(metric.dueAt),
                              })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
