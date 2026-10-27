import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
  Spinner,
} from "@taskdesk/ui";
import {
  ChevronLeft,
  CircleAlert,
  Clock,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { downloadReportExport, ReportsDisabledError } from "@/fetchers/report";
import { useReportExport } from "@/hooks/queries/report";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";
import { saveBlob } from "./report-export";

type PageState =
  | "loading"
  | "queued"
  | "running"
  | "ready"
  | "failed"
  | "expired"
  | "notFound"
  | "forbidden"
  | "disabled"
  | "unavailable";

/** Why the status read failed, as one of the page's states. */
function stateOfError(error: unknown): PageState {
  if (error instanceof ReportsDisabledError) return "disabled";
  const status = error instanceof HttpError ? error.status : undefined;
  if (status === 404) return "notFound";
  if (status === 403) return "forbidden";
  return "unavailable";
}

/** Why the download was refused, worded for the requester (the status read already passed). */
function downloadProblem(
  error: unknown,
): "expired" | "notReady" | "revoked" | "failed" {
  const status = error instanceof HttpError ? error.status : undefined;
  if (status === 410) return "expired";
  if (status === 409) return "notReady";
  if (status === 403) return "revoked";
  return "failed";
}

/**
 * `docs/screens.md` "Report export" (P5, `RP-10`, P5-R3-01): where the "export ready" email
 * links. The authenticated shell sends a signed-out recipient through the normal sign-in and back
 * here; the page then shows the export's status and offers the authenticated download. The file
 * is fetched only when the requester presses Download, so each download is audited once.
 */
export function ReportExportPage({ exportId }: { exportId: string }) {
  const { t } = useTranslation();
  const exported = useReportExport(exportId);
  const download = useMutation({
    mutationFn: () => downloadReportExport(exportId),
    onSuccess: ({ filename, blob }) => saveBlob(filename, blob),
    onSettled: (_data, error) => {
      // A refused download may mean the file changed state (expired, failed): show the new one.
      if (error) void exported.refetch();
    },
  });
  const info = exported.data?.data;
  const problem = download.isError ? downloadProblem(download.error) : null;
  const state: PageState = exported.isLoading
    ? "loading"
    : exported.isError
      ? stateOfError(exported.error)
      : problem === "expired"
        ? "expired"
        : (info?.status ?? "unavailable");
  const title = info?.title ?? t("reports:exportPage.title");

  return (
    <>
      <PageTitle title={title} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
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
            {t("reports:exportPage.subtitle")}
          </p>
        </div>
        {state === "loading" ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <ExportState
            state={state}
            rowCount={info?.rowCount ?? 0}
            truncated={Boolean(info?.truncated)}
            reportKey={info?.reportKey ?? null}
            action={
              state === "ready" ? (
                <Button
                  disabled={download.isPending}
                  onClick={() => download.mutate()}
                >
                  {download.isPending ? (
                    <Spinner aria-hidden="true" className="size-4" />
                  ) : (
                    <Download aria-hidden="true" />
                  )}
                  {t("reports:export.download")}
                </Button>
              ) : state === "unavailable" ? (
                <Button
                  variant="outline"
                  onClick={() => void exported.refetch()}
                >
                  {t("reports:exportPage.retry")}
                </Button>
              ) : null
            }
          />
        )}
        {problem && problem !== "expired" && state === "ready" ? (
          <Alert variant="error" data-testid="report-export-download-error">
            <AlertTitle>
              {t(`reports:exportPage.download.${problem}.title`)}
            </AlertTitle>
            <AlertDescription>
              {t(`reports:exportPage.download.${problem}.description`)}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </>
  );
}

function ExportState({
  state,
  rowCount,
  truncated,
  reportKey,
  action,
}: {
  state: Exclude<PageState, "loading">;
  rowCount: number;
  truncated: boolean;
  reportKey: string | null;
  action: ReactNode;
}) {
  const { t } = useTranslation();
  const waiting = state === "queued" || state === "running";
  const fromStatus =
    waiting ||
    state === "ready" ||
    state === "failed" ||
    state === "expired" ||
    state === "unavailable";
  const icon = waiting ? (
    <Spinner aria-hidden="true" />
  ) : state === "ready" ? (
    <FileSpreadsheet aria-hidden="true" />
  ) : state === "expired" ? (
    <Clock aria-hidden="true" />
  ) : (
    <CircleAlert aria-hidden="true" />
  );
  const titleKey = fromStatus
    ? `reports:export.status.${state}.title`
    : `reports:exportPage.${state}.title`;
  const descriptionKey = fromStatus
    ? `reports:export.status.${state}.description`
    : `reports:exportPage.${state}.description`;
  const again =
    (state === "expired" || state === "failed") && reportKey ? (
      <Button
        variant="outline"
        render={
          <Link to={routes.reportDetail.path} params={{ key: reportKey }} />
        }
      >
        {t("reports:exportPage.openReport")}
      </Button>
    ) : null;
  return (
    <Empty
      className="border"
      data-testid="report-export-page-state"
      data-state={state}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{t(titleKey)}</EmptyTitle>
        <EmptyDescription>
          {t(descriptionKey, { count: rowCount })}
          {state === "ready" && truncated ? (
            <span> {t("reports:export.truncated")}</span>
          ) : null}
        </EmptyDescription>
      </EmptyHeader>
      {action || again ? (
        <EmptyContent>
          {action}
          {again}
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
