import { sql } from "drizzle-orm";
import { itemFilterSql, num, selectRows, tsn } from "../context";
import { countValue, ratePercent, type Sampled, trendOf, utc } from "../logic";
import { type DailyRow, loadDaily, loadFactRows } from "../snapshot.repository";
import type { ReportContext, ReportDefinition, Row } from "../types";
import {
  cell,
  col,
  countOutside,
  emptyBody,
  itemsOf,
  MIN,
  pageLimit,
  pageRows,
  weekAxis,
  weekKey,
} from "./shared";

/** `resolution` (default) or `first_response`: which SLA clock a report reads. */
function metricOf(ctx: ReportContext): "resolution" | "first_response" {
  return ctx.options.metric === "first_response"
    ? "first_response"
    : "resolution";
}

/** The instant an item's clock was settled: when it was resolved, or first answered. */
function settledAt(metric: "resolution" | "first_response") {
  return metric === "resolution"
    ? sql`w.resolved_at`
    : sql`w.first_response_at`;
}

/**
 * Settled SLA outcomes per day and priority over `[from, to)` (RP-9): closed days come from the
 * stored snapshots, the current day and any partial edge are computed live.
 */
function outcomeRows(
  ctx: ReportContext,
  from: Date,
  to: Date,
): Promise<DailyRow[]> {
  return loadDaily(
    ctx,
    metricOf(ctx) === "resolution" ? "sla_resolution" : "sla_first_response",
    from,
    to,
  );
}

const sumMet = (rows: DailyRow[]) =>
  rows.reduce((total, row) => total + row.a, 0);
const sumMissed = (rows: DailyRow[]) =>
  rows.reduce((total, row) => total + row.b, 0);
const settledCount = (rows: DailyRow[]) => sumMet(rows) + sumMissed(rows);

function attainmentOf(rows: DailyRow[]): Sampled {
  return ratePercent(sumMet(rows), settledCount(rows), MIN);
}

const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

async function policyVersionsChanged(ctx: ReportContext): Promise<boolean> {
  const [row] = await selectRows<{
    n: string;
  }>(sql`SELECT count(DISTINCT w.sla_policy_version_id) AS n
    FROM work_item w
    JOIN project p ON p.id = w.project_id
    WHERE w.workspace_id = ${ctx.workspaceId}
      AND w.deleted_at IS NULL AND p.deleted_at IS NULL
      AND ${ctx.reach} AND ${itemFilterSql(ctx)}
      AND w.sla_policy_version_id IS NOT NULL
      AND w.resolved_at >= ${tsn(ctx.window.from)} AND w.resolved_at < ${tsn(ctx.window.to)}`);
  return num(row?.n) > 1;
}

async function slaOutsideWindow(ctx: ReportContext): Promise<number> {
  return countOutside(
    ctx,
    ctx.options.metric === "first_response" ? "created_at" : "resolved_at",
    sql`EXISTS (SELECT 1 FROM work_item_sla_cache cx WHERE cx.work_item_id = w.id AND cx.state IN ('met', 'missed'))`,
  );
}

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;

const slaAttainment: ReportDefinition = {
  key: "sla_attainment",
  category: "promises",
  title: "SLA attainment",
  feature: "feature.sla",
  async compute(ctx) {
    const now = await outcomeRows(ctx, ctx.window.from, ctx.window.to);
    const before = await outcomeRows(ctx, ctx.previous.from, ctx.previous.to);
    const overall = attainmentOf(now);
    const rows: Row[] = [];
    for (const priority of PRIORITIES) {
      const subset = now.filter((row) => row.priority === priority);
      if (settledCount(subset) === 0) continue;
      rows.push({
        priority,
        met: sumMet(subset),
        missed: sumMissed(subset),
        attainment: cell(attainmentOf(subset)),
        _drill: priority,
      });
    }
    const other = now.filter(
      (row) => !PRIORITIES.includes(row.priority as never),
    );
    if (settledCount(other) > 0) {
      rows.push({
        priority: "none",
        met: sumMet(other),
        missed: sumMissed(other),
        attainment: cell(attainmentOf(other)),
        _drill: "none",
      });
    }
    const notes: string[] = [];
    if (await policyVersionsChanged(ctx)) notes.push("sla_policy_changed");
    return emptyBody({
      metrics: [
        {
          key: "attainment",
          label: "Attainment",
          unit: "percent",
          ...overall,
          trend: trendOf(overall, attainmentOf(before)),
        },
        {
          key: "met",
          label: "Met",
          unit: "count",
          ...countValue(sumMet(now)),
        },
        {
          key: "missed",
          label: "Missed",
          unit: "count",
          ...countValue(sumMissed(now)),
        },
      ],
      chart:
        rows.length > 0
          ? {
              type: "bar",
              unit: "count",
              categories: rows.map((row) => String(row.priority)),
              series: [
                {
                  key: "met",
                  label: "Met",
                  values: rows.map((row) => Number(row.met)),
                },
                {
                  key: "missed",
                  label: "Missed",
                  values: rows.map((row) => Number(row.missed)),
                },
              ],
            }
          : null,
      columns: [
        col("priority", "Priority"),
        col("met", "Met", "number"),
        col("missed", "Missed", "number"),
        col("attainment", "Attainment", "percent"),
      ],
      rows,
      population: settledCount(now),
      outsideWindow: await slaOutsideWindow(ctx),
      notes,
      drill: true,
    });
  },
  drillItems: (ctx, handle, limit) =>
    itemsOf(
      ctx,
      sql`EXISTS (SELECT 1 FROM work_item_sla_cache c WHERE c.work_item_id = w.id AND c.metric = ${metricOf(ctx)} AND c.state IN ('met', 'missed'))
        AND ${settledAt(metricOf(ctx))} >= ${tsn(ctx.window.from)} AND ${settledAt(metricOf(ctx))} < ${tsn(ctx.window.to)}
        AND ${handle ? (handle === "none" ? sql`w.priority IS NULL` : sql`w.priority = ${handle}`) : sql`true`}`,
      limit,
    ),
};

const slaTrend: ReportDefinition = {
  key: "sla_trend",
  category: "promises",
  title: "SLA trend",
  feature: "feature.sla",
  async compute(ctx) {
    const now = await outcomeRows(ctx, ctx.window.from, ctx.window.to);
    const before = await outcomeRows(ctx, ctx.previous.from, ctx.previous.to);
    const weeks = weekAxis(ctx);
    const byWeek = new Map<string, DailyRow[]>();
    for (const row of now) {
      const key = weekKey(dayDate(row.day));
      byWeek.set(key, [...(byWeek.get(key) ?? []), row]);
    }
    // A week with fewer than the minimum is a null point: the line has a gap, not a 0% or 100%.
    const weekly = weeks.map((week) => {
      const subset = byWeek.get(week) ?? [];
      return { week, subset, value: attainmentOf(subset) };
    });
    const overall = attainmentOf(now);
    return emptyBody({
      metrics: [
        {
          key: "attainment",
          label: "Attainment",
          unit: "percent",
          ...overall,
          trend: trendOf(overall, attainmentOf(before)),
        },
      ],
      chart:
        settledCount(now) > 0
          ? {
              type: "line",
              unit: "percent",
              categories: weeks,
              series: [
                {
                  key: "attainment",
                  label: "Attainment",
                  values: weekly.map((entry) => entry.value.value),
                },
              ],
            }
          : null,
      columns: [
        col("week", "Week starting", "date"),
        col("settled", "Settled", "number"),
        col("attainment", "Attainment", "percent"),
      ],
      rows: weekly.map((entry) => ({
        week: entry.week,
        settled: settledCount(entry.subset),
        attainment: cell(entry.value),
        _drill: entry.week,
      })),
      population: settledCount(now),
      outsideWindow: await slaOutsideWindow(ctx),
      notes: (await policyVersionsChanged(ctx)) ? ["sla_policy_changed"] : [],
      drill: true,
    });
  },
  drillItems: (ctx, handle, limit) => {
    const from = handle ? new Date(`${handle}T00:00:00.000Z`) : ctx.window.from;
    const to = handle
      ? new Date(from.getTime() + 7 * 86_400_000)
      : ctx.window.to;
    return itemsOf(
      ctx,
      sql`EXISTS (SELECT 1 FROM work_item_sla_cache c WHERE c.work_item_id = w.id AND c.metric = ${metricOf(ctx)} AND c.state IN ('met', 'missed'))
        AND ${settledAt(metricOf(ctx))} >= ${tsn(from)} AND ${settledAt(metricOf(ctx))} < ${tsn(to)}`,
      limit,
    );
  },
};

const breachAnalysis: ReportDefinition = {
  key: "breach_analysis",
  category: "promises",
  title: "Breach analysis",
  feature: "feature.sla",
  pagedExport: true,
  async compute(ctx) {
    const by =
      ctx.options.by === "priority" || ctx.options.by === "customer"
        ? ctx.options.by
        : "type";
    const metric = metricOf(ctx);
    const facts = await loadFactRows(
      ctx,
      "sla_due_outcome",
      ctx.window.from,
      ctx.window.to,
    );
    const dimensionIds = [
      ...new Set(
        facts
          .map((fact) =>
            by === "type"
              ? fact.dimensions.typeId
              : by === "customer"
                ? fact.organisation_id
                : null,
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const labels = dimensionIds.length
      ? by === "type"
        ? await selectRows<{ id: string; name: string }>(
            sql`SELECT id,name FROM work_item_type WHERE id IN (${sql.join(
              dimensionIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          )
        : by === "customer"
          ? await selectRows<{ id: string; name: string }>(
              sql`SELECT id,name FROM organisation WHERE id IN (${sql.join(
                dimensionIds.map((id) => sql`${id}`),
                sql`, `,
              )})`,
            )
          : []
      : [];
    const labelById = new Map(labels.map((row) => [row.id, row.name]));
    const grouped = new Map<
      string,
      { label: string; breached: number; total: number }
    >();
    for (const fact of facts) {
      if (
        fact.dimensions.metric !== metric ||
        !["met", "missed", "breached"].includes(fact.dimensions.state ?? "")
      )
        continue;
      const id =
        by === "type"
          ? fact.dimensions.typeId
          : by === "customer"
            ? fact.organisation_id
            : fact.dimensions.priority;
      const label = id
        ? (labelById.get(id) ?? (by === "priority" ? id : `(no ${by})`))
        : by === "priority"
          ? "none"
          : `(no ${by})`;
      const row = grouped.get(label) ?? { label, breached: 0, total: 0 };
      const count = fact.measures.count ?? 0;
      row.total += count;
      if (
        fact.dimensions.state === "missed" ||
        fact.dimensions.state === "breached"
      )
        row.breached += count;
      grouped.set(label, row);
    }
    const allRows = [...grouped.values()].sort(
      (a, b) =>
        b.breached - a.breached ||
        b.total - a.total ||
        a.label.localeCompare(b.label),
    );
    const pageInput = ctx.exportPage
      ? allRows.slice(
          ctx.exportPage.offset,
          ctx.exportPage.offset + ctx.exportPage.limit,
        )
      : allRows.slice(0, 101);
    const page = pageRows(ctx, pageInput, 100);
    const table: Row[] = page.rows.map((row) => {
      const breached = num(row.breached);
      const total = num(row.total);
      return {
        [by]: row.label,
        breached,
        total,
        rate: cell(ratePercent(breached, total, MIN)),
        _drill: row.label,
      };
    });
    const breachedTotal = table.reduce(
      (sum, row) => sum + Number(row.breached),
      0,
    );
    return emptyBody({
      metrics: [
        {
          key: "breaches",
          label: "Breaches",
          unit: "count",
          ...countValue(breachedTotal),
        },
      ],
      chart:
        breachedTotal > 0
          ? {
              type: "bar",
              unit: "count",
              categories: table.slice(0, 10).map((row) => String(row[by])),
              series: [
                {
                  key: "breached",
                  label: "Breached",
                  values: table.slice(0, 10).map((row) => Number(row.breached)),
                },
              ],
            }
          : null,
      columns: [
        col(
          by,
          by === "type" ? "Type" : by === "priority" ? "Priority" : "Customer",
        ),
        col("breached", "Breached", "number"),
        col("total", "Due in window", "number"),
        col("rate", "Breach rate", "percent"),
      ],
      rows: table,
      truncated: page.truncated,
      population: table.reduce((sum, row) => sum + Number(row.total), 0),
      outsideWindow: 0,
      notes: (await policyVersionsChanged(ctx)) ? ["sla_policy_changed"] : [],
      drill: false,
    });
  },
};

const atRiskNow: ReportDefinition = {
  key: "at_risk_now",
  category: "promises",
  title: "At-risk now",
  feature: "feature.sla",
  live: true,
  pagedExport: true,
  async compute(ctx) {
    const rows = await selectRows<{
      key: string;
      title: string;
      project_key: string;
      assignee: string | null;
      metric: string;
      state: string;
      due_at: string | Date | null;
    }>(sql`SELECT w.key, w.title, p.slug AS project_key, pe.display_name AS assignee,
        c.metric, c.state, c.due_at
      FROM work_item w
      JOIN project p ON p.id = w.project_id
      JOIN work_item_sla_cache c ON c.work_item_id = w.id
      JOIN state s ON s.id = w.state_id
      JOIN state_template st ON st.id = s.state_template_id
      LEFT JOIN person pe ON pe.id = w.assignee_id
      WHERE w.workspace_id = ${ctx.workspaceId}
        AND w.deleted_at IS NULL AND p.deleted_at IS NULL
        AND ${ctx.reach} AND ${itemFilterSql(ctx)}
        AND c.state IN ('at_risk', 'breached')
        AND st."group" NOT IN ('completed', 'cancelled')
      ORDER BY c.state = 'breached' DESC, c.due_at ASC NULLS LAST, w.id, c.metric
      ${pageLimit(ctx, 200)}`);
    const page = pageRows(ctx, rows, 200);
    const table: Row[] = page.rows.map((row) => ({
      key: row.key,
      title: row.title,
      project: row.project_key,
      assignee: row.assignee,
      metric: row.metric,
      state: row.state,
      due: row.due_at ? utc(row.due_at).toISOString() : null,
    }));
    const breached = page.rows.filter((row) => row.state === "breached").length;
    return emptyBody({
      metrics: [
        {
          key: "at_risk",
          label: "At risk",
          unit: "count",
          ...countValue(page.rows.length - breached),
        },
        {
          key: "breached",
          label: "Already breached",
          unit: "count",
          ...countValue(breached),
        },
      ],
      columns: [
        col("key", "Key"),
        col("title", "Title"),
        col("project", "Project"),
        col("assignee", "Assignee"),
        col("metric", "Clock"),
        col("state", "State"),
        col("due", "Due", "date"),
      ],
      rows: table,
      population: page.rows.length,
      truncated: page.truncated,
      notes: [],
      drill: true,
    });
  },
  drillItems: (ctx, _handle, limit) =>
    itemsOf(
      ctx,
      sql`EXISTS (SELECT 1 FROM work_item_sla_cache c WHERE c.work_item_id = w.id AND c.state IN ('at_risk', 'breached'))
        AND st."group" NOT IN ('completed', 'cancelled')`,
      limit,
      sql`w.created_at ASC`,
    ),
};

export const promiseReports: ReportDefinition[] = [
  slaAttainment,
  slaTrend,
  breachAnalysis,
  atRiskNow,
];
