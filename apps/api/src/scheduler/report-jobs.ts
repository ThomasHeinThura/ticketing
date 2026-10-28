import { sql } from "drizzle-orm";
import db from "../database";
import {
  claimExports,
  expireExports,
  processExport,
} from "../report/export.service";
import {
  exportsAwaitingEmail,
  notifyExportReady,
} from "../report/export-notify";
import { workspaceFeatureEnabled } from "../report/feature";
import {
  pruneSnapshots,
  workspaceDaysToWrite,
  writeWorkspaceDays,
} from "../report/snapshot.repository";
import { assertJobExecutionOwned, withJobLease } from "./leader-lock";

export const METRICS_SNAPSHOT_JOB = "metrics-snapshot";
export const REPORT_EXPORT_JOB = "report-export";
const SNAPSHOT_LEASE_MS = 15 * 60_000;
const EXPORT_LEASE_MS = 30 * 60_000;
/** Exports one run takes: each is a full report run, so a run stays short and the next tick continues. */
const EXPORTS_PER_RUN = 5;

export type MetricsSnapshotOutcome = {
  workspaces: number;
  days: number;
  rows: number;
  degraded: boolean;
};

/**
 * `metrics-snapshot` (background-jobs.md, hourly, 15 minute lease), RP-9: writes `metric_snapshot` at
 * DAY grain for every workspace with `feature.reports` on. Each run recomputes the last three
 * closed days (a late SLA flip or a deletion reaches the stored day) and fills missing days up to the
 * retention horizon, newest first, so a first run never holds the lease for long. The rows are
 * aggregates per project, day and dimension, but they carry opaque person ids and, for logged time
 * and cost entries, cost measures (stripped for readers without time_entry:manage_rates), so legal
 * holds DO apply: pruning keeps a held day and erasing a person deletes the facts naming them.
 * The current day is never stored.
 */
export async function runMetricsSnapshot(
  now: Date = new Date(),
): Promise<MetricsSnapshotOutcome> {
  return withJobLease(
    METRICS_SNAPSHOT_JOB,
    async () => {
      const outcome: MetricsSnapshotOutcome = {
        workspaces: 0,
        days: 0,
        rows: 0,
        degraded: false,
      };
      const workspaces = (
        await db.execute<{ id: string }>(sql`SELECT id FROM workspace`)
      ).rows;
      for (const { id } of workspaces) {
        await assertJobExecutionOwned();
        try {
          if (!(await workspaceFeatureEnabled(id, "feature.reports"))) continue;
          const days = await workspaceDaysToWrite(id, now);
          const stats = await writeWorkspaceDays(id, days, now);
          outcome.workspaces += 1;
          outcome.days += stats.days;
          outcome.rows += stats.rows;
        } catch (error) {
          outcome.degraded = true;
          console.error(`metrics-snapshot failed for workspace ${id}`, error);
        }
      }
      try {
        await assertJobExecutionOwned();
        await pruneSnapshots(now);
      } catch (error) {
        outcome.degraded = true;
        console.error("metrics-snapshot prune failed", error);
      }
      return outcome;
    },
    () => ({ workspaces: 0, days: 0, rows: 0, degraded: false }),
    SNAPSHOT_LEASE_MS,
  );
}

export type ReportExportOutcome = {
  processed: number;
  failed: number;
  degraded: boolean;
};

/**
 * `report-export` (background-jobs.md, 30 minute lease), RP-10: renders queued exports into stored
 * CSV, under the requester's reach and with their rate visibility re-checked, then expires finished
 * ones. It is started right after an export is queued and also polled every minute, so a queued
 * export survives a restart. When an export is ready its requester is emailed once a link to the
 * agent export page (P5-R2-02, P5-R3-01, `report/export-notify.ts`); an email still owed (a
 * transport failure, or a claim whose worker crashed and whose lease ran out) is retried by a
 * later run.
 */
export async function runReportExport(
  now: Date = new Date(),
): Promise<ReportExportOutcome> {
  return withJobLease(
    REPORT_EXPORT_JOB,
    async () => {
      const outcome: ReportExportOutcome = {
        processed: 0,
        failed: 0,
        degraded: false,
      };
      try {
        for (const row of await claimExports(EXPORTS_PER_RUN)) {
          await assertJobExecutionOwned();
          const result = await processExport(row);
          outcome.processed += 1;
          if (result === "failed") outcome.failed += 1;
          else await notifyExportReady(row.id);
        }
        for (const id of await exportsAwaitingEmail(EXPORTS_PER_RUN)) {
          await assertJobExecutionOwned();
          await notifyExportReady(id);
        }
        await assertJobExecutionOwned();
        await expireExports(now);
      } catch (error) {
        outcome.degraded = true;
        console.error("report-export failed", error);
      }
      return outcome;
    },
    () => ({ processed: 0, failed: 0, degraded: false }),
    EXPORT_LEASE_MS,
  );
}

/** Starts the export job without waiting for it (the request that queued an export returns at once). */
export function kickReportExport(): void {
  setTimeout(() => {
    void runReportExport().catch((error) =>
      console.error("report-export kick failed", error),
    );
  }, 0);
}
