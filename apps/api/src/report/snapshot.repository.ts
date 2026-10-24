import { createId } from "@paralleldrive/cuid2";
import { type SQL, sql } from "drizzle-orm";
import db from "../database";
import { itemFilterSql, num, selectRows, tsn } from "./context";
import {
  addDays,
  dayFromKey,
  dayKey,
  dayKeysBetween,
  daysToCompute,
  runsOf,
  SNAPSHOT_METRICS,
  SNAPSHOT_RETENTION_DAYS,
  type SnapshotMetric,
  splitForSnapshots,
  utcDayStart,
} from "./snapshot.logic";
import type { ReportContext } from "./types";

/**
 * One metric on one day (and, for a priority split, one priority). For the SLA metrics `a` is the
 * items that met their clock and `b` the ones that missed it; for throughput `a` is the items
 * completed and `b` is 0.
 */
export type DailyRow = {
  day: string;
  priority: string | null;
  a: number;
  b: number;
};

type LiveRow = {
  day: string;
  priority: string | null;
  type_id: string | null;
  project_id: string | null;
  organisation_id: string | null;
  a: string;
  b: string;
};

function slaClock(metric: SnapshotMetric): "resolution" | "first_response" {
  return metric === "sla_first_response" ? "first_response" : "resolution";
}

function settledColumn(metric: SnapshotMetric): SQL {
  return metric === "sla_first_response"
    ? sql`w.first_response_at`
    : sql`w.resolved_at`;
}

/**
 * The one definition of each metric, used by the job (every project, every day) and by a live read
 * (the caller's reach and filters), so a stored day and a live day can only differ because the data
 * changed in between, never because two queries disagree.
 */
async function liveRows(
  metric: SnapshotMetric,
  workspaceId: string,
  from: Date,
  to: Date,
  scope: { extra: SQL; perProject: boolean },
): Promise<LiveRow[]> {
  const settled = settledColumn(metric);
  const projectColumns = scope.perProject
    ? sql`, p.id AS project_id, p.organisation_id`
    : sql`, NULL::text AS project_id, NULL::text AS organisation_id`;
  const group = scope.perProject ? sql`1, 2, 3, 4, 5` : sql`1, 2, 3`;
  const types = sql`, w.type_id`;
  if (metric === "throughput")
    return selectRows<LiveRow>(sql`SELECT to_char(${settled}, 'YYYY-MM-DD') AS day, w.priority${types}${projectColumns},
        count(*) AS a, 0 AS b
      FROM work_item w
      JOIN project p ON p.id = w.project_id
      JOIN state s ON s.id = w.state_id
      JOIN state_template st ON st.id = s.state_template_id
      WHERE w.workspace_id = ${workspaceId}
        AND w.deleted_at IS NULL AND p.deleted_at IS NULL
        AND st."group" = 'completed'
        AND ${scope.extra}
        AND ${settled} >= ${tsn(from)} AND ${settled} < ${tsn(to)}
      GROUP BY ${group}`);
  return selectRows<LiveRow>(sql`SELECT to_char(${settled}, 'YYYY-MM-DD') AS day, w.priority${types}${projectColumns},
      count(*) FILTER (WHERE c.state = 'met') AS a,
      count(*) FILTER (WHERE c.state = 'missed') AS b
    FROM work_item w
    JOIN project p ON p.id = w.project_id
    JOIN work_item_sla_cache c ON c.work_item_id = w.id AND c.metric = ${slaClock(metric)}
    WHERE w.workspace_id = ${workspaceId}
      AND w.deleted_at IS NULL AND p.deleted_at IS NULL
      AND c.state IN ('met', 'missed')
      AND ${scope.extra}
      AND ${settled} >= ${tsn(from)} AND ${settled} < ${tsn(to)}
    GROUP BY ${group}`);
}

function fold(rows: LiveRow[]): DailyRow[] {
  const byKey = new Map<string, DailyRow>();
  for (const row of rows) {
    const key = `${row.day}|${row.priority ?? ""}`;
    const entry = byKey.get(key) ?? {
      day: row.day,
      priority: row.priority,
      a: 0,
      b: 0,
    };
    entry.a += num(row.a);
    entry.b += num(row.b);
    byKey.set(key, entry);
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------------------------
// Read path: stored closed days, live for the rest
// ---------------------------------------------------------------------------------------------

/** A filter the stored dimensions cannot answer (`teamId` follows current team membership). */
export function filtersNeedLive(ctx: ReportContext): boolean {
  return Boolean(ctx.filters.teamId);
}

function snapshotFilterSql(ctx: ReportContext): SQL {
  const parts: SQL[] = [];
  const { projectId, organisationId, typeId, priority } = ctx.filters;
  if (projectId) parts.push(sql`ms.project_id = ${projectId}`);
  if (organisationId) parts.push(sql`p.organisation_id = ${organisationId}`);
  if (typeId) parts.push(sql`ms.dimensions->>'typeId' = ${typeId}`);
  if (priority) parts.push(sql`ms.dimensions->>'priority' = ${priority}`);
  return parts.length ? sql.join(parts, sql` AND `) : sql`true`;
}

async function coveredDays(
  workspaceId: string,
  from: Date,
  to: Date,
): Promise<Map<string, Date>> {
  const rows = await selectRows<{ day: string; computed_at: string | Date }>(
    sql`SELECT to_char(d.period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, d.computed_at
      FROM metric_snapshot_day d
      WHERE d.workspace_id = ${workspaceId}
        AND d.period_start >= ${from.toISOString()}::timestamptz
        AND d.period_start < ${to.toISOString()}::timestamptz`,
  );
  return new Map(rows.map((row) => [row.day, new Date(row.computed_at)]));
}

async function storedRows(
  ctx: ReportContext,
  metric: SnapshotMetric,
  from: Date,
  to: Date,
): Promise<LiveRow[]> {
  const measureA = sql.raw(
    metric === "throughput"
      ? "(ms.measures->>'completed')::numeric"
      : "(ms.measures->>'met')::numeric",
  );
  const measureB =
    metric === "throughput" ? sql`0` : sql`(ms.measures->>'missed')::numeric`;
  return selectRows<LiveRow>(sql`SELECT to_char(ms.period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
      ms.dimensions->>'priority' AS priority, NULL::text AS type_id,
      NULL::text AS project_id, NULL::text AS organisation_id,
      sum(${measureA}) AS a, sum(${measureB}) AS b
    FROM metric_snapshot ms
    JOIN metric_snapshot_day d ON d.workspace_id = ms.workspace_id AND d.period_start = ms.period_start
    JOIN project p ON p.id = ms.project_id AND p.workspace_id = ms.workspace_id
    WHERE ms.workspace_id = ${ctx.workspaceId}
      AND ms.metric_key = ${metric} AND ms.grain = 'day'
      AND ms.period_start >= ${from.toISOString()}::timestamptz
      AND ms.period_start < ${to.toISOString()}::timestamptz
      AND p.deleted_at IS NULL AND ${ctx.reach} AND ${snapshotFilterSql(ctx)}
    GROUP BY 1, 2`);
}

/**
 * RP-9: the daily rows of `metric` over `[from, to)`. Whole closed days that the job has computed
 * come from `metric_snapshot` (through the caller's reach and filters); the current day, a partial
 * first day and any closed day without a snapshot are computed live with the same definition. What
 * was stored and what was live is recorded on `ctx.snapshots.use`, which the envelope states.
 */
export async function loadDaily(
  ctx: ReportContext,
  metric: SnapshotMetric,
  from: Date,
  to: Date,
): Promise<DailyRow[]> {
  const live = (range: { from: Date; to: Date }) =>
    liveRows(metric, ctx.workspaceId, range.from, range.to, {
      extra: sql`${ctx.reach} AND ${itemFilterSql(ctx)}`,
      perProject: false,
    });
  // The boundary the report states is about the window it shows, not its comparison period.
  const shown = (start: Date) =>
    start >= ctx.window.from && start < ctx.window.to;
  const touchesShown = (range: { from: Date; to: Date }) =>
    range.to > ctx.window.from && range.from < ctx.window.to;
  const use = ctx.snapshots.use;
  if (!ctx.snapshots.enabled || filtersNeedLive(ctx)) {
    if (touchesShown({ from, to })) use.liveParts = true;
    return fold(await live({ from, to }));
  }
  const split = splitForSnapshots(from, to, ctx.now);
  const rows: LiveRow[] = [];
  const liveRanges = [...split.live];
  if (split.live.some(touchesShown)) use.liveParts = true;
  if (split.closed) {
    const covered = await coveredDays(
      ctx.workspaceId,
      split.closed.from,
      split.closed.to,
    );
    const closedKeys = dayKeysBetween(split.closed.from, split.closed.to);
    const missing = closedKeys.filter((key) => !covered.has(key));
    const read = closedKeys.filter((key) => covered.has(key));
    if (read.length > 0) {
      rows.push(
        ...(await storedRows(ctx, metric, split.closed.from, split.closed.to)),
      );
      for (const key of read) {
        const start = dayFromKey(key);
        if (!shown(start)) continue;
        use.snapshotDays += 1;
        const at = covered.get(key);
        if (at && (!use.computedAt || at > use.computedAt)) use.computedAt = at;
        const end = addDays(start, 1);
        if (!use.throughDay || end > use.throughDay) use.throughDay = end;
      }
    }
    use.uncoveredDays += missing.filter((key) => shown(dayFromKey(key))).length;
    liveRanges.push(...runsOf(missing));
  }
  for (const range of liveRanges) rows.push(...(await live(range)));
  return fold(rows);
}

// ---------------------------------------------------------------------------------------------
// Write path: the `metrics-snapshot` job
// ---------------------------------------------------------------------------------------------

export type SnapshotRunStats = { days: number; rows: number };

/**
 * Replaces the snapshot of each listed closed day of one workspace. Each day is one transaction
 * (delete the day, insert its rows, upsert the marker) under an advisory lock, so a second run, or a
 * reader, sees a day whole or not at all, and running it twice leaves exactly the same rows.
 */
export async function writeWorkspaceDays(
  workspaceId: string,
  keys: readonly string[],
  now: Date = new Date(),
): Promise<SnapshotRunStats> {
  const stats: SnapshotRunStats = { days: 0, rows: 0 };
  // Today (and anything later) is never stored: only a finished UTC day is a closed period.
  const today = utcDayStart(now);
  const closed = keys.filter((key) => dayFromKey(key) < today);
  for (const range of runsOf(closed)) {
    const perMetric = new Map<SnapshotMetric, LiveRow[]>();
    for (const metric of SNAPSHOT_METRICS)
      perMetric.set(
        metric,
        await liveRows(metric, workspaceId, range.from, range.to, {
          extra: sql`true`,
          perProject: true,
        }),
      );
    for (const key of dayKeysBetween(range.from, range.to)) {
      const start = dayFromKey(key);
      const end = addDays(start, 1);
      const values: SQL[] = [];
      for (const [metric, rows] of perMetric)
        for (const row of rows) {
          if (row.day !== key || !row.project_id) continue;
          const measures =
            metric === "throughput"
              ? { completed: num(row.a) }
              : { met: num(row.a), missed: num(row.b) };
          values.push(
            sql`(${createId()}, ${workspaceId}, ${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, 'day', ${metric}, ${row.project_id}, ${row.organisation_id}, ${JSON.stringify({ priority: row.priority, typeId: row.type_id })}::jsonb, ${JSON.stringify(measures)}::jsonb, now())`,
          );
        }
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`metric_snapshot:${workspaceId}:${key}`}))`,
        );
        await tx.execute(sql`DELETE FROM metric_snapshot
          WHERE workspace_id = ${workspaceId} AND grain = 'day'
            AND period_start = ${start.toISOString()}::timestamptz`);
        for (let i = 0; i < values.length; i += 500)
          await tx.execute(sql`INSERT INTO metric_snapshot
            (id, workspace_id, period_start, period_end, grain, metric_key, project_id, organisation_id, dimensions, measures, computed_at)
            VALUES ${sql.join(values.slice(i, i + 500), sql`, `)}`);
        await tx.execute(sql`INSERT INTO metric_snapshot_day (workspace_id, period_start, computed_at)
          VALUES (${workspaceId}, ${start.toISOString()}::timestamptz, now())
          ON CONFLICT (workspace_id, period_start) DO UPDATE SET computed_at = now()`);
      });
      stats.days += 1;
      stats.rows += values.length;
    }
  }
  return stats;
}

/** The days one workspace needs written now: the lookback plus missing days within retention. */
export async function workspaceDaysToWrite(
  workspaceId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const [first] = await selectRows<{ at: string | Date | null }>(
    sql`SELECT least(min(created_at), min(resolved_at), min(first_response_at)) AS at
      FROM work_item WHERE workspace_id = ${workspaceId}`,
  );
  if (!first?.at) return [];
  const earliest = new Date(
    typeof first.at === "string" && !/(Z|[+-]\d\d(:?\d\d)?)$/.test(first.at)
      ? `${first.at.replace(" ", "T")}Z`
      : first.at,
  );
  const covered = await selectRows<{ day: string }>(
    sql`SELECT to_char(period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
      FROM metric_snapshot_day WHERE workspace_id = ${workspaceId}`,
  );
  return daysToCompute({
    now,
    covered: new Set(covered.map((row) => row.day)),
    earliest,
  });
}

/** Drops days past retention (a pruned day is read live, so this never changes a number). */
export async function pruneSnapshots(now: Date = new Date()): Promise<void> {
  const cutoff = addDays(utcDayStart(now), -SNAPSHOT_RETENTION_DAYS);
  await db.execute(
    sql`DELETE FROM metric_snapshot WHERE period_start < ${cutoff.toISOString()}::timestamptz`,
  );
  await db.execute(
    sql`DELETE FROM metric_snapshot_day WHERE period_start < ${cutoff.toISOString()}::timestamptz`,
  );
}

export { dayKey };
