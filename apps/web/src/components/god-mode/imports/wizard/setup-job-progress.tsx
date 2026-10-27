import { Alert, AlertDescription, Button, Progress } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { ImportSetupJob } from "@/fetchers/god-mode/imports";

/**
 * A running step looks abandoned (a restart killed its worker) once neither its progress nor its
 * worker's lease heartbeat has moved for this long. The worker stamps `heartbeatAt` every few
 * seconds while it holds the lease, even inside one slow source call, so a live job never crosses
 * this threshold; a killed one does shortly after its lease (60 s) lapses.
 */
export const SETUP_JOB_STALE_MS = 90_000;

export function setupJobIsStale(job: ImportSetupJob, now = Date.now()) {
  if (job.status !== "running") return false;
  const seen = [job.updatedAt, job.heartbeatAt]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter(Number.isFinite);
  if (seen.length === 0) return false;
  return now - Math.max(...seen) > SETUP_JOB_STALE_MS;
}

/**
 * Progress of the background discovery or dry run: pages read and records processed, with a
 * percentage once the total is known. A step that stopped moving offers to continue it; the server
 * resumes from its checkpoint and never reads the source twice at once.
 */
export function SetupJobProgress({
  job,
  onContinue,
  continuing,
}: {
  job: ImportSetupJob;
  onContinue: () => void;
  continuing: boolean;
}) {
  const { t } = useTranslation("godModeImports");
  const total = job.totalRecords;
  const percent =
    total && total > 0
      ? Math.min(100, Math.round((job.recordsProcessed / total) * 100))
      : null;
  const stale = setupJobIsStale(job);
  return (
    <div className="min-w-0 space-y-3" aria-live="polite">
      <Progress value={percent} aria-label={t(`wizard.setupJob.${job.kind}`)} />
      <p className="text-muted-foreground text-sm tabular-nums">
        {percent === null
          ? t("wizard.setupJob.progressUnknown", {
              pages: job.pagesRead,
              records: job.recordsProcessed,
            })
          : t("wizard.setupJob.progress", {
              pages: job.pagesRead,
              records: job.recordsProcessed,
              total,
              percent,
            })}
      </p>
      {stale ? (
        <Alert variant="warning">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t("wizard.setupJob.stalled")}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={continuing}
              onClick={onContinue}
            >
              {t("wizard.setupJob.continue")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
