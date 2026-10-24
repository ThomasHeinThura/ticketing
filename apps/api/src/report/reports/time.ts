import { sql } from "drizzle-orm";
import { dayOf, num, selectRows, timeFrom } from "../context";
import { countValue, minutesToHours, ratePercent } from "../logic";
import type { ReportContext, ReportDefinition, Row } from "../types";
import { cell, col, emptyBody, MIN } from "./shared";

function money(minor: number, currency: string): string {
  try {
    const format = new Intl.NumberFormat("en", { style: "currency", currency });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    return format.format(minor / 10 ** digits);
  } catch {
    return `${currency} ${minor}`;
  }
}

function inDates(ctx: ReportContext) {
  return sql`te.date >= ${dayOf(ctx.window.from)}::date AND te.date <= ${dayOf(new Date(ctx.window.to.getTime() - 1))}::date`;
}

const GROUPS = {
  project: {
    id: sql`te.project_id`,
    label: sql`p.name || ' (' || p.slug || ')'`,
  },
  person: {
    id: sql`te.person_id`,
    label: sql`COALESCE(pe.display_name, u.name, 'Unknown')`,
  },
  activity: { id: sql`te.activity_id`, label: sql`ta.name` },
} as const;

const timeLogged: ReportDefinition = {
  key: "time_logged",
  category: "time",
  title: "Time logged",
  feature: "feature.time_tracking",
  rated: true,
  options: [{ key: "by", values: ["project", "person", "activity"] }],
  async compute(ctx) {
    const by =
      ctx.options.by === "person" || ctx.options.by === "activity"
        ? ctx.options.by
        : "project";
    const group = GROUPS[by];
    const join = sql`JOIN time_activity ta ON ta.id = te.activity_id`;
    const hours = await selectRows<{
      id: string;
      label: string;
      minutes: string;
      billable: string;
      entries: string;
    }>(sql`SELECT ${group.id} AS id, ${group.label} AS label, sum(te.minutes) AS minutes,
        COALESCE(sum(te.minutes) FILTER (WHERE te.billable), 0) AS billable,
        count(*) AS entries
      ${timeFrom(ctx, join)} AND ${inDates(ctx)}
      GROUP BY 1, 2 ORDER BY sum(te.minutes) DESC LIMIT 200`);
    // Cost is only selected for a caller who may see rates (TC-11). Currencies stay apart (TC-19).
    const costs = ctx.showRates
      ? await selectRows<{
          id: string;
          currency: string | null;
          cost: string;
          minutes: string;
        }>(sql`SELECT ${group.id} AS id, te.currency,
            COALESCE(sum(te.minutes * te.rate_minor / 60.0), 0) AS cost, sum(te.minutes) AS minutes
          ${timeFrom(ctx, join)} AND ${inDates(ctx)}
          GROUP BY 1, 2`)
      : [];
    const [orphans] = await selectRows<{ n: string }>(
      sql`SELECT count(*) AS n ${timeFrom(ctx)} AND ${inDates(ctx)} AND te.work_item_id IS NULL`,
    );
    const costOf = (id: string) => {
      const entries = costs.filter(
        (row) => row.id === id && row.currency !== null,
      );
      return entries.length
        ? entries
            .sort((a, b) =>
              String(a.currency).localeCompare(String(b.currency)),
            )
            .map((row) =>
              money(Math.round(num(row.cost)), String(row.currency)),
            )
            .join("; ")
        : null;
    };
    const unpricedOf = (id: string) =>
      minutesToHours(
        num(
          costs.find((row) => row.id === id && row.currency === null)?.minutes,
        ),
      );
    const table: Row[] = hours.map((row) => ({
      [by]: row.label,
      hours: minutesToHours(num(row.minutes)),
      billable: minutesToHours(num(row.billable)),
      billable_share: cell(ratePercent(num(row.billable), num(row.minutes), 1)),
      entries: num(row.entries),
      cost: costOf(row.id),
      unpriced: ctx.showRates ? unpricedOf(row.id) : null,
    }));
    const totalMinutes = hours.reduce((sum, row) => sum + num(row.minutes), 0);
    const billableMinutes = hours.reduce(
      (sum, row) => sum + num(row.billable),
      0,
    );
    const currencies = [
      ...new Set(
        costs
          .map((row) => row.currency)
          .filter((value): value is string => value !== null),
      ),
    ].sort();
    const notes: string[] = [];
    if (!ctx.readAnyTime) notes.push("own_time_only");
    if (num(orphans?.n) > 0) notes.push("time_on_deleted_items");
    return emptyBody({
      metrics: [
        {
          key: "hours",
          label: "Hours logged",
          unit: "hours",
          ...countValue(minutesToHours(totalMinutes)),
        },
        {
          key: "billable",
          label: "Billable share",
          unit: "percent",
          ...ratePercent(billableMinutes, totalMinutes, 1),
        },
        ...currencies.map((currency) => ({
          key: `cost_${currency}`,
          label: `Cost (${currency})`,
          unit: "money" as const,
          currency,
          sensitive: true,
          ...countValue(
            Math.round(
              costs
                .filter((row) => row.currency === currency)
                .reduce((sum, row) => sum + num(row.cost), 0),
            ),
          ),
        })),
      ],
      chart:
        hours.length > 0
          ? {
              type: "bar",
              unit: "hours",
              categories: table.slice(0, 12).map((row) => String(row[by])),
              series: [
                {
                  key: "hours",
                  label: "Hours",
                  values: table.slice(0, 12).map((row) => Number(row.hours)),
                },
                {
                  key: "billable",
                  label: "Billable",
                  values: table.slice(0, 12).map((row) => Number(row.billable)),
                },
              ],
            }
          : null,
      columns: [
        col(
          by,
          by === "project"
            ? "Project"
            : by === "person"
              ? "Person"
              : "Activity",
        ),
        col("hours", "Hours", "hours"),
        col("billable", "Billable hours", "hours"),
        col("billable_share", "Billable share", "percent"),
        col("entries", "Entries", "number"),
        col("cost", "Cost", "text", true),
        col("unpriced", "Unpriced hours", "hours", true),
      ],
      rows: table,
      population: hours.reduce((sum, row) => sum + num(row.entries), 0),
      notes,
    });
  },
};

export const timeReports: ReportDefinition[] = [timeLogged];
export { MIN };
