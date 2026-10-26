import { sql } from "drizzle-orm";
import { num, selectRows } from "../context";
import { countValue, minutesToHours, ratePercent } from "../logic";
import { loadFactRows } from "../snapshot.repository";
import type { ReportDefinition, Row } from "../types";
import { cell, col, emptyBody, MIN, pageRows } from "./shared";

function money(minor: number, currency: string): string {
  try {
    const format = new Intl.NumberFormat("en", { style: "currency", currency });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    return format.format(minor / 10 ** digits);
  } catch {
    return `${currency} ${minor}`;
  }
}

const timeLogged: ReportDefinition = {
  key: "time_logged",
  category: "time",
  title: "Time logged",
  feature: "feature.time_tracking",
  rated: true,
  pagedExport: true,
  options: [{ key: "by", values: ["project", "person", "activity"] }],
  async compute(ctx) {
    const by =
      ctx.options.by === "person" || ctx.options.by === "activity"
        ? ctx.options.by
        : "project";
    const facts = await loadFactRows(
      ctx,
      "time_logged",
      ctx.window.from,
      ctx.window.to,
    );
    const groupFor = (fact: (typeof facts)[number]) =>
      by === "project"
        ? fact.project_id
        : by === "person"
          ? fact.dimensions.personId
          : fact.dimensions.activityId;
    const grouped = new Map<
      string,
      {
        id: string | null;
        minutes: number;
        billable: number;
        entries: number;
        label: string;
      }
    >();
    for (const fact of facts) {
      const id = groupFor(fact) ?? null;
      const row = grouped.get(id ?? "") ?? {
        id,
        minutes: 0,
        billable: 0,
        entries: 0,
        label: "",
      };
      row.minutes += fact.measures.minutes ?? 0;
      row.billable += fact.measures.billableMinutes ?? 0;
      row.entries += fact.measures.entries ?? 0;
      grouped.set(id ?? "", row);
    }
    const ids = [
      ...new Set(
        [...grouped.values()]
          .map((row) => row.id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (ids.length) {
      if (by === "project") {
        const labels = await selectRows<{ id: string; label: string }>(
          sql`SELECT id, name || ' (' || slug || ')' AS label FROM project WHERE id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
        for (const label of labels) {
          const row = grouped.get(label.id);
          if (row) row.label = label.label;
        }
      } else if (by === "person") {
        const labels = await selectRows<{ id: string; label: string }>(
          sql`SELECT pe.id, COALESCE(pe.display_name,u.name,'Unknown') AS label FROM person pe LEFT JOIN "user" u ON u.id=pe.user_id WHERE pe.id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
        for (const label of labels) {
          const row = grouped.get(label.id);
          if (row) row.label = label.label;
        }
      } else {
        const labels = await selectRows<{ id: string; label: string }>(
          sql`SELECT id,name AS label FROM time_activity WHERE id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
        for (const label of labels) {
          const row = grouped.get(label.id);
          if (row) row.label = label.label;
        }
      }
    }
    const allHours = [...grouped.values()].sort(
      (a, b) =>
        b.minutes - a.minutes ||
        String(a.id ?? "").localeCompare(String(b.id ?? "")) ||
        a.label.localeCompare(b.label),
    );
    const pageInput = ctx.exportPage
      ? allHours.slice(
          ctx.exportPage.offset,
          ctx.exportPage.offset + ctx.exportPage.limit,
        )
      : allHours.slice(0, 201);
    const page = pageRows(ctx, pageInput, 200);
    const hours = pageInput;
    const costIds = page.rows.map((row) => row.id);
    const costs = ctx.showRates
      ? facts
          .filter((fact) => costIds.some((id) => id === groupFor(fact)))
          .map((fact) => ({
            id: groupFor(fact) ?? null,
            currency: fact.dimensions.currency,
            cost: String(fact.measures.costMinor ?? 0),
            minutes: String(fact.measures.unpricedMinutes ?? 0),
          }))
      : [];
    const orphans = facts.reduce(
      (sum, fact) => sum + (fact.measures.orphanEntries ?? 0),
      0,
    );
    const costOf = (id: string | null) => {
      const entries = new Map<string, number>();
      for (const row of costs) {
        if (row.id !== id || !row.currency) continue;
        entries.set(
          row.currency,
          (entries.get(row.currency) ?? 0) + num(row.cost),
        );
      }
      return entries.size
        ? [...entries]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([currency, amount]) => money(Math.round(amount), currency))
            .join("; ")
        : null;
    };
    const unpricedOf = (id: string | null) =>
      minutesToHours(
        costs
          .filter((row) => row.id === id)
          .reduce((sum, row) => sum + num(row.minutes), 0),
      );
    const table: Row[] = page.rows.map((row) => ({
      [by]: row.label,
      hours: minutesToHours(row.minutes),
      billable: minutesToHours(row.billable),
      billable_share: cell(ratePercent(row.billable, row.minutes, 1)),
      entries: row.entries,
      cost: costOf(row.id),
      unpriced: ctx.showRates ? unpricedOf(row.id) : null,
    }));
    const totalMinutes = page.rows.reduce((sum, row) => sum + row.minutes, 0);
    const billableMinutes = page.rows.reduce(
      (sum, row) => sum + row.billable,
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
    if (orphans > 0) notes.push("time_on_deleted_items");
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
        page.rows.length > 0
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
      truncated: page.truncated,
      population: hours.reduce((sum, row) => sum + row.entries, 0),
      notes,
    });
  },
};

export const timeReports: ReportDefinition[] = [timeLogged];
export { MIN };
