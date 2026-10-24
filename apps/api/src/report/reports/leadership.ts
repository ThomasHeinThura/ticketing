import { sql } from "drizzle-orm";
import { dayOf, num, selectRows, timeFrom, tsn, tstz } from "../context";
import { countValue, minutesToHours, ratePercent } from "../logic";
import type { ReportContext, ReportDefinition, Row } from "../types";
import { cell, col, emptyBody, weekAxis, weekKey } from "./shared";

function projectFilterSql(ctx: ReportContext) {
  const parts = [sql`true`];
  if (ctx.filters.projectId) parts.push(sql`p.id = ${ctx.filters.projectId}`);
  if (ctx.filters.organisationId)
    parts.push(sql`p.organisation_id = ${ctx.filters.organisationId}`);
  return sql.join(parts, sql` AND `);
}

const RAG_ORDER: Record<string, number> = {
  red: 0,
  amber: 1,
  green: 2,
  unset: 3,
};

const portfolioHealth: ReportDefinition = {
  key: "portfolio_health",
  category: "leadership",
  title: "Portfolio health",
  live: true,
  async compute(ctx) {
    const rows = await selectRows<{
      slug: string;
      name: string;
      health: string | null;
      archived: boolean;
      org: string | null;
      open: string;
      overdue: string;
      breached: string;
      escalating: string;
    }>(sql`SELECT p.slug, p.name, p.health, (p.archived_at IS NOT NULL) AS archived, o.name AS org,
        (SELECT count(*) FROM work_item w JOIN state s ON s.id = w.state_id
           JOIN state_template st ON st.id = s.state_template_id
          WHERE w.project_id = p.id AND w.deleted_at IS NULL
            AND st."group" NOT IN ('completed', 'cancelled')) AS open,
        (SELECT count(*) FROM work_item w JOIN state s ON s.id = w.state_id
           JOIN state_template st ON st.id = s.state_template_id
          WHERE w.project_id = p.id AND w.deleted_at IS NULL
            AND st."group" NOT IN ('completed', 'cancelled')
            AND w.due_date IS NOT NULL AND w.due_date < ${tsn(ctx.now)}) AS overdue,
        (SELECT count(*) FROM work_item w JOIN work_item_sla_cache c ON c.work_item_id = w.id
           JOIN state s ON s.id = w.state_id
           JOIN state_template st ON st.id = s.state_template_id
          WHERE w.project_id = p.id AND w.deleted_at IS NULL AND c.state = 'breached'
            AND st."group" NOT IN ('completed', 'cancelled')) AS breached,
        (SELECT count(*) FROM sla_escalation e
          WHERE e.project_id = p.id AND e.state = 'active') AS escalating
      FROM project p
      LEFT JOIN organisation o ON o.id = p.organisation_id
      WHERE p.workspace_id = ${ctx.workspaceId} AND p.deleted_at IS NULL
        AND ${ctx.reach} AND ${projectFilterSql(ctx)}
      ORDER BY p.name LIMIT 500`);
    const table: Row[] = rows
      .map((row) => ({
        project: `${row.name} (${row.slug})`,
        customer: row.org,
        rag: row.health ?? "unset",
        open: num(row.open),
        overdue: num(row.overdue),
        breached: num(row.breached),
        escalating: num(row.escalating),
        archived: row.archived ? "archived" : null,
      }))
      .sort(
        (a, b) =>
          (RAG_ORDER[String(a.rag)] ?? 9) - (RAG_ORDER[String(b.rag)] ?? 9) ||
          Number(b.breached) - Number(a.breached),
      );
    const count = (rag: string) =>
      table.filter((row) => row.rag === rag).length;
    const notes = table.some((row) => row.archived)
      ? ["archived_projects_included"]
      : [];
    return emptyBody({
      metrics: [
        {
          key: "red",
          label: "Red",
          unit: "count",
          ...countValue(count("red")),
        },
        {
          key: "amber",
          label: "Amber",
          unit: "count",
          ...countValue(count("amber")),
        },
        {
          key: "green",
          label: "Green",
          unit: "count",
          ...countValue(count("green")),
        },
        {
          key: "unset",
          label: "No health set",
          unit: "count",
          ...countValue(count("unset")),
        },
      ],
      chart:
        table.length > 0
          ? {
              type: "bar",
              unit: "count",
              categories: ["red", "amber", "green", "unset"],
              series: [
                {
                  key: "projects",
                  label: "Projects",
                  values: ["red", "amber", "green", "unset"].map(count),
                },
              ],
            }
          : null,
      columns: [
        col("project", "Project"),
        col("customer", "Customer"),
        col("rag", "Health"),
        col("open", "Open items", "number"),
        col("overdue", "Overdue", "number"),
        col("breached", "SLA breached", "number"),
        col("escalating", "Escalating", "number"),
        col("archived", "Archived"),
      ],
      rows: table,
      population: table.length,
      notes,
    });
  },
};

const predictability: ReportDefinition = {
  key: "predictability",
  category: "leadership",
  title: "Predictability",
  async compute(ctx) {
    const rows = await selectRows<{
      cycle_id: string;
      cycle: string;
      slug: string;
      unit: string;
      committed: string;
      delivered: string;
      items: string;
      unestimated: string;
      completed_at: string | Date;
    }>(sql`SELECT c.id AS cycle_id, c.name AS cycle, p.slug, snap.unit,
        snap.scope_points AS committed, snap.completed_points AS delivered,
        snap.item_count AS items, snap.unestimated_count AS unestimated, c.completed_at
      FROM cycle c
      JOIN project p ON p.id = c.project_id
      JOIN LATERAL (
        SELECT cs.* FROM cycle_snapshot cs WHERE cs.cycle_id = c.id ORDER BY cs.date DESC LIMIT 1
      ) snap ON true
      WHERE c.workspace_id = ${ctx.workspaceId} AND p.deleted_at IS NULL
        AND c.completed_at IS NOT NULL
        AND c.completed_at >= ${tstz(ctx.window.from)} AND c.completed_at < ${tstz(ctx.window.to)}
        AND ${ctx.reach} AND ${projectFilterSql(ctx)}
      ORDER BY c.completed_at DESC LIMIT 200`);
    const table: Row[] = rows.map((row) => {
      const committed = num(row.committed);
      const delivered = num(row.delivered);
      return {
        cycle: row.cycle,
        project: row.slug,
        unit: row.unit,
        committed,
        delivered,
        delivery: cell(ratePercent(delivered, committed, 1)),
        unestimated: num(row.unestimated),
        items: num(row.items),
      };
    });
    const comparable = rows.filter((row) => num(row.committed) > 0);
    const onTarget = comparable.filter(
      (row) => num(row.delivered) / num(row.committed) >= 0.8,
    ).length;
    return emptyBody({
      metrics: [
        {
          key: "cycles",
          label: "Cycles completed",
          unit: "count",
          ...countValue(rows.length),
        },
        {
          key: "on_target",
          label: "Delivered at least 80% of commitment",
          unit: "percent",
          ...ratePercent(onTarget, comparable.length, 3),
        },
      ],
      chart:
        rows.length > 0 && new Set(rows.map((row) => row.unit)).size === 1
          ? {
              type: "bar",
              unit: "count",
              categories: table.map((row) => `${row.project} ${row.cycle}`),
              series: [
                {
                  key: "committed",
                  label: "Committed",
                  values: table.map((row) => Number(row.committed)),
                },
                {
                  key: "delivered",
                  label: "Delivered",
                  values: table.map((row) => Number(row.delivered)),
                },
              ],
            }
          : null,
      columns: [
        col("cycle", "Cycle"),
        col("project", "Project"),
        col("unit", "Unit"),
        col("committed", "Committed", "number"),
        col("delivered", "Delivered", "number"),
        col("delivery", "Delivered of committed", "percent"),
        col("unestimated", "Unestimated items", "number"),
        col("items", "Items", "number"),
      ],
      rows: table,
      population: rows.length,
      notes:
        new Set(rows.map((row) => row.unit)).size > 1 ? ["mixed_units"] : [],
    });
  },
};

const costToDeliver: ReportDefinition = {
  key: "cost_to_deliver",
  category: "leadership",
  title: "Cost to deliver",
  feature: "feature.time_tracking",
  rated: true,
  async compute(ctx) {
    // Hours are visible to anyone who may see the time. Every amount is rate-derived, so it is
    // only selected for a caller who may see rates (TC-11); `present.ts` strips it again as a backstop.
    const hours = await selectRows<{
      project_id: string;
      slug: string;
      name: string;
      minutes: string;
    }>(sql`SELECT te.project_id, p.slug, p.name, sum(te.minutes) AS minutes
      ${timeFrom(ctx)}
      AND te.date >= ${dayOf(ctx.window.from)}::date AND te.date <= ${dayOf(new Date(ctx.window.to.getTime() - 1))}::date
      GROUP BY 1, 2, 3 ORDER BY sum(te.minutes) DESC LIMIT 200`);
    const budgets = ctx.showRates
      ? await selectRows<{
          budget_id: string;
          project_id: string;
          slug: string;
          name: string;
          budget: string;
          currency: string;
          planned: string;
          actual: string;
          unpriced: string;
          minutes: string;
        }>(sql`SELECT b.id AS budget_id, b.project_id, p.slug, p.name, b.name AS budget,
            b.currency, b.planned_amount_minor AS planned,
            COALESCE((SELECT sum(te.minutes * te.rate_minor / 60.0) FROM time_entry te
              WHERE te.project_id = b.project_id AND te.currency = b.currency
                AND te.date >= b.period_start AND te.date <= b.period_end), 0) AS actual,
            COALESCE((SELECT sum(te.minutes) FROM time_entry te
              WHERE te.project_id = b.project_id AND te.rate_minor IS NULL
                AND te.date >= b.period_start AND te.date <= b.period_end), 0) AS unpriced,
            COALESCE((SELECT sum(te.minutes) FROM time_entry te
              WHERE te.project_id = b.project_id
                AND te.date >= b.period_start AND te.date <= b.period_end), 0) AS minutes
          FROM budget b
          JOIN project p ON p.id = b.project_id
          WHERE b.workspace_id = ${ctx.workspaceId} AND p.deleted_at IS NULL
            AND ${ctx.reach} AND ${projectFilterSql(ctx)}
            AND b.period_start <= ${dayOf(new Date(ctx.window.to.getTime() - 1))}::date
            AND b.period_end >= ${dayOf(ctx.window.from)}::date
          ORDER BY p.name, b.period_start LIMIT 200`)
      : [];
    const budgeted = new Set(budgets.map((row) => row.project_id));
    const table: Row[] = [
      ...budgets.map((row) => {
        const planned = num(row.planned);
        const actual = Math.round(num(row.actual));
        return {
          project: `${row.name} (${row.slug})`,
          budget: row.budget,
          currency: row.currency,
          hours: minutesToHours(num(row.minutes)),
          planned,
          actual,
          used: cell(ratePercent(actual, planned, 1)),
          unpriced: minutesToHours(num(row.unpriced)),
        } as Row;
      }),
      ...hours
        .filter((row) => !budgeted.has(row.project_id))
        .map(
          (row) =>
            ({
              project: `${row.name} (${row.slug})`,
              budget: null,
              currency: null,
              hours: minutesToHours(num(row.minutes)),
              planned: null,
              actual: null,
              used: null,
              unpriced: null,
            }) as Row,
        ),
    ];
    const totalHours = hours.reduce((sum, row) => sum + num(row.minutes), 0);
    const currencies = [...new Set(budgets.map((row) => row.currency))].sort();
    return emptyBody({
      metrics: [
        {
          key: "hours",
          label: "Hours logged",
          unit: "hours",
          ...countValue(minutesToHours(totalHours)),
        },
        // One figure per currency: currencies are grouped, never summed (TC-19).
        ...currencies.map((currency) => ({
          key: `actual_${currency}`,
          label: `Actual cost (${currency})`,
          unit: "money" as const,
          currency,
          sensitive: true,
          ...countValue(
            Math.round(
              budgets
                .filter((row) => row.currency === currency)
                .reduce((sum, row) => sum + num(row.actual), 0),
            ),
          ),
        })),
      ],
      chart:
        hours.length > 0
          ? {
              type: "bar",
              unit: "hours",
              categories: hours.slice(0, 12).map((row) => row.slug),
              series: [
                {
                  key: "hours",
                  label: "Hours",
                  values: hours
                    .slice(0, 12)
                    .map((row) => minutesToHours(num(row.minutes))),
                },
              ],
            }
          : null,
      columns: [
        col("project", "Project"),
        col("budget", "Budget", "text", true),
        col("currency", "Currency", "text", true),
        col("hours", "Hours", "hours"),
        col("planned", "Planned", "money", true),
        col("actual", "Actual", "money", true),
        col("used", "Used", "percent", true),
        col("unpriced", "Unpriced hours", "hours", true),
      ],
      rows: table,
      population: hours.length,
      notes: ctx.showRates ? [] : ["costs_hidden"],
    });
  },
};

const escalations: ReportDefinition = {
  key: "escalations",
  category: "leadership",
  title: "Escalations",
  async compute(ctx) {
    const rows = await selectRows<{
      started_at: string | Date;
      state: string;
      stop_reason: string | null;
    }>(sql`SELECT e.started_at, e.state, e.stop_reason
      FROM sla_escalation e
      JOIN project p ON p.id = e.project_id
      WHERE e.workspace_id = ${ctx.workspaceId} AND p.deleted_at IS NULL
        AND ${ctx.reach} AND ${projectFilterSql(ctx)}
        AND e.started_at >= ${tstz(ctx.window.from)} AND e.started_at < ${tstz(ctx.window.to)}`);
    const [outside] = await selectRows<{
      n: string;
    }>(sql`SELECT count(*) AS n FROM sla_escalation e
      JOIN project p ON p.id = e.project_id
      WHERE e.workspace_id = ${ctx.workspaceId} AND p.deleted_at IS NULL
        AND ${ctx.reach} AND ${projectFilterSql(ctx)}
        AND NOT (e.started_at >= ${tstz(ctx.window.from)} AND e.started_at < ${tstz(ctx.window.to)})`);
    const weeks = weekAxis(ctx);
    const perWeek = new Map<string, number>();
    for (const row of rows) {
      const key = weekKey(row.started_at);
      perWeek.set(key, (perWeek.get(key) ?? 0) + 1);
    }
    const byOutcome = new Map<string, number>();
    for (const row of rows) {
      const key =
        row.state === "stopped"
          ? `stopped: ${row.stop_reason ?? "unknown"}`
          : row.state;
      byOutcome.set(key, (byOutcome.get(key) ?? 0) + 1);
    }
    const table: Row[] = [...byOutcome.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([outcome, count]) => ({ outcome, escalations: count }));
    const count = (state: string) =>
      rows.filter((row) => row.state === state).length;
    return emptyBody({
      metrics: [
        {
          key: "started",
          label: "Escalations started",
          unit: "count",
          ...countValue(rows.length),
        },
        {
          key: "active",
          label: "Still active",
          unit: "count",
          ...countValue(count("active")),
        },
        {
          key: "walked_through",
          label: "Walked to the end",
          unit: "count",
          ...countValue(count("completed")),
        },
        {
          key: "stopped",
          label: "Stopped early",
          unit: "count",
          ...countValue(count("stopped")),
        },
      ],
      chart:
        rows.length > 0
          ? {
              type: "bar",
              unit: "count",
              categories: weeks,
              series: [
                {
                  key: "started",
                  label: "Started",
                  values: weeks.map((week) => perWeek.get(week) ?? 0),
                },
              ],
            }
          : null,
      columns: [
        col("outcome", "Outcome"),
        col("escalations", "Escalations", "number"),
      ],
      rows: table,
      population: rows.length,
      outsideWindow: num(outside?.n),
    });
  },
};

export const leadershipReports: ReportDefinition[] = [
  portfolioHealth,
  predictability,
  costToDeliver,
  escalations,
];
