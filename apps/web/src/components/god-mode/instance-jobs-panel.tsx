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
  Frame,
  Input,
  Label,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type InstanceJob,
  listInstanceJobs,
  queueInstanceJobRun,
  updateInstanceJob,
} from "@/fetchers/god-mode/instance-jobs";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";

function runVariant(state: string) {
  if (state === "succeeded") return "success" as const;
  if (state === "failed" || state === "lease_lost") return "error" as const;
  if (state === "queued" || state === "running") return "warning" as const;
  return "outline" as const;
}

export function InstanceJobsPanel() {
  const { t } = useTranslation("godModeJobs");
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["god-mode", "jobs"],
    queryFn: listInstanceJobs,
    retry: false,
  });
  const save = useMutation({
    mutationFn: ({
      job,
      enabled,
      pattern,
    }: {
      job: InstanceJob;
      enabled?: boolean;
      pattern?: string | null;
    }) =>
      updateInstanceJob(job.name, {
        expectedVersion: job.version,
        ...(enabled === undefined ? {} : { enabled }),
        ...(pattern === undefined ? {} : { pattern }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["god-mode", "jobs"] }),
  });
  const run = useMutation({
    mutationFn: queueInstanceJobRun,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["god-mode", "jobs"] }),
  });

  if (query.isPending) return <Skeleton className="h-72 w-full" />;
  if (query.error instanceof HttpError && query.error.status === 403)
    return (
      <Alert variant="info">
        <AlertTitle>{t("forbiddenTitle")}</AlertTitle>
        <AlertDescription>{t("forbiddenDescription")}</AlertDescription>
      </Alert>
    );
  if (query.isError)
    return (
      <Alert variant="error">
        <AlertTitle>{t("loadErrorTitle")}</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3">
          <span>{t("loadErrorDescription")}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );

  const active = save.isPending || run.isPending;
  return (
    <div className="min-w-0 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {t("checkedAt", { when: formatDateTime(query.data.checkedAt) })}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("refresh")}
        </Button>
      </div>
      {(save.isError || run.isError) && (
        <Alert variant="error">
          <AlertTitle>{t("operationErrorTitle")}</AlertTitle>
          <AlertDescription>{t("operationErrorDescription")}</AlertDescription>
        </Alert>
      )}
      <div className="grid min-w-0 gap-4">
        {query.data.jobs.map((job) => (
          <JobCard
            key={job.name}
            job={job}
            busy={active}
            t={t}
            onSave={(input) => save.mutate({ job, ...input })}
            onRun={() => run.mutate(job.name)}
          />
        ))}
      </div>
      <p className="text-muted-foreground text-xs">{t("historyNotice")}</p>
    </div>
  );
}

function JobCard({
  job,
  busy,
  t,
  onSave,
  onRun,
}: {
  job: InstanceJob;
  busy: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  onSave: (input: { enabled?: boolean; pattern?: string | null }) => void;
  onRun: () => void;
}) {
  const canConfigure = job.defaultPattern !== null;
  const [pattern, setPattern] = useState(job.pattern ?? "");
  useEffect(() => setPattern(job.pattern ?? ""), [job.pattern]);
  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0 space-y-1">
          <CardTitle className="break-all text-base">{job.name}</CardTitle>
          <p className="text-muted-foreground text-sm">
            {job.timezone
              ? t("timezone", { timezone: job.timezone })
              : t("serverTimezone")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {job.queuedRun && (
            <Badge variant="warning">
              {t("queuedRun")} · {t(`states.${job.queuedRun.state}`)}
            </Badge>
          )}
          {job.lastRun ? (
            <Badge variant={runVariant(job.lastRun.state)}>
              {t(`states.${job.lastRun.state}`)}
            </Badge>
          ) : (
            <Badge variant="outline">{t("noRuns")}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {canConfigure ? (
          <div className="grid min-w-0 grid-cols-1 items-end gap-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <div className="flex items-center gap-3 pb-2">
              <Switch
                id={`job-enabled-${job.name}`}
                checked={job.enabled}
                disabled={busy}
                onCheckedChange={(enabled) => onSave({ enabled })}
              />
              <Label htmlFor={`job-enabled-${job.name}`}>{t("enabled")}</Label>
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor={`job-pattern-${job.name}`}>{t("schedule")}</Label>
              <Input
                id={`job-pattern-${job.name}`}
                value={pattern}
                disabled={busy || !job.enabled}
                onChange={(event) => setPattern(event.target.value)}
                aria-describedby={`job-default-${job.name}`}
              />
              <p
                id={`job-default-${job.name}`}
                className="text-muted-foreground text-xs"
              >
                {t("defaultSchedule", { pattern: job.defaultPattern })}
              </p>
            </div>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              disabled={busy || !job.enabled || pattern === (job.pattern ?? "")}
              onClick={() =>
                onSave({
                  pattern:
                    pattern.trim() === job.defaultPattern
                      ? null
                      : pattern.trim(),
                })
              }
            >
              {t("saveSchedule")}
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t("elevatedOperationOnly")}
          </p>
        )}
        <Frame className="min-w-0 max-w-full overflow-x-auto">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("nextScheduledRun")}</TableHead>
                <TableHead>{t("lastStarted")}</TableHead>
                <TableHead>{t("duration")}</TableHead>
                <TableHead>{t("result")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>
                  {job.nextRunAt
                    ? formatDateTime(job.nextRunAt)
                    : t("notScheduled")}
                </TableCell>
                <TableCell>
                  {job.lastRun?.startedAt
                    ? formatDateTime(job.lastRun.startedAt)
                    : t("notApplicable")}
                </TableCell>
                <TableCell>
                  {job.lastRun?.durationMs == null
                    ? t("notApplicable")
                    : `${job.lastRun.durationMs} ms`}
                </TableCell>
                <TableCell>
                  {job.lastRun?.errorCode
                    ? t(`errors.${job.lastRun.errorCode}`)
                    : t("noError")}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Frame>
        {job.manualRunAllowed && (
          <Button
            size="sm"
            variant="outline"
            disabled={
              busy ||
              !job.enabled ||
              job.queuedRun !== null ||
              job.lastRun?.state === "running"
            }
            onClick={onRun}
          >
            {t("runNow")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
