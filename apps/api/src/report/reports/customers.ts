import { sql } from "drizzle-orm";
import {
  itemFilterSql,
  itemFrom,
  num,
  selectRows,
  tsn,
  tstz,
} from "../context";
import { countValue, ratePercent, trendOf, utc } from "../logic";
import type { ReportDefinition, Row } from "../types";
import {
  cell,
  col,
  countOutside,
  emptyBody,
  itemsOf,
  MIN,
  weekAxis,
  weekKey,
} from "./shared";

const NO_ORG = "(no organisation)";

function inWindow(column: string, ctx: { window: { from: Date; to: Date } }) {
  return sql`(${sql.raw(column)} >= ${tsn(ctx.window.from)} AND ${sql.raw(column)} < ${tsn(ctx.window.to)})`;
}

const customerPerformance: ReportDefinition = {
  key: "customer_performance",
  category: "customers",
  title: "Performance by customer",
  async compute(ctx) {
    const created = inWindow("w.created_at", ctx);
    const resolved = inWindow("w.resolved_at", ctx);
    const rows = await selectRows<{
      org_id: string | null;
      org: string;
      volume: string;
      resolved: string;
      met: string;
      missed: string;
      fast: string;
      slow: string;
      touched: string;
    }>(sql`SELECT p.organisation_id AS org_id, COALESCE(o.name, ${NO_ORG}) AS org,
        count(*) FILTER (WHERE ${created}) AS volume,
        count(*) FILTER (WHERE ${resolved} AND st."group" = 'completed') AS resolved,
        count(*) FILTER (WHERE ${resolved} AND c.state = 'met') AS met,
        count(*) FILTER (WHERE ${resolved} AND c.state = 'missed') AS missed,
        count(*) FILTER (WHERE ${resolved} AND st."group" = 'completed' AND w.resolved_at - w.created_at < interval '3 days') AS fast,
        count(*) FILTER (WHERE ${resolved} AND st."group" = 'completed' AND w.resolved_at - w.created_at >= interval '14 days') AS slow,
        count(*) AS touched
      ${itemFrom(
        ctx,
        sql`LEFT JOIN organisation o ON o.id = p.organisation_id
          LEFT JOIN work_item_sla_cache c ON c.work_item_id = w.id AND c.metric = 'resolution'`,
      )}
      AND (${created} OR ${resolved})
      GROUP BY 1, 2`);
    const table = rows
      .map((row) => {
        const met = num(row.met);
        const missed = num(row.missed);
        const attainment = ratePercent(met, met + missed, MIN);
        return {
          sort: attainment.value,
          volumeN: num(row.volume),
          row: {
            customer: row.org,
            volume: num(row.volume),
            resolved: num(row.resolved),
            attainment: cell(attainment),
            fast: num(row.fast),
            slow: num(row.slow),
            _drill: row.org_id ?? "none",
          } as Row,
        };
      })
      // Worst first: the lowest attainment leads; customers without enough data follow, busiest first.
      .sort((a, b) => {
        if (a.sort === null && b.sort === null) return b.volumeN - a.volumeN;
        if (a.sort === null) return 1;
        if (b.sort === null) return -1;
        return a.sort - b.sort;
      })
      .slice(0, 200)
      .map((entry) => entry.row);
    const volume = table.reduce((sum, row) => sum + Number(row.volume), 0);
    return emptyBody({
      metrics: [
        {
          key: "customers",
          label: "Customers",
          unit: "count",
          ...countValue(table.length),
        },
        {
          key: "volume",
          label: "Requests raised",
          unit: "count",
          ...countValue(volume),
        },
      ],
      chart:
        volume > 0
          ? {
              type: "bar",
              unit: "count",
              categories: table.slice(0, 10).map((row) => String(row.customer)),
              series: [
                {
                  key: "volume",
                  label: "Requests raised",
                  values: table.slice(0, 10).map((row) => Number(row.volume)),
                },
              ],
            }
          : null,
      columns: [
        col("customer", "Customer"),
        col("volume", "Raised", "number"),
        col("resolved", "Resolved", "number"),
        col("attainment", "SLA attainment", "percent"),
        col("fast", "Resolved in under 3 days", "number"),
        col("slow", "Resolved after 14 days or more", "number"),
      ],
      rows: table,
      population: rows.reduce((sum, row) => sum + num(row.touched), 0),
      outsideWindow: await countOutside(ctx, "created_at"),
      drill: true,
    });
  },
  drillItems: (ctx, handle, limit) =>
    itemsOf(
      ctx,
      sql`(${inWindow("w.created_at", ctx)} OR ${inWindow("w.resolved_at", ctx)})
        AND ${handle ? (handle === "none" ? sql`p.organisation_id IS NULL` : sql`p.organisation_id = ${handle}`) : sql`true`}`,
      limit,
    ),
};

const customerVolumeTrend: ReportDefinition = {
  key: "customer_volume_trend",
  category: "customers",
  title: "Customer volume trend",
  async compute(ctx) {
    const from = ctx.previous.from;
    const rows = await selectRows<{
      org_id: string | null;
      org: string;
      created_at: string | Date;
    }>(sql`SELECT p.organisation_id AS org_id, COALESCE(o.name, ${NO_ORG}) AS org, w.created_at
      ${itemFrom(ctx, sql`LEFT JOIN organisation o ON o.id = p.organisation_id`)}
      AND w.created_at >= ${tsn(from)} AND w.created_at < ${tsn(ctx.window.to)}`);
    const current = new Map<string, number>();
    const previous = new Map<string, number>();
    const ids = new Map<string, string | null>();
    const weekly = new Map<string, Map<string, number>>();
    for (const row of rows) {
      ids.set(row.org, row.org_id);
      const at = utc(row.created_at);
      if (at >= ctx.window.from) {
        current.set(row.org, (current.get(row.org) ?? 0) + 1);
        const perWeek = weekly.get(row.org) ?? new Map<string, number>();
        const key = weekKey(at);
        perWeek.set(key, (perWeek.get(key) ?? 0) + 1);
        weekly.set(row.org, perWeek);
      } else previous.set(row.org, (previous.get(row.org) ?? 0) + 1);
    }
    const orgs = [...new Set([...current.keys(), ...previous.keys()])].sort(
      (a, b) => (current.get(b) ?? 0) - (current.get(a) ?? 0),
    );
    const table: Row[] = orgs.slice(0, 200).map((org) => {
      const now = current.get(org) ?? 0;
      const before = previous.get(org) ?? 0;
      // A change needs a previous period with enough volume to be a comparison (RP-6).
      const change =
        before >= MIN
          ? cell({
              value: Math.round(((now - before) / before) * 1000) / 10,
              n: before,
              needed: MIN,
            })
          : cell({ value: null, n: before, needed: MIN });
      return {
        customer: org,
        volume: now,
        previous: before,
        change,
        _drill: ids.get(org) ?? "none",
      };
    });
    const weeks = weekAxis(ctx);
    const top = orgs.filter((org) => (current.get(org) ?? 0) > 0).slice(0, 5);
    return emptyBody({
      metrics: [
        {
          key: "volume",
          label: "Requests raised",
          unit: "count",
          ...countValue([...current.values()].reduce((a, b) => a + b, 0)),
          trend: trendOf(
            countValue([...current.values()].reduce((a, b) => a + b, 0)),
            countValue([...previous.values()].reduce((a, b) => a + b, 0)),
            1,
          ),
        },
      ],
      chart:
        top.length > 0
          ? {
              type: "line",
              unit: "count",
              categories: weeks,
              series: top.map((org) => ({
                key: ids.get(org) ?? "none",
                label: org,
                values: weeks.map((week) => weekly.get(org)?.get(week) ?? 0),
              })),
            }
          : null,
      columns: [
        col("customer", "Customer"),
        col("volume", "This period", "number"),
        col("previous", "Previous period", "number"),
        col("change", "Change", "percent"),
      ],
      rows: table,
      population: [...current.values()].reduce((a, b) => a + b, 0),
      outsideWindow: [...previous.values()].reduce((a, b) => a + b, 0),
      drill: true,
    });
  },
  drillItems: (ctx, handle, limit) =>
    itemsOf(
      ctx,
      sql`${inWindow("w.created_at", ctx)}
        AND ${handle ? (handle === "none" ? sql`p.organisation_id IS NULL` : sql`p.organisation_id = ${handle}`) : sql`true`}`,
      limit,
    ),
};

const satisfaction: ReportDefinition = {
  key: "satisfaction",
  category: "customers",
  title: "Satisfaction",
  async compute(ctx) {
    const by = ctx.options.by === "request_type" ? "request_type" : "customer";
    const label =
      by === "customer"
        ? sql`COALESCE(o.name, ${NO_ORG})`
        : sql`COALESCE(rt.name, '(not raised through a request type)')`;
    const rows = await selectRows<{
      label: string;
      ratings: string;
      satisfied: string;
      s1: string;
      s2: string;
      s3: string;
      s4: string;
      s5: string;
    }>(sql`SELECT ${label} AS label, count(*) AS ratings,
        count(*) FILTER (WHERE sr.score >= 4) AS satisfied,
        count(*) FILTER (WHERE sr.score = 1) AS s1,
        count(*) FILTER (WHERE sr.score = 2) AS s2,
        count(*) FILTER (WHERE sr.score = 3) AS s3,
        count(*) FILTER (WHERE sr.score = 4) AS s4,
        count(*) FILTER (WHERE sr.score = 5) AS s5
      FROM satisfaction_rating sr
      JOIN work_item w ON w.id = sr.work_item_id
      JOIN project p ON p.id = w.project_id
      LEFT JOIN organisation o ON o.id = p.organisation_id
      LEFT JOIN submission sub ON sub.work_item_id = w.id
      LEFT JOIN request_type rt ON rt.id = sub.request_type_id
      WHERE w.workspace_id = ${ctx.workspaceId}
        AND w.deleted_at IS NULL AND p.deleted_at IS NULL
        AND ${ctx.reach}
        AND ${itemFilterSql(ctx)}
        AND sr.created_at >= ${tstz(ctx.window.from)} AND sr.created_at < ${tstz(ctx.window.to)}
      GROUP BY 1 ORDER BY count(*) DESC LIMIT 200`);
    const total = rows.reduce((sum, row) => sum + num(row.ratings), 0);
    const satisfied = rows.reduce((sum, row) => sum + num(row.satisfied), 0);
    const overall = ratePercent(satisfied, total, MIN);
    const table: Row[] = rows.map((row) => ({
      [by]: row.label,
      ratings: num(row.ratings),
      satisfied: cell(ratePercent(num(row.satisfied), num(row.ratings), MIN)),
      s1: num(row.s1),
      s2: num(row.s2),
      s3: num(row.s3),
      s4: num(row.s4),
      s5: num(row.s5),
    }));
    return emptyBody({
      metrics: [
        {
          key: "csat",
          label: "Satisfied (4 or 5)",
          unit: "percent",
          ...overall,
        },
        {
          key: "ratings",
          label: "Ratings",
          unit: "count",
          ...countValue(total),
        },
      ],
      chart:
        total > 0
          ? {
              type: "bar",
              unit: "count",
              categories: ["1", "2", "3", "4", "5"],
              series: [
                {
                  key: "ratings",
                  label: "Ratings",
                  values: ["s1", "s2", "s3", "s4", "s5"].map((key) =>
                    rows.reduce(
                      (sum, row) =>
                        sum + num((row as Record<string, string>)[key]),
                      0,
                    ),
                  ),
                },
              ],
            }
          : null,
      columns: [
        col(by, by === "customer" ? "Customer" : "Request type"),
        col("ratings", "Ratings", "number"),
        col("satisfied", "Satisfied (4 or 5)", "percent"),
        col("s1", "1", "number"),
        col("s2", "2", "number"),
        col("s3", "3", "number"),
        col("s4", "4", "number"),
        col("s5", "5", "number"),
      ],
      rows: table,
      population: total,
      outsideWindow: 0,
    });
  },
};

export const customerReports: ReportDefinition[] = [
  customerPerformance,
  customerVolumeTrend,
  satisfaction,
];
