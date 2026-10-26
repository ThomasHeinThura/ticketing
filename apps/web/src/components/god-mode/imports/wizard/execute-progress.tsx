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
  Progress,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type EngineRun,
  executeImportRun,
  getImportMapping,
  pauseImportRun,
  resumeImportRun,
} from "@/fetchers/god-mode/imports";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { HttpError } from "@/lib/http-error";
import { useIdempotencyKey } from "./use-idempotency-key";
import { wizardKeys } from "./wizard-keys";

const COUNTERS = ["created", "updated", "skipped", "rejected"] as const;

/** Why the import cannot start; empty means it can. */
export function executeBlockers(
  run: EngineRun,
  mappingComplete: boolean | undefined,
): ("noDryRun" | "mappingIncomplete" | "stale")[] {
  const reasons: ("noDryRun" | "mappingIncomplete" | "stale")[] = [];
  if (!run.dryRun) reasons.push("noDryRun");
  if (mappingComplete === false) reasons.push("mappingIncomplete");
  if (run.dryRun && run.dryRun.mappingVersion !== run.mappingVersion)
    reasons.push("stale");
  return reasons;
}

/**
 * Step 5: start, watch, pause and resume the import. The execute call binds the dry-run digest,
 * its total and the mapping version, so a changed mapping cannot slip through. Runs above the
 * approval threshold answer `pending_approval`; a person approves it in the pending-action
 * dialog and then starts the import.
 */
export function ExecuteStep({
  run,
  onNeedDryRun,
  onCompleted,
}: {
  run: EngineRun;
  onNeedDryRun: () => void;
  onCompleted: () => void;
}) {
  const { t } = useTranslation("godModeImports");
  const client = useQueryClient();
  const openPendingAction = useOpenPendingAction();
  const startKey = useIdempotencyKey();
  const pauseKey = useIdempotencyKey();
  const resumeKey = useIdempotencyKey();
  const [needsDryRun, setNeedsDryRun] = useState(false);
  const mapping = useQuery({
    queryKey: wizardKeys.mapping(run.id),
    queryFn: () => getImportMapping(run.id),
    enabled: run.phase !== "created",
    retry: false,
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: wizardKeys.engine(run.id) });

  const start = useMutation({
    mutationFn: () => {
      if (!run.dryRun || run.dryRun.mappingVersion === null)
        throw new Error("missing dry run");
      const body = {
        dryRunDigest: run.dryRun.digest,
        mappingVersion: run.dryRun.mappingVersion,
        totalCount: run.dryRun.total,
      };
      return executeImportRun(
        run.id,
        body,
        startKey.keyFor(JSON.stringify(body)),
      );
    },
    onSuccess: () => {
      startKey.reset();
      void refresh();
    },
  });
  const pause = useMutation({
    mutationFn: () => pauseImportRun(run.id, pauseKey.keyFor(`${run.version}`)),
    onSuccess: () => {
      pauseKey.reset();
      void refresh();
    },
  });
  const resume = useMutation({
    mutationFn: () =>
      resumeImportRun(run.id, resumeKey.keyFor(`${run.version}`)),
    onSuccess: () => {
      resumeKey.reset();
      setNeedsDryRun(false);
      void refresh();
    },
    onError: (error) => {
      if (error instanceof HttpError && error.status === 409) {
        setNeedsDryRun(true);
        void refresh();
      }
    },
  });

  const done = COUNTERS.reduce((sum, key) => sum + (run.stats[key] ?? 0), 0);
  const total = run.dryRun?.total ?? done;
  const percent =
    total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const blockers = executeBlockers(run, mapping.data?.completeness.complete);
  const pendingActionId = run.approval.approved
    ? null
    : (run.approval.pendingActionId ??
      (start.data?.status === "pending_approval"
        ? start.data.pendingActionId
        : null));
  const executing = run.phase === "executing";
  const finished = run.phase === "completed" || run.state === "completed";

  return (
    <div className="min-w-0 space-y-5">
      {!executing && !finished ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("wizard.execute.ready")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              {run.dryRun
                ? t("wizard.execute.bound", {
                    total: run.dryRun.total,
                    writes: run.dryRun.writes,
                    version: run.dryRun.mappingVersion ?? run.mappingVersion,
                  })
                : t("wizard.execute.noDryRun")}
            </p>
            {blockers.length > 0 ? (
              <Alert variant="error">
                <AlertTitle>{t("wizard.execute.blockedTitle")}</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-5">
                    {blockers.map((reason) => (
                      <li key={reason}>
                        {t(`wizard.execute.blockers.${reason}`)}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            {pendingActionId ? (
              <Alert variant="info">
                <AlertTitle>{t("wizard.execute.approvalTitle")}</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span>{t("wizard.execute.approvalDescription")}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void openPendingAction({ pendingActionId })}
                  >
                    {t("wizard.execute.reviewApproval")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : run.approval.approved ? (
              <Alert variant="success">
                <AlertDescription>
                  {t("wizard.execute.approved")}
                </AlertDescription>
              </Alert>
            ) : null}
            {start.isError ? (
              <Alert variant="error">
                <AlertTitle>{t("wizard.execute.startErrorTitle")}</AlertTitle>
                <AlertDescription>
                  {start.error instanceof HttpError &&
                  start.error.status === 409
                    ? t("wizard.execute.startConflict")
                    : t("wizard.execute.startErrorDescription")}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end">
              <Button
                disabled={
                  blockers.length > 0 || start.isPending || mapping.isPending
                }
                onClick={() => start.mutate()}
              >
                {t("wizard.execute.start")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">
              {t("wizard.execute.progress")}
            </CardTitle>
            <Badge
              variant={
                run.state === "completed"
                  ? "success"
                  : run.state === "failed"
                    ? "error"
                    : run.state === "paused"
                      ? "outline"
                      : "warning"
              }
            >
              {t(`states.${run.state}`)}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress
              value={percent}
              aria-label={t("wizard.execute.progress")}
            />
            <p className="text-muted-foreground text-sm tabular-nums">
              {t("wizard.execute.done", { done, total, percent })}
            </p>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {COUNTERS.map((key) => (
                <div key={key} className="rounded-md border p-3">
                  <dt className="text-muted-foreground text-xs">
                    {t(`counts.${key}`)}
                  </dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {run.stats[key] ?? 0}
                  </dd>
                </div>
              ))}
            </dl>
            {run.state === "paused" && run.pausedReason ? (
              <Alert variant="warning">
                <AlertTitle>{t("wizard.execute.pausedTitle")}</AlertTitle>
                <AlertDescription>
                  {t(`wizard.pausedReasons.${run.pausedReason}`)}
                </AlertDescription>
              </Alert>
            ) : null}
            {needsDryRun ? (
              <Alert variant="error">
                <AlertTitle>
                  {t("wizard.execute.resumeBlockedTitle")}
                </AlertTitle>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span>{t("wizard.execute.resumeBlocked")}</span>
                  <Button size="sm" variant="outline" onClick={onNeedDryRun}>
                    {t("wizard.execute.backToDryRun")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : pause.isError || resume.isError ? (
              <Alert variant="error">
                <AlertDescription>
                  {t("wizard.execute.controlError")}
                </AlertDescription>
              </Alert>
            ) : null}
            {run.state === "failed" ? (
              <Alert variant="error">
                <AlertDescription>
                  {t("wizard.execute.failed")}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              {run.state === "running" ? (
                <Button
                  variant="outline"
                  disabled={pause.isPending}
                  onClick={() => pause.mutate()}
                >
                  {t("wizard.execute.pause")}
                </Button>
              ) : null}
              {run.state === "paused" ? (
                <Button
                  disabled={resume.isPending}
                  onClick={() => resume.mutate()}
                >
                  {t("wizard.execute.resume")}
                </Button>
              ) : null}
              {finished ? (
                <Button onClick={onCompleted}>
                  {t("wizard.execute.toReconcile")}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
