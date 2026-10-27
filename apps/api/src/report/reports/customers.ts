import { sql } from "drizzle-orm";
import { num, selectRows, tsn } from "../context";
import { countValue, ratePercent, trendOf } from "../logic";
import { loadFactRows } from "../snapshot.repository";
import type { ReportDefinition, Row } from "../types";
import {
  cell,
  col,
  countOutside,
  emptyBody,
  itemsOf,
  MIN,
  memoryPage,
  pageRows,
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
  pagedExport: true,
  async compute(ctx) {
    const [createdFacts, resolvedFacts, slaFacts] = await Promise.all([
      loadFactRows(ctx, "item_created", ctx.window.from, ctx.window.to),
      loadFactRows(ctx, "item_resolved", ctx.window.from, ctx.window.to),
      loadFactRows(ctx, "sla_resolution", ctx.window.from, ctx.window.to),
    ]);
    const aggregate = new Map<
      string,
      {
        org_id: string | null;
        volume: number;
        resolved: number;
        met: number;
        missed: number;
        fast: number;
        slow: number;
        touched: number;
      }
    >();
    const get = (orgId: string | null) => {
      const key = orgId ?? "";
      const row = aggregate.get(key) ?? {
        org_id: orgId,
        volume: 0,
        resolved: 0,
        met: 0,
        missed: 0,
        fast: 0,
        slow: 0,
        touched: 0,
      };
      aggregate.set(key, row);
      return row;
    };
    for (const fact of createdFacts) {
      const row = get(fact.organisation_id);
      row.volume += fact.measures.count ?? 0;
      row.touched += fact.measures.count ?? 0;
    }
    for (const fact of resolvedFacts) {
      const row = get(fact.organisation_id);
      row.resolved += fact.measures.count ?? 0;
      row.fast += fact.measures.fast ?? 0;
      row.slow += fact.measures.slow ?? 0;
      row.touched += fact.measures.count ?? 0;
    }
    for (const fact of slaFacts) {
      const row = get(fact.organisation_id);
      row.met += fact.measures.met ?? 0;
      row.missed += fact.measures.missed ?? 0;
    }
    const orgIds = [
      ...new Set(
        [...aggregate.values()]
          .map((row) => row.org_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const orgNames = orgIds.length
      ? await selectRows<{ id: string; name: string }>(
          sql`SELECT id,name FROM organisation WHERE id IN (${sql.join(
            orgIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
      : [];
    const orgNameById = new Map(orgNames.map((row) => [row.id, row.name]));
    const rows = [...aggregate.values()].map((row) => ({
      ...row,
      org: row.org_id ? (orgNameById.get(row.org_id) ?? NO_ORG) : NO_ORG,
      volume: String(row.volume),
      resolved: String(row.resolved),
      met: String(row.met),
      missed: String(row.missed),
      fast: String(row.fast),
      slow: String(row.slow),
      touched: String(row.touched),
    }));
    const ranked = rows.map((row) => {
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
    });
    // The rows are built in memory, so every page of a paged export must see the same total order:
    // the screen ordering plus a stable tie-break on the customer.
    ranked.sort((a, b) => {
      if (a.sort === null && b.sort === null)
        return (
          b.volumeN - a.volumeN ||
          String(a.row.customer).localeCompare(String(b.row.customer)) ||
          String(a.row._drill).localeCompare(String(b.row._drill))
        );
      if (a.sort === null) return 1;
      if (b.sort === null) return -1;
      return (
        a.sort - b.sort ||
        b.volumeN - a.volumeN ||
        String(a.row.customer).localeCompare(String(b.row.customer)) ||
        String(a.row._drill).localeCompare(String(b.row._drill))
      );
    });
    const page = pageRows(ctx, memoryPage(ctx, ranked), 200);
    const table = page.rows.map((entry) => entry.row);
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
      truncated: page.truncated,
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
  pagedExport: true,
  async compute(ctx) {
    const [currentFacts, previousFacts] = await Promise.all([
      loadFactRows(ctx, "item_created", ctx.window.from, ctx.window.to),
      loadFactRows(ctx, "item_created", ctx.previous.from, ctx.window.from),
    ]);
    const grouped = new Map<
      string,
      {
        org_id: string | null;
        current: number;
        previous: number;
        weeks: Map<string, number>;
      }
    >();
    const add = (
      fact: (typeof currentFacts)[number],
      period: "current" | "previous",
    ) => {
      const orgId = fact.organisation_id;
      const row = grouped.get(orgId ?? "") ?? {
        org_id: orgId,
        current: 0,
        previous: 0,
        weeks: new Map<string, number>(),
      };
      const count = fact.measures.count ?? 0;
      if (period === "current") {
        row.current += count;
        const week = weekKey(new Date(`${fact.day}T00:00:00.000Z`));
        row.weeks.set(week, (row.weeks.get(week) ?? 0) + count);
      } else row.previous += count;
      grouped.set(orgId ?? "", row);
    };
    for (const fact of currentFacts) add(fact, "current");
    for (const fact of previousFacts) add(fact, "previous");
    const orgIds = [
      ...new Set(
        [...grouped.values()]
          .map((row) => row.org_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const orgNames = orgIds.length
      ? await selectRows<{ id: string; name: string }>(
          sql`SELECT id,name FROM organisation WHERE id IN (${sql.join(
            orgIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
      : [];
    const orgNameById = new Map(orgNames.map((row) => [row.id, row.name]));
    const rows = [...grouped.values()]
      .map((row) => ({
        org_id: row.org_id,
        org: row.org_id ? (orgNameById.get(row.org_id) ?? NO_ORG) : NO_ORG,
        current: String(row.current),
        previous: String(row.previous),
        weeks: row.weeks,
      }))
      .sort(
        (a, b) =>
          num(b.current) - num(a.current) ||
          String(a.org_id ?? "").localeCompare(String(b.org_id ?? "")) ||
          a.org.localeCompare(b.org),
      );
    const page = pageRows(ctx, memoryPage(ctx, rows), 200);
    const currentTotal = rows.reduce((sum, row) => sum + num(row.current), 0);
    const previousTotal = rows.reduce((sum, row) => sum + num(row.previous), 0);
    const top = page.rows.filter((row) => num(row.current) > 0).slice(0, 5);
    const table: Row[] = page.rows.map((row) => {
      const now = num(row.current);
      const before = num(row.previous);
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
        customer: row.org,
        volume: now,
        previous: before,
        change,
        _drill: row.org_id ?? "none",
      };
    });
    const weeks = weekAxis(ctx);
    return emptyBody({
      metrics: [
        {
          key: "volume",
          label: "Requests raised",
          unit: "count",
          ...countValue(currentTotal),
          trend: trendOf(
            countValue(currentTotal),
            countValue(previousTotal),
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
              series: top.map((item) => ({
                key: item.org_id ?? "none",
                label: item.org,
                values: weeks.map((week) => item.weeks.get(week) ?? 0),
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
      truncated: page.truncated,
      population: currentTotal,
      outsideWindow: previousTotal,
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
  pagedExport: true,
  async compute(ctx) {
    const by = ctx.options.by === "request_type" ? "request_type" : "customer";
    const facts = await loadFactRows(
      ctx,
      "satisfaction_rating",
      ctx.window.from,
      ctx.window.to,
    );
    const ids = [
      ...new Set(
        facts
          .map((fact) =>
            by === "customer"
              ? fact.organisation_id
              : fact.dimensions.requestTypeId,
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const labels = ids.length
      ? by === "customer"
        ? await selectRows<{ id: string; name: string }>(
            sql`SELECT id,name FROM organisation WHERE id IN (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          )
        : await selectRows<{ id: string; name: string }>(
            sql`SELECT id,name FROM request_type WHERE id IN (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          )
      : [];
    const labelById = new Map(labels.map((row) => [row.id, row.name]));
    const grouped = new Map<
      string,
      {
        id: string | null;
        label: string;
        ratings: number;
        satisfied: number;
        s1: number;
        s2: number;
        s3: number;
        s4: number;
        s5: number;
      }
    >();
    for (const fact of facts) {
      const id =
        by === "customer"
          ? fact.organisation_id
          : fact.dimensions.requestTypeId;
      const key = id ?? "";
      const label = id
        ? (labelById.get(id) ??
          (by === "customer" ? NO_ORG : "(not raised through a request type)"))
        : by === "customer"
          ? NO_ORG
          : "(not raised through a request type)";
      const row = grouped.get(key) ?? {
        id: id ?? null,
        label,
        ratings: 0,
        satisfied: 0,
        s1: 0,
        s2: 0,
        s3: 0,
        s4: 0,
        s5: 0,
      };
      const score = Number(fact.dimensions.score ?? 0);
      const count = fact.measures.count ?? 0;
      row.ratings += count;
      if (score >= 4) row.satisfied += count;
      if (score >= 1 && score <= 5)
        row[`s${score}` as "s1" | "s2" | "s3" | "s4" | "s5"] += count;
      grouped.set(key, row);
    }
    const rows = [...grouped.values()].sort(
      (a, b) => b.ratings - a.ratings || a.label.localeCompare(b.label),
    );
    const page = pageRows(ctx, memoryPage(ctx, rows), 200);
    const scoreKeys = ["s1", "s2", "s3", "s4", "s5"] as const;
    const total = page.rows.reduce((sum, row) => sum + num(row.ratings), 0);
    const satisfied = page.rows.reduce(
      (sum, row) => sum + num(row.satisfied),
      0,
    );
    const overall = ratePercent(satisfied, total, MIN);
    const table: Row[] = page.rows.map((row) => ({
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
                  values: scoreKeys.map((key) =>
                    page.rows.reduce((sum, row) => sum + row[key], 0),
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
      truncated: page.truncated,
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
