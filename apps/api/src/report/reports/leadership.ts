import { sql } from "drizzle-orm";
import { dayOf, num, selectRows, tsn, tstz } from "../context";
import { countValue, minutesToHours, ratePercent } from "../logic";
import { loadFactRows } from "../snapshot.repository";
import type { ReportContext, ReportDefinition, Row } from "../types";
import {
  cell,
  col,
  emptyBody,
  pageLimit,
  pageRows,
  weekAxis,
  weekKey,
} from "./shared";

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
  pagedExport: true,
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
      ORDER BY CASE COALESCE(p.health, 'unset')
          WHEN 'red' THEN 0 WHEN 'amber' THEN 1 WHEN 'green' THEN 2 ELSE 3 END,
        (SELECT count(*) FROM work_item w JOIN work_item_sla_cache c ON c.work_item_id = w.id
          JOIN state s ON s.id = w.state_id JOIN state_template st ON st.id = s.state_template_id
          WHERE w.project_id = p.id AND w.deleted_at IS NULL AND c.state = 'breached'
            AND st."group" NOT IN ('completed', 'cancelled')) DESC,
        p.name, p.id ${pageLimit(ctx, 500)}`);
    const page = pageRows(ctx, rows, 500);
    const table: Row[] = page.rows
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
      truncated: page.truncated,
      population: table.length,
      notes,
    });
  },
};

const predictability: ReportDefinition = {
  key: "predictability",
  category: "leadership",
  title: "Predictability",
  pagedExport: true,
  async compute(ctx) {
    const facts = await loadFactRows(
      ctx,
      "cycle_completion",
      ctx.window.from,
      ctx.window.to,
    );
    const cycleIds = [
      ...new Set(
        facts
          .map((fact) => fact.dimensions.cycleId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const currentCycles = cycleIds.length
      ? await selectRows<{
          id: string;
          cycle: string;
          slug: string;
        }>(sql`SELECT c.id,c.name AS cycle,p.slug
          FROM cycle c JOIN project p ON p.id=c.project_id
          WHERE c.workspace_id=${ctx.workspaceId} AND p.deleted_at IS NULL AND ${ctx.reach}
            AND ${projectFilterSql(ctx)} AND c.id IN (${sql.join(
              cycleIds.map((id) => sql`${id}`),
              sql`, `,
            )})`)
      : [];
    const cycleById = new Map(currentCycles.map((row) => [row.id, row]));
    const allRows = facts
      .flatMap((fact) => {
        const cycleId = fact.dimensions.cycleId;
        const cycle = cycleId ? cycleById.get(cycleId) : undefined;
        if (!cycle) return [];
        return [
          {
            cycle_id: cycle.id,
            cycle: cycle.cycle,
            slug: cycle.slug,
            unit: fact.dimensions.unit ?? "unknown",
            committed: String(fact.measures.scopePoints ?? 0),
            delivered: String(fact.measures.completedPoints ?? 0),
            items: String(fact.measures.itemCount ?? 0),
            unestimated: String(fact.measures.unestimatedCount ?? 0),
            completed_at: fact.day,
          },
        ];
      })
      .sort(
        (a, b) =>
          String(b.completed_at).localeCompare(String(a.completed_at)) ||
          a.cycle_id.localeCompare(b.cycle_id),
      );
    const pageInput = ctx.exportPage
      ? allRows.slice(
          ctx.exportPage.offset,
          ctx.exportPage.offset + ctx.exportPage.limit,
        )
      : allRows.slice(0, 201);
    const page = pageRows(ctx, pageInput, 200);
    const table: Row[] = page.rows.map((row) => {
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
    const comparable = page.rows.filter((row) => num(row.committed) > 0);
    const onTarget = comparable.filter(
      (row) => num(row.delivered) / num(row.committed) >= 0.8,
    ).length;
    return emptyBody({
      metrics: [
        {
          key: "cycles",
          label: "Cycles completed",
          unit: "count",
          ...countValue(page.rows.length),
        },
        {
          key: "on_target",
          label: "Delivered at least 80% of commitment",
          unit: "percent",
          ...ratePercent(onTarget, comparable.length, 3),
        },
      ],
      chart:
        page.rows.length > 0 &&
        new Set(page.rows.map((row) => row.unit)).size === 1
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
      truncated: page.truncated,
      population: table.length,
      notes:
        new Set(page.rows.map((row) => row.unit)).size > 1
          ? ["mixed_units"]
          : [],
    });
  },
};

const costToDeliver: ReportDefinition = {
  key: "cost_to_deliver",
  category: "leadership",
  title: "Cost to deliver",
  feature: "feature.time_tracking",
  rated: true,
  pagedExport: true,
  async compute(ctx) {
    // Hours are visible to anyone who may see the time. Every amount is rate-derived, so it is
    // only selected for a caller who may see rates (TC-11); `present.ts` strips it again as a backstop.
    const budgetWhere = sql`b.workspace_id = ${ctx.workspaceId} AND p.deleted_at IS NULL
      AND ${ctx.reach} AND ${projectFilterSql(ctx)}
      AND b.period_start <= ${dayOf(new Date(ctx.window.to.getTime() - 1))}::date
      AND b.period_end >= ${dayOf(ctx.window.from)}::date`;
    const budgetCountRows =
      ctx.showRates && ctx.exportPage
        ? await selectRows<{ n: string }>(
            sql`SELECT count(*) AS n FROM budget b JOIN project p ON p.id=b.project_id WHERE ${budgetWhere}`,
          )
        : [];
    const budgetTotal = num(budgetCountRows[0]?.n);
    const offset = ctx.exportPage?.offset ?? 0;
    const limit = ctx.exportPage?.limit ?? 200;
    const budgetSkip = Math.min(offset, budgetTotal);
    const budgetTake = ctx.exportPage
      ? Math.max(0, Math.min(limit, budgetTotal - offset))
      : 200;
    const hoursSkip = ctx.exportPage ? Math.max(0, offset - budgetTotal) : 0;
    const hoursTake = ctx.exportPage ? limit - budgetTake : 200;
    const budgetRows = ctx.showRates
      ? await selectRows<{
          budget_id: string;
          project_id: string;
          slug: string;
          name: string;
          budget: string;
          currency: string;
          planned: string;
          period_start: string;
          period_end: string;
        }>(sql`SELECT b.id AS budget_id,b.project_id,p.slug,p.name,b.name AS budget,b.currency,
          b.planned_amount_minor AS planned,b.period_start::text AS period_start,b.period_end::text AS period_end
        FROM budget b JOIN project p ON p.id=b.project_id WHERE ${budgetWhere}
        ORDER BY p.name,b.period_start,b.id LIMIT ${budgetTake} OFFSET ${budgetSkip}`)
      : [];
    const allBudgetProjectRows =
      ctx.showRates && ctx.exportPage
        ? await selectRows<{ project_id: string }>(
            sql`SELECT DISTINCT b.project_id FROM budget b JOIN project p ON p.id=b.project_id WHERE ${budgetWhere}`,
          )
        : [];
    const allBudgetProjects = new Set(
      allBudgetProjectRows.map((row) => row.project_id),
    );
    const currentTimeFacts = await loadFactRows(
      ctx,
      "time_logged",
      ctx.window.from,
      ctx.window.to,
    );
    const budgetPeriodStart = budgetRows.length
      ? new Date(
          `${budgetRows.map((row) => row.period_start).sort()[0]}T00:00:00.000Z`,
        )
      : null;
    const budgetPeriodEnd = budgetRows.length
      ? new Date(
          `${budgetRows
            .map((row) => row.period_end)
            .sort()
            .at(-1)}T00:00:00.000Z`,
        )
      : null;
    const wideTimeFacts =
      ctx.showRates && budgetPeriodStart && budgetPeriodEnd
        ? await loadFactRows(
            ctx,
            "time_logged",
            budgetPeriodStart,
            new Date(budgetPeriodEnd.getTime() + 86_400_000),
            "budget_period",
          )
        : [];
    const wideCostFacts =
      ctx.showRates && budgetPeriodStart && budgetPeriodEnd
        ? await loadFactRows(
            ctx,
            "cost_entry",
            budgetPeriodStart,
            new Date(budgetPeriodEnd.getTime() + 86_400_000),
            "budget_period",
          )
        : [];
    const currentHours = new Map<
      string,
      { project_id: string; minutes: number }
    >();
    for (const fact of currentTimeFacts) {
      if (!fact.project_id) continue;
      const row = currentHours.get(fact.project_id) ?? {
        project_id: fact.project_id,
        minutes: 0,
      };
      row.minutes += fact.measures.minutes ?? 0;
      currentHours.set(fact.project_id, row);
    }
    const hourProjectIds = [...currentHours.keys()];
    const hourProjects = hourProjectIds.length
      ? await selectRows<{ id: string; slug: string; name: string }>(
          sql`SELECT id,slug,name FROM project WHERE id IN (${sql.join(
            hourProjectIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
      : [];
    const hourProjectById = new Map(hourProjects.map((row) => [row.id, row]));
    let hours = [...currentHours.values()]
      .flatMap((row) => {
        const project = hourProjectById.get(row.project_id);
        if (
          !project ||
          (ctx.exportPage &&
            ctx.showRates &&
            allBudgetProjects.has(row.project_id))
        )
          return [];
        return [{ ...row, ...project }];
      })
      .sort(
        (a, b) =>
          b.minutes - a.minutes || a.project_id.localeCompare(b.project_id),
      );
    hours = ctx.exportPage
      ? hours.slice(hoursSkip, hoursSkip + hoursTake)
      : hours.slice(0, 200);
    ctx.snapshots.sources.liveComponents.add("budget_definitions");
    ctx.snapshots.use.liveParts = true;
    const budgets = budgetRows.map((budget) => {
      const time = wideTimeFacts.filter(
        (fact) =>
          fact.project_id === budget.project_id &&
          fact.dimensions.currency === budget.currency &&
          fact.day >= budget.period_start &&
          fact.day <= budget.period_end,
      );
      const costs = wideCostFacts.filter(
        (fact) =>
          fact.project_id === budget.project_id &&
          fact.dimensions.currency === budget.currency &&
          fact.day >= budget.period_start &&
          fact.day <= budget.period_end,
      );
      return {
        ...budget,
        actual: String(
          time.reduce(
            (sum, fact) => sum + (fact.measures.budgetCostMinor ?? 0),
            0,
          ) +
            costs.reduce(
              (sum, fact) => sum + (fact.measures.amountMinor ?? 0),
              0,
            ),
        ),
        unpriced: String(
          wideTimeFacts
            .filter(
              (fact) =>
                fact.project_id === budget.project_id &&
                fact.day >= budget.period_start &&
                fact.day <= budget.period_end,
            )
            .reduce(
              (sum, fact) => sum + (fact.measures.unpricedMinutes ?? 0),
              0,
            ),
        ),
        minutes: String(
          wideTimeFacts
            .filter(
              (fact) =>
                fact.project_id === budget.project_id &&
                fact.day >= budget.period_start &&
                fact.day <= budget.period_end,
            )
            .reduce((sum, fact) => sum + (fact.measures.minutes ?? 0), 0),
        ),
      };
    });
    const budgeted = new Set(budgets.map((row) => row.project_id));
    const table: Row[] = [
      ...budgets.map((row) => {
        const planned = num(row.planned);
        const actual = Math.round(num(row.actual));
        return {
          _drill: `budget:${row.budget_id}`,
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
        .filter((row) => ctx.exportPage || !budgeted.has(row.project_id))
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
      population: table.length,
      notes: ctx.showRates ? [] : ["costs_hidden"],
    });
  },
};

const escalations: ReportDefinition = {
  key: "escalations",
  category: "leadership",
  title: "Escalations",
  async compute(ctx) {
    const facts = await loadFactRows(
      ctx,
      "escalation_started",
      ctx.window.from,
      ctx.window.to,
    );
    const rows = facts.map((fact) => ({
      started_at: new Date(`${fact.day}T00:00:00.000Z`),
      state: fact.dimensions.state ?? "unknown",
      stop_reason: fact.dimensions.stopReason,
      count: fact.measures.count ?? 0,
    }));
    const [outside] = await selectRows<{
      n: string;
    }>(sql`SELECT count(*) AS n FROM sla_escalation e
      JOIN project p ON p.id = e.project_id
      WHERE e.workspace_id = ${ctx.workspaceId} AND p.deleted_at IS NULL
        AND ${ctx.reach} AND ${projectFilterSql(ctx)}
        AND NOT (e.started_at >= ${tstz(ctx.window.from)} AND e.started_at < ${tstz(ctx.window.to)})`);
    ctx.snapshots.sources.liveComponents.add("outside_window");
    const weeks = weekAxis(ctx);
    const perWeek = new Map<string, number>();
    for (const row of rows) {
      const key = weekKey(row.started_at);
      perWeek.set(key, (perWeek.get(key) ?? 0) + row.count);
    }
    const byOutcome = new Map<string, number>();
    for (const row of rows) {
      const key =
        row.state === "stopped"
          ? `stopped: ${row.stop_reason ?? "unknown"}`
          : row.state;
      byOutcome.set(key, (byOutcome.get(key) ?? 0) + row.count);
    }
    const table: Row[] = [...byOutcome.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([outcome, count]) => ({ outcome, escalations: count }));
    const count = (state: string) =>
      rows
        .filter((row) => row.state === state)
        .reduce((sum, row) => sum + row.count, 0);
    return emptyBody({
      metrics: [
        {
          key: "started",
          label: "Escalations started",
          unit: "count",
          ...countValue(rows.reduce((sum, row) => sum + row.count, 0)),
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
      population: rows.reduce((sum, row) => sum + row.count, 0),
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
