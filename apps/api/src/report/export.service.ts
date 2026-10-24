import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, sql } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import { reportExportTable } from "../database/schema-p5-reports";
import { resolveRequestIdentity } from "../permissions/resolve-request-identity";
import {
  COST_TRACKING_FEATURE_KEY,
  trackingFeatureEnabled,
} from "../time-tracking/feature";
import { assertCallerHasCapability } from "../utils/require-workspace-capability";
import { reachPredicate, selectRows } from "./context";
import {
  type CustomQuery,
  customQuerySchema,
  customWindowInput,
  runCustomReport,
  validateCustomQuery,
} from "./custom";
import {
  EXPORT_MAX_ACTIVE_PER_PERSON,
  EXPORT_ROW_RETENTION_DAYS,
  EXPORT_STALE_RUNNING_MINUTES,
  EXPORT_TTL_HOURS,
} from "./export.logic";
import { workspaceFeatureEnabled } from "./feature";
import { type ReportWindow, resolveWindow, type WindowInput } from "./logic";
import { type ReportEnvelope, reportToCsv } from "./present";
import { reportByKey } from "./registry";
import { type ReportCaps, ReportFeatureDisabledError, runReport } from "./run";
import type { ReportFilters } from "./types";

/** What an export runs: a fixed report with its window, filters and options, or a tier 3 query. */
export type ExportSpec =
  | {
      kind: "report";
      key: string;
      window: WindowInput;
      filters: ReportFilters;
      options: Record<string, string | undefined>;
    }
  | {
      kind: "custom";
      name: string;
      query: CustomQuery;
      chartType: "bar" | "line" | "table" | "number";
    };

export class ExportRuleError extends Error {
  constructor(
    readonly code:
      | "unknown_report"
      | "invalid_window"
      | "window_too_long"
      | "window_order"
      | "unsupported_filter"
      | "unsupported_group"
      | "unsupported_aggregate"
      | "feature_disabled"
      | "forbidden"
      | "bad_spec",
  ) {
    super(code);
  }
}

function windowOf(input: WindowInput, now: Date): ReportWindow {
  const result = resolveWindow(input, now);
  if (!result.ok) throw new ExportRuleError(result.reason);
  return result.window;
}

export type RenderedExport = {
  envelope: ReportEnvelope;
  csv: string;
  filename: string;
  title: string;
  /** The CSV carries rate or cost columns: only a caller who may see rates may download it. */
  ratesIncluded: boolean;
};

/**
 * Runs the export's report for `identity` and renders its CSV. The synchronous route and the
 * background job both come through here, so reach, rate stripping (`stripRates`, TC-11) and the
 * CSV shape cannot differ between them.
 */
export async function renderExport(input: {
  spec: ExportSpec;
  workspaceId: string;
  identity: ResolvedIdentity;
  caps: ReportCaps;
  now: Date;
  exporting: boolean;
}): Promise<RenderedExport> {
  const { spec, now } = input;
  const day = now.toISOString().slice(0, 10);
  if (spec.kind === "report") {
    const def = reportByKey(spec.key);
    if (!def) throw new ExportRuleError("unknown_report");
    const envelope = await runReport({
      def,
      workspaceId: input.workspaceId,
      identity: input.identity,
      caps: input.caps,
      window: windowOf(spec.window, now),
      filters: spec.filters,
      options: spec.options,
      now,
      exporting: input.exporting,
    }).catch((error) => {
      if (error instanceof ReportFeatureDisabledError)
        throw new ExportRuleError("feature_disabled");
      throw error;
    });
    return {
      envelope,
      csv: reportToCsv(envelope),
      filename: `${def.key}-${day}.csv`,
      title: def.title,
      ratesIncluded: envelope.costVisible && def.rated === true,
    };
  }
  const problem = validateCustomQuery(spec.query);
  if (problem) throw new ExportRuleError(problem);
  const envelope = await runCustomReport({
    title: spec.name || "Custom report",
    query: spec.query,
    workspaceId: input.workspaceId,
    identity: input.identity,
    caps: input.caps,
    window: windowOf(customWindowInput(spec.query), now),
    chartType: spec.chartType,
    now,
    exporting: input.exporting,
  });
  return {
    envelope,
    csv: reportToCsv(envelope),
    filename: `custom-report-${day}.csv`,
    title: envelope.title,
    ratesIncluded: false,
  };
}

// ---------------------------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------------------------

export class TooManyExportsError extends Error {}

export type ExportRow = typeof reportExportTable.$inferSelect;

/**
 * Queues an export. The per-person limit is checked and the row inserted under one advisory lock,
 * so two requests racing cannot both slip under the limit.
 */
export async function enqueueExport(input: {
  workspaceId: string;
  personId: string;
  userId: string;
  spec: ExportSpec;
  title: string;
  caps: ReportCaps;
  now: Date;
  audit: (tx: Executor, id: string) => Promise<void>;
}): Promise<ExportRow> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`report_export:${input.personId}`}))`,
    );
    const [active] = (
      await tx.execute<{
        n: string;
      }>(sql`SELECT count(*) AS n FROM report_export
        WHERE person_id = ${input.personId} AND status IN ('queued', 'running')`)
    ).rows;
    if (Number(active?.n ?? 0) >= EXPORT_MAX_ACTIVE_PER_PERSON)
      throw new TooManyExportsError();
    const [row] = await tx
      .insert(reportExportTable)
      .values({
        workspaceId: input.workspaceId,
        personId: input.personId,
        userId: input.userId,
        kind: input.spec.kind,
        reportKey: input.spec.kind === "report" ? input.spec.key : null,
        title: input.title,
        spec: input.spec as unknown as Record<string, unknown>,
        caps: input.caps,
        status: "queued",
        createdAt: input.now,
      })
      .returning();
    if (!row) throw new Error("export row was not written");
    await input.audit(tx, row.id);
    return row;
  });
}

export async function getExport(id: string): Promise<ExportRow | undefined> {
  const [row] = await db
    .select()
    .from(reportExportTable)
    .where(eq(reportExportTable.id, id))
    .limit(1);
  return row;
}

export async function listExports(
  workspaceId: string,
  personId: string,
): Promise<ExportRow[]> {
  const rows = await db
    .select()
    .from(reportExportTable)
    .where(
      and(
        eq(reportExportTable.workspaceId, workspaceId),
        eq(reportExportTable.personId, personId),
      ),
    )
    .orderBy(sql`${reportExportTable.createdAt} DESC`)
    .limit(20);
  return rows;
}

export async function recordDownload(id: string): Promise<void> {
  await db.execute(sql`UPDATE report_export
    SET download_count = download_count + 1, downloaded_at = COALESCE(downloaded_at, now())
    WHERE id = ${id}`);
}

/** Claims up to `limit` queued exports for this worker (`SKIP LOCKED`, so replicas never share one). */
export async function claimExports(limit: number): Promise<ExportRow[]> {
  const result = await db.execute<
    Record<string, unknown>
  >(sql`UPDATE report_export
    SET status = 'running', started_at = now()
    WHERE id IN (
      SELECT id FROM report_export WHERE status = 'queued'
      ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id`);
  const ids = result.rows.map((row) => String(row.id));
  const rows: ExportRow[] = [];
  for (const id of ids) {
    const row = await getExport(id);
    if (row) rows.push(row);
  }
  return rows;
}

async function failExport(id: string, code: string): Promise<void> {
  await db.execute(sql`UPDATE report_export
    SET status = 'failed', error = ${code}, finished_at = now(), content = NULL
    WHERE id = ${id}`);
}

/** What the requester can do right now, read without a request. */
async function currentCaps(
  workspaceId: string,
  userId: string,
): Promise<ReportCaps | null> {
  const holds = async (
    capability: Parameters<typeof assertCallerHasCapability>[2],
  ) => {
    try {
      await assertCallerHasCapability(workspaceId, userId, capability, {
        kind: "session",
      });
      return true;
    } catch {
      return false;
    }
  };
  if (!(await holds("report:export"))) return null;
  const [readAll, manageRates, readAnyTime] = await Promise.all([
    holds("report:read_all"),
    holds("time_entry:manage_rates"),
    holds("time_entry:read_any"),
  ]);
  return {
    readAll,
    showRates:
      manageRates &&
      (await trackingFeatureEnabled(COST_TRACKING_FEATURE_KEY, workspaceId)),
    readAnyTime,
  };
}

/**
 * R7-05: the projects a non-`report:read_all` export covers, recorded on the row (inside the
 * `caps` jsonb, so no column is needed) when the file is rendered. Taken after the render, so
 * the list can only be a superset of what the CSV drew from.
 */
async function coveredProjectIds(
  workspaceId: string,
  identity: ResolvedIdentity,
): Promise<string[]> {
  const rows = await selectRows<{ id: string }>(sql`SELECT p.id
    FROM project p
    WHERE p.workspace_id = ${workspaceId} AND p.deleted_at IS NULL
      AND ${reachPredicate(identity, false)}`);
  return rows.map((row) => row.id);
}

/**
 * R7-05: true when the requester no longer reaches every project the stored file covered. A
 * requester with `report:read_all` is governed by the capability check instead. A reach-scoped
 * file with no recorded coverage (not written by this code) fails closed.
 */
export async function exportReachLost(
  row: Pick<ExportRow, "caps" | "workspaceId">,
  identity: ResolvedIdentity,
): Promise<boolean> {
  const stored = row.caps as { readAll?: boolean; projectIds?: unknown };
  if (stored.readAll === true) return false;
  if (
    !Array.isArray(stored.projectIds) ||
    stored.projectIds.some((id) => typeof id !== "string")
  )
    return true;
  const ids = stored.projectIds as string[];
  if (ids.length === 0) return false;
  const [lost] = await selectRows<{ n: string }>(sql`SELECT count(*) AS n
    FROM project p
    WHERE p.workspace_id = ${row.workspaceId} AND p.deleted_at IS NULL
      AND p.id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})
      AND NOT (${reachPredicate(identity, false)})`);
  return Number(lost?.n ?? 0) > 0;
}

/**
 * Renders one claimed export. The requester is re-resolved and re-checked now (they may have lost
 * the capability, the membership or the feature since asking), and the caps used are the AND of what
 * they could see when they asked and what they can see now, so a later widening never leaks into an
 * older request and a revoked right never survives in the queue.
 */
export async function processExport(
  row: ExportRow,
): Promise<"ready" | "failed"> {
  try {
    if (!(await workspaceFeatureEnabled(row.workspaceId, "feature.reports"))) {
      await failExport(row.id, "feature_disabled");
      return "failed";
    }
    const identity = await resolveRequestIdentity({ userId: row.userId });
    const now = await currentCaps(row.workspaceId, row.userId);
    if (identity?.side !== "staff" || !now) {
      await failExport(row.id, "forbidden");
      return "failed";
    }
    const asked = row.caps as unknown as ReportCaps;
    const caps: ReportCaps = {
      readAll: asked.readAll && now.readAll,
      showRates: asked.showRates && now.showRates,
      readAnyTime: asked.readAnyTime && now.readAnyTime,
    };
    const spec = row.spec as unknown as ExportSpec;
    if (spec.kind === "custom") {
      const parsed = customQuerySchema.safeParse(spec.query);
      if (!parsed.success) {
        await failExport(row.id, "bad_spec");
        return "failed";
      }
    }
    const rendered = await renderExport({
      spec,
      workspaceId: row.workspaceId,
      identity,
      caps,
      now: row.createdAt,
      exporting: true,
    });
    const stored = caps.readAll
      ? caps
      : {
          ...caps,
          projectIds: await coveredProjectIds(row.workspaceId, identity),
        };
    await db.execute(sql`UPDATE report_export
      SET status = 'ready', content = ${rendered.csv}, filename = ${rendered.filename},
        row_count = ${rendered.envelope.rows.length}, byte_size = ${Buffer.byteLength(rendered.csv)},
        truncated = ${rendered.envelope.truncated}, rates_included = ${rendered.ratesIncluded},
        caps = ${JSON.stringify(stored)}::jsonb,
        finished_at = now(), expires_at = now() + ${`${EXPORT_TTL_HOURS} hours`}::interval, error = NULL
      WHERE id = ${row.id}`);
    return "ready";
  } catch (error) {
    const code =
      error instanceof ExportRuleError ? error.code : "export_failed";
    if (code === "export_failed") console.error("report export failed", error);
    await failExport(row.id, code);
    return "failed";
  }
}

/**
 * Housekeeping: a ready export past `expires_at` loses its content and becomes `expired`; a run
 * abandoned by a stopped worker becomes `failed`; a long-finished row is deleted. Only the rows of
 * the export queue are touched: the exported data is derivative, so legal holds do not apply.
 */
export async function expireExports(now: Date = new Date()): Promise<void> {
  await db.execute(sql`UPDATE report_export SET status = 'expired', content = NULL
    WHERE status = 'ready' AND expires_at < ${now.toISOString()}::timestamptz`);
  await db.execute(sql`UPDATE report_export
    SET status = 'failed', error = 'worker_lost', finished_at = now(), content = NULL
    WHERE status = 'running'
      AND started_at < ${now.toISOString()}::timestamptz - ${`${EXPORT_STALE_RUNNING_MINUTES} minutes`}::interval`);
  await db.execute(sql`DELETE FROM report_export
    WHERE status IN ('expired', 'failed')
      AND created_at < ${now.toISOString()}::timestamptz - ${`${EXPORT_ROW_RETENTION_DAYS} days`}::interval`);
}
