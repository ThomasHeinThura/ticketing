import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Frame,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  type DryRunCounts,
  type EngineRun,
  getImportDryRun,
  type ImportDryRunReport,
  runImportDryRun,
} from "@/fetchers/god-mode/imports";
import { HttpError } from "@/lib/http-error";
import { SetupJobProgress } from "./setup-job-progress";
import { useIdempotencyKey } from "./use-idempotency-key";
import { wizardKeys } from "./wizard-keys";

const COUNT_KEYS = [
  "created",
  "updated",
  "skipped",
  "rejected",
] as const satisfies readonly (keyof DryRunCounts)[];

/** Reasons the import cannot start from this report; empty means it can. */
export function dryRunBlockers(
  report: ImportDryRunReport | null | undefined,
  run: Pick<EngineRun, "mappingVersion">,
): ("noReport" | "incomplete" | "stale")[] {
  if (!report) return ["noReport"];
  const reasons: ("incomplete" | "stale")[] = [];
  if (!report.complete || !report.completeness.complete)
    reasons.push("incomplete");
  if (
    run.mappingVersion !== null &&
    report.mappingVersion !== run.mappingVersion
  )
    reasons.push("stale");
  return reasons;
}

export function DryRunReportView({
  report,
  run,
}: {
  report: ImportDryRunReport;
  run: Pick<EngineRun, "mappingVersion">;
}) {
  const { t } = useTranslation("godModeImports");
  const blockers = dryRunBlockers(report, run);
  const types = Object.entries(report.byType);
  const rejections = Object.entries(report.rejectionCodes);
  return (
    <div className="min-w-0 space-y-5">
      {blockers.length > 0 ? (
        <Alert variant="error">
          <AlertTitle>{t("wizard.dryRun.blockedTitle")}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-5">
              {blockers.map((reason) => (
                <li key={reason}>{t(`wizard.dryRun.blockers.${reason}`)}</li>
              ))}
              {report.completeness.blocking.slice(0, 10).map((entry) => (
                <li key={`${entry.domain}:${entry.value}`}>
                  {t("wizard.dryRun.blockingEntry", {
                    domain: t(`wizard.domains.${entry.domain}`),
                    value: entry.value,
                    count: entry.affected,
                  })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="success">
          <AlertTitle>{t("wizard.dryRun.readyTitle")}</AlertTitle>
          <AlertDescription>
            {t("wizard.dryRun.readyDescription")}
          </AlertDescription>
        </Alert>
      )}
      {report.approvalRequired ? (
        <Alert variant="info">
          <AlertDescription>
            {t("wizard.dryRun.approvalRequired")}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("wizard.dryRun.outcome")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[...COUNT_KEYS, "processed" as const].map((key) => (
              <div key={key} className="rounded-md border p-3">
                <dt className="text-muted-foreground text-xs">
                  {t(`wizard.dryRun.counts.${key}`)}
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  {report.counts[key]}
                </dd>
              </div>
            ))}
          </dl>
          <div className="text-muted-foreground grid gap-1 text-xs">
            <p>
              {t("wizard.dryRun.digest")}:{" "}
              <span className="break-all font-mono text-foreground">
                {report.digest}
              </span>
            </p>
            <p>
              {t("wizard.dryRun.mappingVersion", {
                version: report.mappingVersion,
              })}
            </p>
            {report.cycleBreaks > 0 ? (
              <p>
                {t("wizard.dryRun.cycleBreaks", { count: report.cycleBreaks })}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {types.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("wizard.dryRun.byType")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Frame className="overflow-x-auto">
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("wizard.dryRun.sourceType")}</TableHead>
                    {COUNT_KEYS.map((key) => (
                      <TableHead key={key} className="text-right">
                        {t(`wizard.dryRun.counts.${key}`)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {types.map(([type, counts]) => (
                    <TableRow key={type}>
                      <TableCell className="break-all font-medium">
                        {type}
                      </TableCell>
                      {COUNT_KEYS.map((key) => (
                        <TableCell
                          key={key}
                          className="text-right tabular-nums"
                        >
                          {counts[key]}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Frame>
          </CardContent>
        </Card>
      ) : null}

      {rejections.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("wizard.dryRun.rejections")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {rejections.map(([code, count]) => (
                <li key={code} className="flex items-center gap-2">
                  <Badge variant="error">{count}</Badge>
                  <span className="break-all">{code}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("wizard.dryRun.losses")}
            {report.lossRecords > 0 ? (
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                {t("wizard.dryRun.lossRecords", { count: report.lossRecords })}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.losses.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("wizard.dryRun.noLosses")}
            </p>
          ) : (
            <Frame className="overflow-x-auto">
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("wizard.dryRun.sourceType")}</TableHead>
                    <TableHead>{t("wizard.losses.code")}</TableHead>
                    <TableHead>{t("wizard.losses.detail")}</TableHead>
                    <TableHead className="text-right">
                      {t("wizard.losses.count")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.losses.map((loss) => (
                    <TableRow
                      key={`${loss.sourceType}:${loss.code}:${loss.detailCode}`}
                    >
                      <TableCell className="break-all">
                        {loss.sourceType}
                      </TableCell>
                      <TableCell>
                        {t(`wizard.lossCodes.${loss.code}`, {
                          defaultValue: loss.code,
                        })}
                      </TableCell>
                      <TableCell className="break-all">
                        {loss.detailCode || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {loss.count}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Frame>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Step 4: whole-run dry run. Nothing is written; the digest it produces is what execute binds. */
export function DryRunStep({
  run,
  onContinue,
}: {
  run: EngineRun;
  onContinue: () => void;
}) {
  const { t } = useTranslation("godModeImports");
  const client = useQueryClient();
  const key = useIdempotencyKey();
  const report = useQuery({
    queryKey: wizardKeys.dryRun(run.id),
    queryFn: () => getImportDryRun(run.id),
    retry: false,
  });
  const dryRun = useMutation({
    mutationFn: () =>
      runImportDryRun(
        run.id,
        key.keyFor(`dry-run:${run.version}:${run.mappingVersion}`),
      ),
    onSuccess: () => {
      key.reset();
      // The dry run reads the source on the server; the engine query (polled while it runs) shows
      // its progress, and the report is read again once it completes.
      void client.invalidateQueries({ queryKey: wizardKeys.engine(run.id) });
    },
  });
  const job = run.job?.kind === "dry_run" ? run.job : null;
  const running = job?.status === "running";
  const doneAt = job?.status === "completed" ? job.updatedAt : null;
  useEffect(() => {
    if (!doneAt) return;
    void client.invalidateQueries({ queryKey: wizardKeys.dryRun(run.id) });
  }, [client, doneAt, run.id]);
  // A run paused mid-execution may come back here to recover (a fresh dry run and approval); a
  // running or completed one may not.
  const locked =
    (run.phase === "executing" && run.state !== "paused") ||
    run.phase === "completed";
  const current = report.data ?? null;
  const blockers = dryRunBlockers(current, run);

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl text-sm">
          {t("wizard.dryRun.description")}
        </p>
        <Button
          disabled={
            dryRun.isPending || running || locked || run.phase === "created"
          }
          onClick={() => dryRun.mutate()}
        >
          {current ? t("wizard.dryRun.rerun") : t("wizard.dryRun.run")}
        </Button>
      </div>
      {running && job ? (
        <SetupJobProgress
          job={job}
          continuing={dryRun.isPending}
          onContinue={() => dryRun.mutate()}
        />
      ) : null}
      {dryRun.isError || (job?.status === "failed" && job.failure !== null) ? (
        <Alert variant="error">
          <AlertTitle>{t("wizard.dryRun.errorTitle")}</AlertTitle>
          <AlertDescription>
            {job?.status === "failed" && job.failure !== null
              ? t(`wizard.setupFailures.${job.failure}`, {
                  defaultValue: t(`wizard.connect.reasons.${job.failure}`, {
                    defaultValue: t("wizard.dryRun.errorDescription"),
                  }),
                })
              : dryRun.error instanceof HttpError && dryRun.error.status === 409
                ? t("wizard.dryRun.conflictDescription")
                : t("wizard.dryRun.errorDescription")}
          </AlertDescription>
        </Alert>
      ) : null}
      {running ? null : report.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : report.isError ? (
        <Alert variant="error">
          <AlertTitle>{t("wizard.dryRun.loadErrorTitle")}</AlertTitle>
          <AlertDescription>
            {t("wizard.dryRun.loadErrorDescription")}
          </AlertDescription>
        </Alert>
      ) : current ? (
        <>
          <DryRunReportView report={current} run={run} />
          <div className="flex justify-end">
            <Button disabled={blockers.length > 0} onClick={onContinue}>
              {t("wizard.dryRun.continue")}
            </Button>
          </div>
        </>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("wizard.dryRun.emptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("wizard.dryRun.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
