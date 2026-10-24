import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@taskdesk/ui";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReportEnvelope, ReportMetric } from "@/fetchers/report";
import { formatDate, formatDateTime } from "@/lib/format";
import type { ReportSearch } from "@/lib/report-search";
import { ReportChart } from "./report-chart";
import { metricText } from "./report-format";
import { ReportTable } from "./report-table";

/**
 * `RP-9`: where the numbers came from, stated. Closed days read from the hourly snapshots; the
 * current period (and any day not stored yet) is computed live, and the boundary is the date.
 */
function boundaryText(
  report: ReportEnvelope,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const snapshot = report.snapshot;
  if (report.boundary === "live" || !snapshot) return t("reports:context.live");
  // `through` is the end of the last stored day: the day itself is the instant before it.
  const last = snapshot.through
    ? formatDate(new Date(new Date(snapshot.through).getTime() - 1), {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
  const computed = snapshot.computedAt
    ? formatDateTime(snapshot.computedAt)
    : "";
  return t(
    report.boundary === "snapshot"
      ? "reports:context.snapshot"
      : "reports:context.mixed",
    { through: last, computed, count: snapshot.closedDays },
  );
}

/** `RP-3` and `RP-4`: whose numbers these are, over which window, and as of when. */
export function ReportContextLine({ report }: { report: ReportEnvelope }) {
  const { t } = useTranslation();
  const scope =
    report.scope.kind === "all"
      ? t("reports:context.scopeAll", { count: report.scope.projectCount })
      : t("reports:context.scopeReach", { count: report.scope.projectCount });
  const window = report.window.live
    ? t("reports:context.windowLive")
    : t("reports:context.window", {
        from: formatDate(report.window.from, {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        }),
        to: formatDate(report.window.to, {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: report.window.preset === "custom" ? "UTC" : undefined,
        }),
        days: report.window.days,
      });
  return (
    <p className="text-muted-foreground text-sm" data-testid="report-context">
      <span>{scope}</span>
      <span aria-hidden="true"> · </span>
      <span>{window}</span>
      <span aria-hidden="true"> · </span>
      <span>
        {t("reports:context.asOf", { time: formatDateTime(report.asOf) })}
      </span>
      <span aria-hidden="true"> · </span>
      <span data-testid="report-boundary">{boundaryText(report, t)}</span>
    </p>
  );
}

function TrendLine({ metric }: { metric: ReportMetric }) {
  const { t } = useTranslation();
  if (!metric.trend) return null;
  if (metric.trend.status === "insufficient")
    return (
      <p className="text-muted-foreground text-xs">
        {t("reports:trend.insufficient")}
      </p>
    );
  const { direction, delta, previous } = metric.trend;
  const Icon =
    direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : Minus;
  return (
    <p className="flex items-center gap-1 text-muted-foreground text-xs">
      <Icon aria-hidden="true" className="size-3.5" />
      {t(`reports:trend.${direction}`, {
        delta: Math.abs(delta),
        previous,
      })}
    </p>
  );
}

/** One figure per metric, in the same words whether it is a number or a gap (`RP-1`). */
export function ReportMetrics({
  metrics,
  empty,
}: {
  metrics: ReportMetric[];
  empty: boolean;
}) {
  const { t } = useTranslation();
  if (metrics.length === 0) return null;
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric) => (
        <Card key={metric.key}>
          <CardContent className="space-y-1 p-4">
            <dt className="text-muted-foreground text-sm">
              {t(`reports:metrics.${metric.key}`, {
                defaultValue: metric.label,
              })}
            </dt>
            <dd className="font-semibold text-2xl tabular-nums">
              {empty && metric.value === 0 ? "—" : metricText(metric, t)}
            </dd>
            <TrendLine metric={metric} />
          </CardContent>
        </Card>
      ))}
    </dl>
  );
}

export function ReportNotes({ notes }: { notes: string[] }) {
  const { t } = useTranslation();
  if (notes.length === 0) return null;
  return (
    <div className="space-y-2">
      {notes.map((note) => (
        <Alert key={note} variant="info">
          <AlertDescription>
            {t(`reports:notes.${note}`, { defaultValue: note })}
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

/** `RP-5`: "—" with an explanation and the count outside the window, never a chart of nothing. */
export function ReportEmpty({ report }: { report: ReportEnvelope }) {
  const { t } = useTranslation();
  if (!report.empty) return null;
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>—</EmptyTitle>
        <EmptyDescription>
          {report.empty.reason === "no_data_in_window"
            ? t("reports:empty.noDataInWindow", {
                count: report.empty.outsideWindow,
              })
            : t("reports:empty.noData")}
        </EmptyDescription>
        {report.empty.excluded ? (
          <EmptyDescription>
            {t("reports:empty.excluded", {
              count: report.empty.excluded.count,
              reason: t(`reports:excluded.${report.empty.excluded.reason}`, {
                defaultValue: report.empty.excluded.reason,
              }),
            })}
          </EmptyDescription>
        ) : null}
      </EmptyHeader>
    </Empty>
  );
}

/**
 * The chart and its table equivalent (`RP-11`), switched with keyboard-reachable tabs. A report
 * with no chart is its table.
 */
export function ReportVisual({
  report,
  view,
  onViewChange,
  onDrill,
}: {
  report: ReportEnvelope;
  view: NonNullable<ReportSearch["view"]> | undefined;
  onViewChange?: (view: "chart" | "table") => void;
  onDrill?: (handle: string) => void;
}) {
  const { t } = useTranslation();
  if (report.empty) return null;
  const hasChart = report.chart !== null;
  const showing = hasChart ? (view ?? "chart") : "table";
  const table = (
    <ReportTable
      columns={report.columns}
      rows={report.rows}
      label={t("reports:tableLabel", { title: report.title })}
      onDrill={report.drill ? onDrill : undefined}
    />
  );
  return (
    <div className="space-y-3">
      {hasChart && onViewChange ? (
        <Tabs
          value={showing}
          onValueChange={(value) =>
            onViewChange(value === "table" ? "table" : "chart")
          }
        >
          <TabsList className="bg-sidebar gap-2">
            <TabsTrigger value="chart">{t("reports:views.chart")}</TabsTrigger>
            <TabsTrigger value="table">{t("reports:views.table")}</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
      {showing === "chart" && report.chart ? (
        <Card>
          <CardContent className="p-4">
            <ReportChart
              chart={report.chart}
              label={t("reports:chartLabel", { title: report.title })}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">{table}</CardContent>
        </Card>
      )}
      {report.truncated ? (
        <p className="text-muted-foreground text-xs">
          {t("reports:truncated")}
        </p>
      ) : null}
    </div>
  );
}
