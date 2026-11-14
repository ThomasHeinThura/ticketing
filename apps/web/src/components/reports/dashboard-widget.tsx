import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  LoadingStatus,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
  useDelayedPending,
} from "@taskdesk/ui";
import { Info } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DashboardWidget, ReportEnvelope } from "@/fetchers/report";
import { useWidgetData } from "@/hooks/queries/report";
import { formatDateTime } from "@/lib/format";
import { parseReportSearch } from "@/lib/report-search";
import { routes } from "@/lib/routes";
import { useElementSize } from "@/lib/use-element-width";
import { ReportChart } from "./report-chart";
import { ReportError } from "./report-detail";
import { metricText } from "./report-format";
import { ReportTable } from "./report-table";
import {
  ReportContextLine,
  ReportEmpty,
  reportWindowText,
} from "./report-view";

/**
 * A widget's caption (fit rule, 3 Nov): the report window and its as-of time (`RP-4`), always
 * visible, in a line that wraps rather than being cut at the card's edge. The rest of the context
 * (scope, boundary, where the numbers came from) is one tap away, in a popover that works with
 * touch and keyboard.
 */
function WidgetContext({
  report,
  title,
}: {
  report: ReportEnvelope;
  title: string;
}) {
  const { t } = useTranslation();
  const about = t("reports:dashboard.aboutNumbers", { title });
  return (
    <div className="flex w-full min-w-0 items-start gap-1">
      <p
        className="min-w-0 flex-1 break-words text-muted-foreground text-xs leading-5"
        data-testid="widget-context"
      >
        <span>{reportWindowText(report, t)}</span>
        <span aria-hidden="true"> · </span>
        <span data-testid="widget-as-of">
          {t("reports:context.asOf", { time: formatDateTime(report.asOf) })}
        </span>
      </p>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            className="shrink-0 text-muted-foreground"
            aria-label={about}
          >
            <Info aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-80 max-w-[calc(100vw-2rem)]"
          aria-label={about}
        >
          <ReportContextLine report={report} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * One widget (`RP-13`): a fixed report or a saved view, run for the viewer. A chart has its table
 * beside it (`RP-11`); a number is the report's first metric, in the same words as the report.
 */
export function DashboardWidgetCard({
  workspaceId,
  dashboardId,
  version,
  widget,
  onDrill,
  headerAction,
  footer,
  editorActions,
}: {
  workspaceId: string;
  dashboardId: string;
  version: number;
  widget: DashboardWidget;
  /** `RP-12`: open the items behind a row (a viewing dashboard only, never while editing the layout). */
  onDrill?: ((handle: string) => void) | undefined;
  /** `RP-10`: the export control, given the widget's title for its accessible name. */
  headerAction?: ((title: string) => ReactNode) | undefined;
  /** The status of an export queued from this widget. */
  footer?: ReactNode;
  /** Editing controls occupy their own card row so they cannot cover the report controls. */
  editorActions?: ReactNode;
}) {
  const { t } = useTranslation();
  const data = useWidgetData(workspaceId, dashboardId, widget.id, version);
  const [showing, setShowing] = useState<"chart" | "table">("chart");
  const { size: contentSize, measureRef } = useElementSize();
  const report = data.data;
  const title = widget.reportKey
    ? t(`reports:catalogue.${widget.reportKey}.title`, {
        defaultValue: report?.title ?? widget.reportKey,
      })
    : (report?.title ?? t("reports:dashboard.savedView"));
  const first = report?.metrics[0];
  const showTable =
    widget.chartType === "table" || !report?.chart || showing === "table";
  // A chart with nothing plottable (every value missing) or a table with no rows is no data, not a
  // blank frame; say so in the same words as an empty report.
  const noPlottableData = showTable
    ? (report?.rows.length ?? 0) === 0
    : !report?.chart?.series.some((series) =>
        series.values.some((value) => value !== null),
      );
  const placeholderVisible = useDelayedPending(data.isLoading, {
    releaseNow:
      data.isSuccess &&
      (Boolean(report?.empty) ||
        (widget.chartType === "number" ? !first : noPlottableData)),
  });
  return (
    <Card
      className="flex h-full flex-col overflow-hidden"
      data-testid="dashboard-widget"
      data-chart-type={widget.chartType}
    >
      <CardHeader
        className={
          editorActions
            ? "flex flex-col gap-1 space-y-0 p-3"
            : "flex flex-col gap-1 space-y-0 p-4 pb-2"
        }
      >
        {editorActions ? (
          <div className="flex w-full justify-end">{editorActions}</div>
        ) : null}
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {/* The title wraps rather than being cut short (fit rule, 3 Nov). */}
          <CardTitle className="min-w-0 break-words text-base leading-6">
            {widget.reportKey ? (
              <Link
                to={routes.reportDetail.path}
                params={{ key: widget.reportKey }}
                search={parseReportSearch(widget.filters)}
                className="inline-flex min-h-6 max-w-full items-center rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 break-words">{title}</span>
              </Link>
            ) : (
              <span className="block break-words">{title}</span>
            )}
          </CardTitle>
          <div className="flex shrink-0 items-center gap-1">
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
            {headerAction?.(title)}
          </div>
        </div>
        {report ? <WidgetContext report={report} title={title} /> : null}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-hidden pt-0">
        {/* Measured so a chart can fit the widget; the scroll frame stays as a last resort. */}
        <div ref={measureRef} className="h-full min-h-0">
          {/* The chart shrinks to fit after its first render, so the fade follows the content's
              size, not only the frame's, and never stays over a fitted legend. */}
          <ScrollArea
            role="region"
            aria-label={title}
            scrollFade
            observeContent
          >
            <div className="space-y-2">
              {footer}
              {!data.isError &&
              (data.isLoading || (placeholderVisible && data.data)) ? (
                <LoadingStatus
                  visible={placeholderVisible}
                  label={t("common:empty.loading")}
                >
                  <Skeleton
                    className="h-full min-h-16 w-full"
                    style={{
                      visibility: placeholderVisible ? "visible" : "hidden",
                    }}
                  />
                </LoadingStatus>
              ) : data.isError || !report ? (
                <ReportError error={data.error} />
              ) : report.empty ? (
                <ReportEmpty report={report} className="p-2 md:p-2" />
              ) : widget.chartType === "number" ? (
                first?.value === null ? (
                  // RP-1's "Not enough data (n of m needed)" is a sentence, not a figure: body
                  // size under its name, so a two-row KPI tile keeps both inside its frame.
                  <div
                    className="space-y-0.5"
                    data-testid="dashboard-widget-insufficient"
                  >
                    <p className="font-medium text-sm">
                      {t(`reports:metrics.${first.key}`, {
                        defaultValue: first.label,
                      })}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {metricText(first, t)}
                    </p>
                  </div>
                ) : first ? (
                  // The figure and its name share a line when they fit, so a two-row KPI tile
                  // shows both without scrolling, in the editor too.
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <p className="font-semibold text-3xl tabular-nums">
                      {metricText(first, t)}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {t(`reports:metrics.${first.key}`, {
                        defaultValue: first.label,
                      })}
                    </p>
                  </div>
                ) : (
                  <Alert variant="info">
                    <AlertDescription>
                      {t("reports:dashboard.noMetric")}
                    </AlertDescription>
                  </Alert>
                )
              ) : noPlottableData ? (
                <Empty
                  className="p-2 md:p-2"
                  data-testid="dashboard-widget-empty"
                >
                  <EmptyHeader>
                    <EmptyTitle>—</EmptyTitle>
                    <EmptyDescription>
                      {t("reports:empty.noData")}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : showTable ? (
                <ReportTable
                  columns={report.columns}
                  rows={report.rows}
                  label={t("reports:tableLabel", { title })}
                  onDrill={report.drill ? onDrill : undefined}
                />
              ) : report.chart ? (
                <ReportChart
                  chart={report.chart}
                  label={t("reports:chartLabel", { title })}
                  fitHeight={contentSize?.height}
                />
              ) : null}
            </div>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
