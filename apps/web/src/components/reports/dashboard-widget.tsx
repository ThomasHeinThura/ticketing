import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DashboardWidget } from "@/fetchers/report";
import { useWidgetData } from "@/hooks/queries/report";
import { parseReportSearch } from "@/lib/report-search";
import { routes } from "@/lib/routes";
import { ReportChart } from "./report-chart";
import { ReportError } from "./report-detail";
import { metricText } from "./report-format";
import { ReportTable } from "./report-table";
import { ReportContextLine, ReportEmpty } from "./report-view";

/**
 * One widget (`RP-13`): a fixed report or a saved view, run for the viewer. A chart has its table
 * beside it (`RP-11`); a number is the report's first metric, in the same words as the report.
 */
export function DashboardWidgetCard({
  workspaceId,
  dashboardId,
  version,
  widget,
}: {
  workspaceId: string;
  dashboardId: string;
  version: number;
  widget: DashboardWidget;
}) {
  const { t } = useTranslation();
  const data = useWidgetData(workspaceId, dashboardId, widget.id, version);
  const [showing, setShowing] = useState<"chart" | "table">("chart");
  const report = data.data;
  const title = widget.reportKey
    ? t(`reports:catalogue.${widget.reportKey}.title`, {
        defaultValue: report?.title ?? widget.reportKey,
      })
    : (report?.title ?? t("reports:dashboard.savedView"));
  const first = report?.metrics[0];
  const showTable =
    widget.chartType === "table" || !report?.chart || showing === "table";
  return (
    <Card
      className="flex h-full flex-col overflow-hidden"
      data-testid="dashboard-widget"
    >
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="truncate text-base">
          {widget.reportKey ? (
            <Link
              to={routes.reportDetail.path}
              params={{ key: widget.reportKey }}
              search={parseReportSearch(widget.filters)}
              className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {title}
            </Link>
          ) : (
            title
          )}
        </CardTitle>
        {widget.chartType !== "number" &&
        widget.chartType !== "table" &&
        report?.chart ? (
          <ToggleGroup
            size="sm"
            aria-label={t("reports:dashboard.widgetView", { title })}
            value={[showing]}
            onValueChange={(values) => {
              const next = values[values.length - 1];
              if (next === "chart" || next === "table") setShowing(next);
            }}
          >
            <ToggleGroupItem value="chart">
              {t("reports:views.chart")}
            </ToggleGroupItem>
            <ToggleGroupItem value="table">
              {t("reports:views.table")}
            </ToggleGroupItem>
          </ToggleGroup>
        ) : null}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 space-y-2 overflow-auto pt-0">
        {data.isLoading ? (
          <Skeleton className="h-full min-h-16 w-full" />
        ) : data.isError || !report ? (
          <ReportError error={data.error} />
        ) : report.empty ? (
          <ReportEmpty report={report} />
        ) : widget.chartType === "number" ? (
          first ? (
            <div className="space-y-1">
              <p className="text-muted-foreground text-sm">
                {t(`reports:metrics.${first.key}`, {
                  defaultValue: first.label,
                })}
              </p>
              <p className="font-semibold text-3xl tabular-nums">
                {metricText(first, t)}
              </p>
            </div>
          ) : (
            <Alert variant="info">
              <AlertDescription>
                {t("reports:dashboard.noMetric")}
              </AlertDescription>
            </Alert>
          )
        ) : showTable ? (
          <ReportTable
            columns={report.columns}
            rows={report.rows}
            label={t("reports:tableLabel", { title })}
          />
        ) : report.chart ? (
          <ReportChart
            chart={report.chart}
            label={t("reports:chartLabel", { title })}
          />
        ) : null}
        {report ? (
          <div className="text-xs">
            <ReportContextLine report={report} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
