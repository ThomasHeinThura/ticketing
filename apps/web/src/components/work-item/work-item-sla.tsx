import { Badge, Progress } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { WorkItemSlaMetric } from "@/fetchers/work-item/get-work-item-sla";
import useGetWorkItemSla from "@/hooks/queries/work-item/use-get-work-item-sla";
import { formatDateMedium } from "@/lib/format";

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

/**
 * The work item's first-response and resolution clocks (`GET /work-items/{key}/sla`,
 * `sla.md`). An item with no matching policy shows "no SLA" for both clocks.
 */
export default function WorkItemSla({ workItemKey }: { workItemKey: string }) {
  const { t } = useTranslation();
  const query = useGetWorkItemSla(workItemKey);
  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="work-item-sla-heading"
      data-testid="work-item-sla"
    >
      <h2 id="work-item-sla-heading" className="font-medium text-lg">
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
        <ul className="grid gap-3 sm:grid-cols-2">
          {(query.data?.metrics ?? []).map((metric) => (
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
                  <Progress
                    value={Math.min(100, Math.max(0, metric.consumedPct))}
                    aria-label={t(
                      `workItems:detail.sla.metric.${metric.metric}`,
                    )}
                  />
                  <p className="text-muted-foreground text-xs">
                    {[
                      metric.remainingMinutes !== null
                        ? t("workItems:detail.sla.remaining", {
                            time: formatMinutes(metric.remainingMinutes),
                          })
                        : null,
                      metric.dueAt
                        ? t("workItems:detail.sla.due", {
                            date: formatDateMedium(metric.dueAt),
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
