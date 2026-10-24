import { sql } from "drizzle-orm";
import { itemFrom, num, OPEN, selectRows, tsn } from "../context";
import {
  AGE_BUCKETS,
  bucketCounts,
  bucketOf,
  countValue,
  DAY_MS,
  DURATION_BUCKETS,
  ratePercent,
  trendOf,
  utc,
} from "../logic";
import type { ReportDefinition, Row } from "../types";
import {
  col,
  countOutside,
  emptyBody,
  itemsOf,
  MIN,
  weekAxis,
  weekKey,
} from "./shared";

const DONE = sql`st."group" = 'completed'`;

function resolvedIn(from: Date, to: Date) {
  return sql`w.resolved_at >= ${tsn(from)} AND w.resolved_at < ${tsn(to)}`;
}

const throughput: ReportDefinition = {
  key: "throughput",
  category: "delivery",
  title: "Throughput",
  async compute(ctx) {
    const rows = await selectRows<{
      resolved_at: string | Date;
    }>(sql`SELECT w.resolved_at
      ${itemFrom(ctx)} AND ${DONE}
      AND ${resolvedIn(ctx.previous.from, ctx.window.to)}`);
    const weeks = weekAxis(ctx);
    const perWeek = new Map<string, number>();
    let current = 0;
    let before = 0;
    for (const row of rows) {
      const at = utc(row.resolved_at);
      if (at >= ctx.window.from) {
        current += 1;
        const key = weekKey(at);
        perWeek.set(key, (perWeek.get(key) ?? 0) + 1);
      } else before += 1;
    }
    return emptyBody({
      metrics: [
        {
          key: "completed",
          label: "Items completed",
          unit: "count",
          ...countValue(current),
          trend: trendOf(countValue(current), countValue(before), 1),
        },
      ],
      chart:
        current > 0
          ? {
              type: "bar",
              unit: "count",
              categories: weeks,
              series: [
                {
                  key: "completed",
                  label: "Completed",
                  values: weeks.map((week) => perWeek.get(week) ?? 0),
                },
              ],
            }
          : null,
      columns: [
        col("week", "Week starting", "date"),
        col("completed", "Completed", "number"),
      ],
      rows: weeks.map((week) => ({
        week,
        completed: perWeek.get(week) ?? 0,
        _drill: week,
      })),
      population: current,
      outsideWindow: await countOutside(ctx, "resolved_at", DONE),
      drill: true,
    });
  },
  drillItems: (ctx, handle, limit) => {
    // The first and last week are partial: clamp the row's week to the window so the drill
    // lists exactly the items the row counted.
    const weekFrom = handle ? new Date(`${handle}T00:00:00.000Z`) : null;
    const from =
      weekFrom && weekFrom > ctx.window.from ? weekFrom : ctx.window.from;
    const weekTo = weekFrom ? new Date(weekFrom.getTime() + 7 * DAY_MS) : null;
    const to = weekTo && weekTo < ctx.window.to ? weekTo : ctx.window.to;
    return itemsOf(
      ctx,
      sql`${DONE} AND ${resolvedIn(from, to)}`,
      limit,
      sql`w.resolved_at DESC`,
    );
  },
};

const workMix: ReportDefinition = {
  key: "work_mix",
  category: "delivery",
  title: "Work mix",
  async compute(ctx) {
    const rows = await selectRows<{
      type_id: string | null;
      type: string;
      priority: string | null;
      n: string;
    }>(sql`SELECT w.type_id, COALESCE(wt.name, '(no type)') AS type, w.priority, count(*) AS n
      ${itemFrom(ctx, sql`LEFT JOIN work_item_type wt ON wt.id = w.type_id`)}
      AND w.created_at >= ${tsn(ctx.window.from)} AND w.created_at < ${tsn(ctx.window.to)}
      GROUP BY 1, 2, 3`);
    const priorities = ["urgent", "high", "medium", "low", "none"];
    const byType = new Map<
      string,
      { id: string | null; counts: Record<string, number> }
    >();
    for (const row of rows) {
      const entry = byType.get(row.type) ?? { id: row.type_id, counts: {} };
      const key = row.priority ?? "none";
      entry.counts[key] = (entry.counts[key] ?? 0) + num(row.n);
      byType.set(row.type, entry);
    }
    const table: Row[] = [...byType.entries()]
      .map(([type, entry]) => {
        const total = Object.values(entry.counts).reduce((a, b) => a + b, 0);
        const row: Row = { type, total, _drill: entry.id ?? "none" };
        for (const priority of priorities)
          row[priority] = entry.counts[priority] ?? 0;
        return row;
      })
      .sort((a, b) => Number(b.total) - Number(a.total));
    const total = table.reduce((sum, row) => sum + Number(row.total), 0);
    return emptyBody({
      metrics: [
        {
          key: "created",
          label: "Items raised",
          unit: "count",
          ...countValue(total),
        },
      ],
      chart:
        total > 0
          ? {
              type: "bar",
              unit: "count",
              categories: table.slice(0, 12).map((row) => String(row.type)),
              series: priorities.map((priority) => ({
                key: priority,
                label: priority,
                values: table
                  .slice(0, 12)
                  .map((row) => Number(row[priority] ?? 0)),
              })),
            }
          : null,
      columns: [
        col("type", "Type"),
        col("total", "Total", "number"),
        ...priorities.map((priority) => col(priority, priority, "number")),
      ],
      rows: table,
      population: total,
      outsideWindow: await countOutside(ctx, "created_at"),
      drill: true,
    });
  },
  drillItems: (ctx, handle, limit) =>
    itemsOf(
      ctx,
      sql`w.created_at >= ${tsn(ctx.window.from)} AND w.created_at < ${tsn(ctx.window.to)}
        AND ${handle ? (handle === "none" ? sql`w.type_id IS NULL` : sql`w.type_id = ${handle}`) : sql`true`}`,
      limit,
      sql`w.created_at DESC`,
    ),
};

const cycleTime: ReportDefinition = {
  key: "cycle_time",
  category: "delivery",
  title: "Cycle time",
  async compute(ctx) {
    const rows = await selectRows<{
      created_at: string | Date;
      resolved_at: string | Date;
    }>(sql`SELECT w.created_at, w.resolved_at
      ${itemFrom(ctx)} AND ${DONE}
      AND ${resolvedIn(ctx.window.from, ctx.window.to)}`);
    const durations = rows.map(
      (row) => utc(row.resolved_at).getTime() - utc(row.created_at).getTime(),
    );
    const buckets = bucketCounts(durations, DURATION_BUCKETS);
    const within7 = durations.filter((ms) => ms < 8 * DAY_MS).length;
    return emptyBody({
      metrics: [
        {
          key: "resolved",
          label: "Items resolved",
          unit: "count",
          ...countValue(rows.length),
        },
        {
          key: "within_week",
          label: "Resolved within 7 days",
          unit: "percent",
          ...ratePercent(within7, rows.length, MIN),
        },
      ],
      chart:
        rows.length > 0
          ? {
              type: "bar",
              unit: "count",
              categories: buckets.map((bucket) => bucket.label),
              series: [
                {
                  key: "items",
                  label: "Items",
                  values: buckets.map((bucket) => bucket.count),
                },
              ],
            }
          : null,
      columns: [
        col("bucket", "Created to resolved", "bucket"),
        col("items", "Items", "number"),
      ],
      rows: buckets.map((bucket) => ({
        bucket: bucket.label,
        items: bucket.count,
        _drill: bucket.key,
      })),
      population: rows.length,
      outsideWindow: await countOutside(ctx, "resolved_at", DONE),
      drill: true,
    });
  },
  drillItems: async (ctx, handle, limit) => {
    const items = await selectRows<{
      key: string;
      d: Date;
      c: Date;
    }>(sql`SELECT w.key, w.resolved_at AS d, w.created_at AS c
      ${itemFrom(ctx)} AND ${DONE} AND ${resolvedIn(ctx.window.from, ctx.window.to)}`);
    const keys = items
      .filter(
        (row) =>
          !handle ||
          bucketOf(
            utc(row.d).getTime() - utc(row.c).getTime(),
            DURATION_BUCKETS,
          ).key === handle,
      )
      .map((row) => row.key)
      .slice(0, limit);
    if (keys.length === 0) return [];
    return itemsOf(
      ctx,
      sql`w.key IN (${sql.join(
        keys.map((key) => sql`${key}`),
        sql`, `,
      )})`,
      limit,
    );
  },
};

const ageing: ReportDefinition = {
  key: "ageing",
  category: "delivery",
  title: "Ageing",
  live: true,
  async compute(ctx) {
    const rows = await selectRows<{
      created_at: string | Date;
    }>(sql`SELECT w.created_at
      ${itemFrom(ctx)} AND ${OPEN}`);
    const now = ctx.now.getTime();
    const buckets = bucketCounts(
      rows.map((row) => now - utc(row.created_at).getTime()),
      AGE_BUCKETS,
    );
    const over30 = buckets
      .filter((bucket) => ["d31_60", "d61_90", "gt90"].includes(bucket.key))
      .reduce((sum, bucket) => sum + bucket.count, 0);
    return emptyBody({
      metrics: [
        {
          key: "open",
          label: "Open items",
          unit: "count",
          ...countValue(rows.length),
        },
        {
          key: "over_30",
          label: "Older than 30 days",
          unit: "count",
          ...countValue(over30),
        },
      ],
      chart:
        rows.length > 0
          ? {
              type: "bar",
              unit: "count",
              categories: buckets.map((bucket) => bucket.label),
              series: [
                {
                  key: "open",
                  label: "Open items",
                  values: buckets.map((bucket) => bucket.count),
                },
              ],
            }
          : null,
      columns: [
        col("bucket", "Age", "bucket"),
        col("items", "Open items", "number"),
      ],
      rows: buckets.map((bucket) => ({
        bucket: bucket.label,
        items: bucket.count,
        _drill: bucket.key,
      })),
      population: rows.length,
      drill: true,
    });
  },
  drillItems: async (ctx, handle, limit) => {
    const rows = await selectRows<{
      key: string;
      created_at: string | Date;
    }>(sql`SELECT w.key, w.created_at
      ${itemFrom(ctx)} AND ${OPEN}`);
    const now = ctx.now.getTime();
    const keys = rows
      .filter(
        (row) =>
          !handle ||
          bucketOf(now - utc(row.created_at).getTime(), AGE_BUCKETS).key ===
            handle,
      )
      .map((row) => row.key)
      .slice(0, limit);
    if (keys.length === 0) return [];
    return itemsOf(
      ctx,
      sql`w.key IN (${sql.join(
        keys.map((key) => sql`${key}`),
        sql`, `,
      )})`,
      limit,
      sql`w.created_at ASC`,
    );
  },
};

const flow: ReportDefinition = {
  key: "flow",
  category: "delivery",
  title: "Flow",
  live: true,
  async compute(ctx) {
    // Time in the current state: since the last transition into it, or since creation.
    const rows = await selectRows<{
      state_id: string;
      state: string;
      since: string | Date;
    }>(sql`SELECT w.state_id, st.name AS state,
        COALESCE(
          (SELECT max(a.created_at) FROM activity a
            WHERE a.work_item_id = w.id AND a.verb = 'transitioned'),
          w.created_at) AS since
      ${itemFrom(ctx)} AND ${OPEN}`);
    const now = ctx.now.getTime();
    const byState = new Map<string, { id: string; ages: number[] }>();
    for (const row of rows) {
      const entry = byState.get(row.state) ?? { id: row.state_id, ages: [] };
      entry.ages.push(now - utc(row.since).getTime());
      byState.set(row.state, entry);
    }
    const table = [...byState.entries()]
      .map(([state, entry]) => {
        const counts = bucketCounts(entry.ages, [
          { key: "w1", label: "7 days or less", maxDays: 8 },
          { key: "m1", label: "8-30 days", maxDays: 31 },
          { key: "over", label: "Over 30 days", maxDays: null },
        ]);
        const oldest = Math.max(...entry.ages);
        return {
          oldest,
          row: {
            state,
            items: entry.ages.length,
            w1: counts[0]?.count ?? 0,
            m1: counts[1]?.count ?? 0,
            over: counts[2]?.count ?? 0,
            oldest: Math.floor(oldest / DAY_MS),
            _drill: entry.id,
          } as Row,
        };
      })
      // Where items sit longest: the state holding the oldest item leads.
      .sort((a, b) => b.oldest - a.oldest)
      .map((entry) => entry.row);
    return emptyBody({
      metrics: [
        {
          key: "open",
          label: "Open items",
          unit: "count",
          ...countValue(rows.length),
        },
      ],
      chart:
        rows.length > 0
          ? {
              type: "bar",
              unit: "count",
              categories: table.map((row) => String(row.state)),
              series: [
                {
                  key: "w1",
                  label: "7 days or less",
                  values: table.map((row) => Number(row.w1)),
                },
                {
                  key: "m1",
                  label: "8-30 days",
                  values: table.map((row) => Number(row.m1)),
                },
                {
                  key: "over",
                  label: "Over 30 days",
                  values: table.map((row) => Number(row.over)),
                },
              ],
            }
          : null,
      columns: [
        col("state", "State"),
        col("items", "Open items", "number"),
        col("w1", "7 days or less", "number"),
        col("m1", "8-30 days", "number"),
        col("over", "Over 30 days", "number"),
        col("oldest", "Oldest (days)", "days"),
      ],
      rows: table,
      population: rows.length,
      drill: true,
    });
  },
  drillItems: (ctx, handle, limit) =>
    itemsOf(
      ctx,
      sql`${OPEN} AND ${handle ? sql`w.state_id = ${handle}` : sql`true`}`,
      limit,
      sql`w.updated_at ASC`,
    ),
};

export const deliveryReports: ReportDefinition[] = [
  throughput,
  workMix,
  cycleTime,
  ageing,
  flow,
];
