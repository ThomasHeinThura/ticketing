import { createId } from "@paralleldrive/cuid2";
import { type SQL, sql } from "drizzle-orm";
import db from "../database";
import {
  itemFilterSql,
  num,
  selectRows,
  tsn,
  withReportExecutor,
} from "./context";
import {
  addDays,
  dayFromKey,
  dayKey,
  dayKeysBetween,
  daysToCompute,
  runsOf,
  SNAPSHOT_FAMILY_VERSION,
  SNAPSHOT_METRICS,
  SNAPSHOT_RETENTION_DAYS,
  type SnapshotMetric,
  splitForSnapshots,
  utcDayStart,
} from "./snapshot.logic";
import {
  earliestSnapshotSourceDay,
  liveFactRows,
  type SnapshotFact,
} from "./snapshot-facts";
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
  assignee_id: string | null;
  requester_id: string | null;
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
    ? sql`, p.id AS project_id, p.organisation_id, w.assignee_id, w.requester_id`
    : sql`, NULL::text AS project_id, NULL::text AS organisation_id, w.assignee_id, w.requester_id`;
  const group = scope.perProject
    ? sql`1, 2, 3, 4, 5, 6, 7`
    : sql`1, 2, 3, 6, 7`;
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

function markSnapshotDay(ctx: ReportContext, key: string, at?: Date) {
  if (!ctx.snapshots.sources.snapshotDayKeys.has(key)) {
    ctx.snapshots.sources.snapshotDayKeys.add(key);
    ctx.snapshots.use.snapshotDays += 1;
  }
  if (
    at &&
    (!ctx.snapshots.use.computedAt || at > ctx.snapshots.use.computedAt)
  )
    ctx.snapshots.use.computedAt = at;
  const end = addDays(dayFromKey(key), 1);
  if (!ctx.snapshots.use.throughDay || end > ctx.snapshots.use.throughDay)
    ctx.snapshots.use.throughDay = end;
}

function markUncoveredDay(ctx: ReportContext, key: string) {
  if (!ctx.snapshots.sources.uncoveredDayKeys.has(key)) {
    ctx.snapshots.sources.uncoveredDayKeys.add(key);
    ctx.snapshots.use.uncoveredDays += 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Read path: stored closed days, live for the rest
// ---------------------------------------------------------------------------------------------

function factFilterSql(ctx: ReportContext, metric: SnapshotMetric): SQL {
  const parts: SQL[] = [];
  const { projectId, organisationId, typeId, priority, teamId } = ctx.filters;
  if (projectId && metric !== "kb_deflection")
    parts.push(sql`ms.project_id = ${projectId}`);
  if (organisationId && metric !== "kb_deflection")
    parts.push(sql`p.organisation_id = ${organisationId}`);
  if (
    typeId &&
    !["kb_deflection", "cycle_completion", "escalation_started"].includes(
      metric,
    )
  )
    parts.push(sql`ms.dimensions->>'typeId' = ${typeId}`);
  if (
    priority &&
    !["kb_deflection", "cycle_completion", "escalation_started"].includes(
      metric,
    )
  )
    parts.push(sql`ms.dimensions->>'priority' = ${priority}`);
  if (
    teamId &&
    !["kb_deflection", "cycle_completion", "escalation_started"].includes(
      metric,
    )
  ) {
    const dimensionPredicate =
      metric === "time_logged" || metric === "cost_entry"
        ? sql`pe.id::text = ms.dimensions->>'personId'`
        : sql`pe.id::text = ms.dimensions->>'assigneeId'`;
    parts.push(sql`EXISTS (
      SELECT 1 FROM team_member tm
      JOIN team t ON t.id = tm.team_id AND t.workspace_id = ${ctx.workspaceId}
      JOIN person pe ON pe.user_id = tm.user_id
      WHERE tm.team_id = ${teamId} AND ${dimensionPredicate})`);
  }
  if ((metric === "time_logged" || metric === "cost_entry") && !ctx.readAnyTime)
    parts.push(sql`ms.dimensions->>'personId' = ${ctx.identity.personId}`);
  return parts.length ? sql.join(parts, sql` AND `) : sql`true`;
}

/** Reads stored whole days and fills partial/uncovered days from the same live projection. */
export async function loadFactRows(
  ctx: ReportContext,
  metric: SnapshotMetric,
  from: Date,
  to: Date,
  livePurpose?: string,
): Promise<SnapshotFact[]> {
  if (metric === "cost_entry" && !ctx.showRates) return [];
  const live = async (range: { from: Date; to: Date }) => {
    const result = await liveFactRows(
      metric,
      ctx.workspaceId,
      range.from,
      range.to,
      ctx,
    );
    if (metric === "cycle_completion" && result.length)
      ctx.snapshots.sources.cycleSnapshot = true;
    return result;
  };
  const touchesShown = (range: { from: Date; to: Date }) =>
    range.to > ctx.window.from && range.from < ctx.window.to;
  const markLive = (range: { from: Date; to: Date }, component: string) => {
    if (livePurpose) {
      ctx.snapshots.sources.liveComponents.add(livePurpose);
      if (touchesShown(range)) ctx.snapshots.use.liveParts = true;
    } else if (touchesShown(range)) {
      ctx.snapshots.use.liveParts = true;
      ctx.snapshots.sources.liveComponents.add(component);
    } else ctx.snapshots.sources.liveComponents.add("comparison_period");
  };
  if (!ctx.snapshots.enabled) {
    markLive({ from, to }, "selected_period");
    return live({ from, to });
  }
  const split = splitForSnapshots(from, to, ctx.now);
  const rows: SnapshotFact[] = [];
  const liveRanges = [...split.live];
  for (const range of split.live) markLive(range, "current_period");
  if (split.closed) {
    const coveredRows = await selectRows<{
      day: string;
      computed_at: string | Date;
      facts:
        | Array<{
            projectId: string | null;
            organisationId: string | null;
            dimensions: Record<string, string | null>;
            measures: Record<string, number | string>;
          }>
        | string;
    }>(sql`SELECT to_char(d.period_start AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,
        d.computed_at,
        COALESCE(jsonb_agg(jsonb_build_object('projectId',f.project_id,
          'organisationId',f.organisation_id,'dimensions',f.dimensions,
          'measures',${ctx.showRates ? sql`f.measures` : sql`(f.measures - 'costMinor') - 'budgetCostMinor'`}))
          FILTER (WHERE f.id IS NOT NULL),'[]'::jsonb) AS facts
      FROM metric_snapshot_day d
      LEFT JOIN LATERAL (
        SELECT ms.id, ms.project_id, ms.organisation_id, ms.dimensions, ms.measures
        FROM metric_snapshot ms
        LEFT JOIN project p ON p.id=ms.project_id AND p.workspace_id=ms.workspace_id
        WHERE ms.workspace_id=d.workspace_id AND ms.period_start=d.period_start
          AND ms.grain='day' AND ms.metric_key=${metric}
          AND (ms.project_id IS NULL OR (p.deleted_at IS NULL AND ${ctx.reach}))
          AND ${factFilterSql(ctx, metric)}
      ) f ON true
      WHERE d.workspace_id=${ctx.workspaceId}
        AND d.snapshot_version=${SNAPSHOT_FAMILY_VERSION}
        AND ${markerCurrent("d")}
        AND d.period_start >= ${split.closed.from.toISOString()}::timestamptz
        AND d.period_start < ${split.closed.to.toISOString()}::timestamptz
      GROUP BY d.period_start,d.computed_at`);
    const covered = new Map(
      coveredRows.map((row) => [row.day, new Date(row.computed_at)]),
    );
    const keys = dayKeysBetween(split.closed.from, split.closed.to);
    const missing = keys.filter((key) => !covered.has(key));
    const read = keys.filter((key) => covered.has(key));
    if (read.length) {
      ctx.snapshots.sources.metricSnapshot = true;
      if (metric === "cycle_completion")
        ctx.snapshots.sources.cycleSnapshot = true;
      for (const marker of coveredRows) {
        if (!read.includes(marker.day)) continue;
        const facts =
          typeof marker.facts === "string"
            ? JSON.parse(marker.facts)
            : marker.facts;
        for (const fact of facts)
          rows.push({
            day: marker.day,
            project_id: fact.projectId,
            organisation_id: fact.organisationId,
            dimensions: fact.dimensions,
            measures: Object.fromEntries(
              Object.entries(fact.measures).map(([key, value]) => [
                key,
                num(value),
              ]),
            ),
          });
      }
      for (const key of read) {
        const start = dayFromKey(key);
        if (!touchesShown({ from: start, to: addDays(start, 1) })) continue;
        const computedAt = covered.get(key);
        markSnapshotDay(ctx, key, computedAt);
      }
    }
    for (const key of missing.filter((key) =>
      touchesShown({ from: dayFromKey(key), to: addDays(dayFromKey(key), 1) }),
    )) {
      if (!livePurpose) markUncoveredDay(ctx, key);
    }
    if (missing.length) {
      const shown = missing.some((key) =>
        touchesShown({
          from: dayFromKey(key),
          to: addDays(dayFromKey(key), 1),
        }),
      );
      if (livePurpose) {
        ctx.snapshots.sources.liveComponents.add(livePurpose);
        if (shown) ctx.snapshots.use.liveParts = true;
      } else if (shown) {
        ctx.snapshots.use.liveParts = true;
        ctx.snapshots.sources.liveComponents.add("uncovered_days");
      } else ctx.snapshots.sources.liveComponents.add("comparison_period");
      liveRanges.push(...runsOf(missing));
    }
  }
  // A loop, not push(...rows): spreading a 100k-row result overflows the call stack (P5-R2-02).
  for (const range of liveRanges)
    for (const row of await live(range)) rows.push(row);
  return rows;
}

function snapshotFilterSql(ctx: ReportContext): SQL {
  const parts: SQL[] = [];
  const { projectId, organisationId, typeId, priority, teamId } = ctx.filters;
  if (projectId) parts.push(sql`ms.project_id = ${projectId}`);
  if (organisationId) parts.push(sql`p.organisation_id = ${organisationId}`);
  if (typeId) parts.push(sql`ms.dimensions->>'typeId' = ${typeId}`);
  if (priority) parts.push(sql`ms.dimensions->>'priority' = ${priority}`);
  if (teamId)
    parts.push(sql`EXISTS (
      SELECT 1 FROM team_member tm
      JOIN team t ON t.id = tm.team_id AND t.workspace_id = ${ctx.workspaceId}
      JOIN person pe ON pe.user_id = tm.user_id
      WHERE tm.team_id = ${teamId} AND pe.id::text = ms.dimensions->>'assigneeId')`);
  return parts.length ? sql.join(parts, sql` AND `) : sql`true`;
}

async function storedRowsAndCoverage(
  ctx: ReportContext,
  metric: SnapshotMetric,
  from: Date,
  to: Date,
): Promise<{ rows: LiveRow[]; covered: Map<string, Date> }> {
  const measureA = sql.raw(
    metric === "throughput"
      ? "(ms.measures->>'completed')::numeric"
      : "(ms.measures->>'met')::numeric",
  );
  const measureB =
    metric === "throughput" ? sql`0` : sql`(ms.measures->>'missed')::numeric`;
  const result = await selectRows<
    LiveRow & { computed_at: string | Date }
  >(sql`SELECT
      to_char(d.period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
      d.computed_at, stored.priority,
      NULL::text AS type_id, NULL::text AS assignee_id,
      NULL::text AS project_id, NULL::text AS organisation_id,
      COALESCE(stored.a, 0)::text AS a, COALESCE(stored.b, 0)::text AS b
    FROM metric_snapshot_day d
    LEFT JOIN LATERAL (
      SELECT ms.dimensions->>'priority' AS priority,
        sum(${measureA}) AS a, sum(${measureB}) AS b
      FROM metric_snapshot ms
      JOIN project p ON p.id = ms.project_id AND p.workspace_id = ms.workspace_id
      WHERE ms.workspace_id = d.workspace_id AND ms.period_start = d.period_start
        AND ms.metric_key = ${metric} AND ms.grain = 'day'
        AND p.deleted_at IS NULL AND ${ctx.reach} AND ${snapshotFilterSql(ctx)}
      GROUP BY 1
    ) stored ON true
    WHERE d.workspace_id = ${ctx.workspaceId}
      AND d.snapshot_version = ${SNAPSHOT_FAMILY_VERSION}
      AND ${markerCurrent("d")}
      AND d.period_start >= ${from.toISOString()}::timestamptz
      AND d.period_start < ${to.toISOString()}::timestamptz`);
  return {
    rows: result,
    covered: new Map(result.map((row) => [row.day, new Date(row.computed_at)])),
  };
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
  if (!ctx.snapshots.enabled) {
    if (touchesShown({ from, to })) {
      use.liveParts = true;
      ctx.snapshots.sources.liveComponents.add("current_period");
    } else {
      ctx.snapshots.sources.liveComponents.add("comparison_period");
    }
    return fold(await live({ from, to }));
  }
  const split = splitForSnapshots(from, to, ctx.now);
  const rows: LiveRow[] = [];
  const liveRanges = [...split.live];
  for (const range of split.live) {
    if (touchesShown(range)) {
      use.liveParts = true;
      ctx.snapshots.sources.liveComponents.add("current_period");
    } else {
      ctx.snapshots.sources.liveComponents.add("comparison_period");
    }
  }
  if (split.closed) {
    // Read markers and values in one statement snapshot. Otherwise invalidation could commit
    // between these reads, leaving us with a removed day classified as covered but no rows.
    const stored = await storedRowsAndCoverage(
      ctx,
      metric,
      split.closed.from,
      split.closed.to,
    );
    const covered = stored.covered;
    const closedKeys = dayKeysBetween(split.closed.from, split.closed.to);
    const missing = closedKeys.filter((key) => !covered.has(key));
    const read = closedKeys.filter((key) => covered.has(key));
    if (read.length > 0) {
      ctx.snapshots.sources.metricSnapshot = true;
      for (const row of stored.rows) rows.push(row);
      for (const key of read) {
        const start = dayFromKey(key);
        if (!shown(start)) continue;
        const at = covered.get(key);
        markSnapshotDay(ctx, key, at);
      }
    }
    for (const key of missing.filter((key) => shown(dayFromKey(key))))
      markUncoveredDay(ctx, key);
    if (missing.length > 0) {
      if (missing.some((key) => shown(dayFromKey(key)))) {
        use.liveParts = true;
        ctx.snapshots.sources.liveComponents.add("uncovered_days");
      } else {
        ctx.snapshots.sources.liveComponents.add("comparison_period");
      }
    }
    liveRanges.push(...runsOf(missing));
  }
  // A loop, not push(...rows): spreading a 100k-row result overflows the call stack (P5-R2-02).
  for (const range of liveRanges)
    for (const row of await live(range)) rows.push(row);
  return fold(rows);
}

// ---------------------------------------------------------------------------------------------
// Write path: the `metrics-snapshot` job
// ---------------------------------------------------------------------------------------------

/**
 * A marker is trusted only while the workspace epoch it was computed under is current (sources
 * that can change facts of any day, such as a project, state or KB article update, bump the epoch;
 * 0202), and only while its day's generation is current: every fact write to a closed day bumps
 * `metric_snapshot_day_gen`, whatever the writer's isolation level (0208, P5-R2-05).
 */
function markerCurrent(alias: string): SQL {
  const a = sql.raw(alias);
  return sql`(${a}.epoch = COALESCE((SELECT e.epoch FROM metric_snapshot_epoch e WHERE e.workspace_id = ${a}.workspace_id), 0)
    AND ${a}.gen = COALESCE((SELECT g.gen FROM metric_snapshot_day_gen g
      WHERE g.workspace_id = ${a}.workspace_id AND g.period_start = ${a}.period_start), 0))`;
}

export type SnapshotRunStats = { days: number; rows: number };

/**
 * Replaces the snapshots of each contiguous range of listed closed days under one workspace fence.
 * The aggregates are queried after taking the same fence used by source invalidation, and the day
 * rows and markers are replaced in that transaction. Thus a source mutation either precedes the
 * fresh aggregate read or waits and invalidates the newly written marker after this transaction.
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
  // One transaction per day: the exclusive day lock is held only while that one day is computed,
  // never across a whole backfill, and a day a source write currently holds is left to the next run.
  for (const dayKeyValue of closed) {
    const dayStart = dayFromKey(dayKeyValue);
    const range = { from: dayStart, to: addDays(dayStart, 1) };
    await db.transaction(async (tx) => {
      const locked = await tx.execute<{ ok: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${`metric_snapshot_day:${workspaceId}:${dayKeyValue}`})) AS ok`,
      );
      if (!locked.rows[0]?.ok) return;
      // The writer's own fact DML must not invalidate the day it is about to certify.
      await tx.execute(
        sql`SELECT set_config('taskdesk.snapshot_writer', 'on', true)`,
      );
      // Read under the exclusive day lock, before any fact: the epoch, the day's generation (a fact
      // write that commits later bumps it, so this marker stops being trusted even when that write
      // cannot see the marker, P5-R2-05), and the database clock. A day is certified only once it
      // has ended by the same clock the source trigger uses to decide whether to bump a generation.
      const fenceRows = await tx.execute<{
        epoch: string;
        gen: string;
        closed: boolean;
      }>(
        sql`SELECT COALESCE((SELECT epoch FROM metric_snapshot_epoch WHERE workspace_id = ${workspaceId}), 0) AS epoch,
          COALESCE((SELECT gen FROM metric_snapshot_day_gen
            WHERE workspace_id = ${workspaceId} AND period_start = ${dayStart.toISOString()}::timestamptz), 0) AS gen,
          clock_timestamp() >= ${range.to.toISOString()}::timestamptz AS closed`,
      );
      const fence = fenceRows.rows[0];
      if (!fence?.closed) return;
      const epoch = String(fence.epoch ?? "0");
      const gen = String(fence.gen ?? "0");
      await withReportExecutor(tx, async () => {
        const perMetric = new Map<
          SnapshotMetric,
          Array<{
            day: string;
            project_id: string | null;
            organisation_id: string | null;
            dimensions: Record<string, string | null>;
            measures: Record<string, number>;
          }>
        >();
        for (const metric of SNAPSHOT_METRICS) {
          if (
            metric === "sla_resolution" ||
            metric === "sla_first_response" ||
            metric === "throughput"
          ) {
            const rows = await liveRows(
              metric,
              workspaceId,
              range.from,
              range.to,
              {
                extra: sql`true`,
                perProject: true,
              },
            );
            perMetric.set(
              metric,
              rows.map((row) => {
                const measures: Record<string, number> =
                  metric === "throughput"
                    ? { completed: num(row.a) }
                    : { met: num(row.a), missed: num(row.b) };
                return {
                  day: row.day,
                  project_id: row.project_id,
                  organisation_id: row.organisation_id,
                  dimensions: {
                    priority: row.priority,
                    typeId: row.type_id,
                    assigneeId: row.assignee_id,
                    requesterId: row.requester_id,
                  },
                  measures,
                };
              }),
            );
          } else {
            perMetric.set(
              metric,
              await liveFactRows(metric, workspaceId, range.from, range.to),
            );
          }
        }
        for (const key of dayKeysBetween(range.from, range.to)) {
          const start = dayFromKey(key);
          const end = addDays(start, 1);
          const values: SQL[] = [];
          for (const [metric, rows] of perMetric)
            for (const row of rows) {
              if (row.day !== key) continue;
              values.push(
                sql`(${createId()}, ${workspaceId}, ${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, 'day', ${metric}, ${row.project_id}, ${row.organisation_id}, ${JSON.stringify(row.dimensions)}::jsonb, ${JSON.stringify(row.measures)}::jsonb, now())`,
              );
            }
          await tx.execute(sql`DELETE FROM metric_snapshot
          WHERE workspace_id = ${workspaceId} AND grain = 'day'
            AND period_start = ${start.toISOString()}::timestamptz`);
          for (let i = 0; i < values.length; i += 500)
            await tx.execute(sql`INSERT INTO metric_snapshot
            (id, workspace_id, period_start, period_end, grain, metric_key, project_id, organisation_id, dimensions, measures, computed_at)
            VALUES ${sql.join(values.slice(i, i + 500), sql`, `)}`);
          await tx.execute(sql`INSERT INTO metric_snapshot_day (workspace_id, period_start, computed_at, snapshot_version, epoch, gen)
          VALUES (${workspaceId}, ${start.toISOString()}::timestamptz, now(), ${SNAPSHOT_FAMILY_VERSION}, ${epoch}::bigint, ${gen}::bigint)
          ON CONFLICT (workspace_id, period_start) DO UPDATE
          SET computed_at = now(), snapshot_version = EXCLUDED.snapshot_version, epoch = EXCLUDED.epoch, gen = EXCLUDED.gen`);
          stats.days += 1;
          stats.rows += values.length;
        }
      });
    });
  }
  return stats;
}

/** The days one workspace needs written now: the lookback plus missing days within retention. */
export async function workspaceDaysToWrite(
  workspaceId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const earliest = await earliestSnapshotSourceDay(workspaceId);
  if (!earliest) return [];
  const covered = await selectRows<{ day: string }>(
    sql`SELECT to_char(period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
      FROM metric_snapshot_day d WHERE d.workspace_id = ${workspaceId}
        AND d.snapshot_version = ${SNAPSHOT_FAMILY_VERSION}
        AND ${markerCurrent("d")}`,
  );
  return daysToCompute({
    now,
    covered: new Set(covered.map((row) => row.day)),
    earliest,
  });
}

function dayProtectedByHold(alias: "h" | "ms"): SQL {
  const people = sql`jsonb_each_text(${sql.raw(`${alias}.dimensions`)}) person_dimension`;
  return sql`EXISTS (
    SELECT 1 FROM legal_hold lh
    WHERE lh.lifted_at IS NULL AND (
      (lh.scope = 'person' AND EXISTS (
        SELECT 1 FROM ${people}
        WHERE person_dimension.key IN ('personId','assigneeId','requesterId','creatorId','escalationPersonId')
          AND person_dimension.value = lh.scope_id))
      OR (lh.scope = 'organisation' AND (
        lh.scope_id = ${sql.raw(`${alias}.organisation_id`)}
        OR lh.scope_id = (SELECT w.organisation_id FROM workspace w WHERE w.id = ${sql.raw(`${alias}.workspace_id`)})
        OR EXISTS (
          SELECT 1 FROM ${people}
          JOIN person held_person ON held_person.id = person_dimension.value
          WHERE person_dimension.key IN ('personId','assigneeId','requesterId','creatorId','escalationPersonId')
            AND held_person.organisation_id = lh.scope_id
        )
      )
    )
  ))`;
}

/** Drops complete old days only; any day with a held source person's/org facts is kept intact. */
export async function pruneSnapshots(now: Date = new Date()): Promise<void> {
  const cutoff = addDays(utcDayStart(now), -SNAPSHOT_RETENTION_DAYS);
  const workspaces = await selectRows<{
    workspace_id: string;
  }>(sql`SELECT DISTINCT workspace_id
    FROM metric_snapshot_day WHERE period_start < ${cutoff.toISOString()}::timestamptz`);
  for (const { workspace_id: workspaceId } of workspaces) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE legal_hold IN SHARE MODE`);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`metric_snapshot_workspace:${workspaceId}`}))`,
      );
      await tx.execute(sql`DELETE FROM metric_snapshot ms
        WHERE ms.workspace_id=${workspaceId} AND ms.period_start < ${cutoff.toISOString()}::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM metric_snapshot h
            WHERE h.workspace_id=ms.workspace_id AND h.period_start=ms.period_start
              AND ${dayProtectedByHold("h")})`);
      await tx.execute(sql`DELETE FROM metric_snapshot_day d
        WHERE d.workspace_id=${workspaceId} AND d.period_start < ${cutoff.toISOString()}::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM metric_snapshot h
            WHERE h.workspace_id=d.workspace_id AND h.period_start=d.period_start
              AND ${dayProtectedByHold("h")})`);
      // A day generation outlives nothing it guards: only days whose marker is gone are dropped
      // (a missing generation reads as 0, which can only distrust a marker, never trust one).
      await tx.execute(sql`DELETE FROM metric_snapshot_day_gen g
        WHERE g.workspace_id=${workspaceId} AND g.period_start < ${cutoff.toISOString()}::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM metric_snapshot_day d
            WHERE d.workspace_id=g.workspace_id AND d.period_start=g.period_start)`);
    });
  }
}

export { dayKey };
