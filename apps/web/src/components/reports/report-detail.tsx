import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Skeleton,
} from "@taskdesk/ui";
import { ChevronLeft, Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { exportReport, ReportsDisabledError } from "@/fetchers/report";
import { useReport, useReportCatalogue } from "@/hooks/queries/report";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { HttpError } from "@/lib/http-error";
import type { ReportSearch } from "@/lib/report-search";
import { routes } from "@/lib/routes";
import { ReportDrillDialog } from "./report-drill";
import { useExportAction } from "./report-export";
import { ReportFilters } from "./report-filters";
import {
  ReportContextLine,
  ReportEmpty,
  ReportMetrics,
  ReportNotes,
  ReportVisual,
} from "./report-view";

/** Why a report did not load, in words: the feature is off, it is not yours, or the window is bad. */
export function ReportError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const status = error instanceof HttpError ? error.status : undefined;
  const key =
    error instanceof ReportsDisabledError
      ? "disabled"
      : status === 403
        ? "forbidden"
        : status === 404
          ? "notFound"
          : status === 422
            ? "window"
            : "failed";
  return (
    <Alert variant={key === "disabled" ? "info" : "error"}>
      <AlertTitle>{t(`reports:errors.${key}.title`)}</AlertTitle>
      <AlertDescription>
        {t(`reports:errors.${key}.description`)}
      </AlertDescription>
    </Alert>
  );
}

/** `docs/screens.md` "Report detail": filters, chart, table, drill-down and export. */
export function ReportDetail({
  reportKey,
  search,
  onSearchChange,
}: {
  reportKey: string;
  search: ReportSearch;
  onSearchChange: (next: ReportSearch) => void;
}) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const catalogue = useReportCatalogue(workspaceId);
  const entry = catalogue.data?.data.find((report) => report.key === reportKey);
  const report = useReport(workspaceId, reportKey, search);
  const [drilling, setDrilling] = useState<string | null>(search.drill ?? null);
  const exporting = useExportAction(() =>
    exportReport(workspaceId, reportKey, search),
  );
  const title = t(`reports:catalogue.${reportKey}.title`, {
    defaultValue: entry?.title ?? report.data?.title ?? reportKey,
  });
  return (
    <>
      <PageTitle title={title} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <Link
              to={routes.reports.path}
              className="inline-flex items-center gap-1 rounded-sm text-muted-foreground text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
              {t("reports:detail.back")}
            </Link>
            <h1 className="font-semibold text-2xl">{title}</h1>
            <p className="max-w-2xl text-muted-foreground text-sm">
              {t(`reports:catalogue.${reportKey}.description`, {
                defaultValue: "",
              })}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={report.isFetching}
              onClick={() => void report.refetch()}
            >
              <RefreshCw aria-hidden="true" />
              {t("reports:detail.refresh")}
            </Button>
            {catalogue.data?.meta.canExport ? (
              <Button
                variant="outline"
                disabled={exporting.pending || !report.data}
                onClick={exporting.run}
              >
                <Download aria-hidden="true" />
                {t("reports:detail.export")}
              </Button>
            ) : null}
          </div>
        </div>
        {exporting.panel}
        <ReportFilters
          workspaceId={workspaceId}
          search={search}
          onChange={onSearchChange}
          live={report.data?.window.live ?? entry?.live ?? false}
          choices={report.data?.choices ?? []}
        />
        {report.isLoading || !workspace ? (
          <Skeleton className="h-48 w-full" />
        ) : report.isError || !report.data ? (
          <ReportError error={report.error} />
        ) : (
          <div className="space-y-4">
            <ReportContextLine report={report.data} />
            <ReportMetrics
              metrics={report.data.metrics}
              empty={report.data.empty !== null}
            />
            <ReportNotes notes={report.data.notes} />
            <ReportEmpty report={report.data} />
            <ReportVisual
              report={report.data}
              view={search.view}
              onViewChange={(view) =>
                onSearchChange({
                  ...search,
                  view: view === "chart" ? undefined : view,
                })
              }
              onDrill={(handle) => setDrilling(handle)}
            />
          </div>
        )}
      </div>
      {drilling ? (
        <ReportDrillDialog
          workspaceId={workspaceId}
          reportKey={reportKey}
          search={search}
          handle={drilling}
          onClose={() => setDrilling(null)}
        />
      ) : null}
    </>
  );
}
