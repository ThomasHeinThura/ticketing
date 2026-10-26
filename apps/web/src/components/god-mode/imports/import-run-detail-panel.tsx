import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
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
  getImportReport,
  getImportRun,
  type ImportRunState,
} from "@/fetchers/god-mode/imports";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";

function stateVariant(state: ImportRunState) {
  if (state === "completed") return "success" as const;
  if (state === "failed") return "error" as const;
  if (state === "running" || state === "queued") return "warning" as const;
  return "outline" as const;
}

export function ImportRunDetailPanel({
  runId,
  onWorkspaceResolved,
}: {
  runId: string;
  onWorkspaceResolved?: (workspaceId: string) => void;
}) {
  const { t } = useTranslation("godModeImports");
  const run = useQuery({
    queryKey: ["god-mode", "imports", "run", runId],
    queryFn: () => getImportRun(runId),
    refetchInterval: (query) =>
      query.state.data?.state === "running" ||
      query.state.data?.state === "queued"
        ? 3000
        : false,
    retry: false,
  });
  const report = useQuery({
    queryKey: ["god-mode", "imports", "report", runId],
    queryFn: () => getImportReport(runId),
    enabled: Boolean(run.data),
    refetchInterval: run.data?.state === "running" ? 3000 : false,
    retry: false,
  });
  useEffect(() => {
    if (run.data?.workspaceId) onWorkspaceResolved?.(run.data.workspaceId);
  }, [onWorkspaceResolved, run.data?.workspaceId]);

  if (run.isPending) return <Skeleton className="h-80 w-full" />;
  if (run.error instanceof HttpError && run.error.status === 403)
    return (
      <Alert variant="info">
        <AlertTitle>{t("forbiddenTitle")}</AlertTitle>
        <AlertDescription>{t("forbiddenDescription")}</AlertDescription>
      </Alert>
    );
  if (run.isError)
    return (
      <Alert variant="error">
        <AlertTitle>{t("detailLoadErrorTitle")}</AlertTitle>
        <AlertDescription>{t("detailLoadErrorDescription")}</AlertDescription>
      </Alert>
    );

  const current = run.data;
  const stats = Object.entries(current.stats);
  const log = current.log;
  const logOccurrences = new Map<string, number>();
  const logRows = log.map((entry) => {
    const identity = JSON.stringify([
      entry.code,
      entry.at,
      entry.chunkId ?? null,
    ]);
    const occurrence = logOccurrences.get(identity) ?? 0;
    logOccurrences.set(identity, occurrence + 1);
    return { entry, key: `${identity}:${occurrence}` };
  });
  const reportMissing =
    report.error instanceof HttpError && report.error.status === 404;

  return (
    <div className="min-w-0 space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="min-w-0 space-y-1">
            <CardTitle className="break-all text-base">
              {current.sourceRef}
            </CardTitle>
            <p className="text-muted-foreground break-all text-xs">
              {current.id}
            </p>
          </div>
          <Badge variant={stateVariant(current.state)}>
            {t(`states.${current.state}`)}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Detail label={t("workspaceId")} value={current.workspaceId} />
          <Detail label={t("projectId")} value={current.projectId ?? "—"} />
          <Detail label={t("plugin")} value={current.pluginId} />
          <Detail label={t("profileId")} value={current.profileId ?? "—"} />
          <Detail label={t("version")} value={String(current.version)} />
          <Detail
            label={t("lastCommittedChunk")}
            value={
              current.lastCommittedChunk < 0
                ? "—"
                : String(current.lastCommittedChunk)
            }
          />
          <Detail
            label={t("createdAt")}
            value={formatDateTime(current.createdAt)}
          />
          <Detail
            label={t("updatedAt")}
            value={formatDateTime(current.updatedAt)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("stats")}</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noStatistics")}</p>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {stats.map(([key, value]) => (
                <div key={key} className="rounded-md border p-3">
                  <dt className="text-muted-foreground text-xs">
                    {t(`counts.${key}`, { defaultValue: key })}
                  </dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("logs")}</CardTitle>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noLogs")}</p>
          ) : (
            <Frame className="overflow-x-auto">
              <Table className="min-w-[520px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("code")}</TableHead>
                    <TableHead>{t("at")}</TableHead>
                    <TableHead>{t("chunkId")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logRows.map(({ entry, key }) => (
                    <TableRow key={key}>
                      <TableCell>
                        {t(`logCodes.${entry.code}`, {
                          defaultValue: entry.code,
                        })}
                      </TableCell>
                      <TableCell>{formatDateTime(entry.at)}</TableCell>
                      <TableCell className="break-all">
                        {entry.chunkId ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Frame>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("report")}</CardTitle>
        </CardHeader>
        <CardContent>
          {report.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : reportMissing ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("noReport")}</EmptyTitle>
                <EmptyDescription>{t("noReportDescription")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : report.isError ? (
            <Alert variant="error">
              <AlertTitle>{t("reportLoadErrorTitle")}</AlertTitle>
              <AlertDescription>
                {t("reportLoadErrorDescription")}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4">
              <CountGrid values={report.data.counts} t={t} />
              {report.data.chunks.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("noChunks")}</p>
              ) : (
                <Frame className="overflow-x-auto">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("chunkSequence")}</TableHead>
                        <TableHead>{t("chunkId")}</TableHead>
                        <TableHead>{t("state")}</TableHead>
                        <TableHead>{t("recordCount")}</TableHead>
                        <TableHead>{t("rejectionCodes")}</TableHead>
                        <TableHead>{t("createdAt")}</TableHead>
                        <TableHead>{t("committedAt")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.data.chunks.map((chunk) => (
                        <TableRow key={`${chunk.sequence}-${chunk.chunkId}`}>
                          <TableCell>{chunk.sequence}</TableCell>
                          <TableCell className="break-all">
                            {chunk.chunkId}
                          </TableCell>
                          <TableCell>{chunk.state}</TableCell>
                          <TableCell>{chunk.recordCount}</TableCell>
                          <TableCell>
                            <CountList values={chunk.rejectionCodes} t={t} />
                          </TableCell>
                          <TableCell>
                            {formatDateTime(chunk.createdAt)}
                          </TableCell>
                          <TableCell>
                            {chunk.committedAt
                              ? formatDateTime(chunk.committedAt)
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Frame>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="break-all font-medium">{value}</p>
    </div>
  );
}

function CountGrid({
  values,
  t,
}: {
  values: Record<string, number>;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  if (Object.keys(values).length === 0)
    return <p className="text-muted-foreground text-sm">{t("noStatistics")}</p>;
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Object.entries(values).map(([key, value]) => (
        <div key={key} className="rounded-md border p-3">
          <dt className="text-muted-foreground text-xs">
            {t(`counts.${key}`, { defaultValue: key })}
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CountList({
  values,
  t,
}: {
  values: Record<string, number>;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const entries = Object.entries(values);
  if (entries.length === 0) return "—";
  return (
    <ul className="space-y-1 text-xs">
      {entries.map(([code, count]) => (
        <li key={code} className="break-all">
          {t(`rejectionCodes.${code}`, { defaultValue: code })}: {count}
        </li>
      ))}
    </ul>
  );
}
