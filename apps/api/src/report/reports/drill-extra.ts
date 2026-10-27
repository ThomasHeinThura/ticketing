import { sql } from "drizzle-orm";
import { dayOf, num, OPEN, selectRows, timeFrom, tstz } from "../context";
import { minutesToHours } from "../logic";
import type { DrillItem, ReportContext, ReportDefinition, Row } from "../types";
import { burndownCycle } from "./agile";
import { itemsOf, timeItemsOf } from "./shared";

/**
 * RP-12 for the reports that had no drill-down: breach analysis, satisfaction, utilisation,
 * capacity, portfolio health, predictability, cost to deliver, escalations, time logged, the
 * knowledge base report and the two cycle reports.
 *
 * A report that counts something other than "items in a window" says so here instead of in its own
 * file: `handleOf` reads the drill handle from the row the report already returns (its own label),
 * and `items` lists what that row counted, under the same window, filters and reach (`ctx.reach` is
 * on every query). `run.ts` adds the handle to each row and marks the report drillable, and the
 * drill route falls back to `items` when the definition has no `drillItems` of its own.
 *
 * Time entries come back as hours only: no rate and no cost, whatever the caller may see (TC-11).
 */
export type ExtraDrill = {
  handleOf: (row: Row, ctx: ReportContext) => string | null;
  items: (
    ctx: ReportContext,
    handle: string | null,
    limit: number,
  ) => Promise<DrillItem[]>;
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** The report applies only the project and organisation filters; so does its drill. */
function projectOrgOnly(ctx: ReportContext): ReportContext {
  const { projectId, organisationId } = ctx.filters;
  return {
    ...ctx,
    filters: {
      ...(projectId ? { projectId } : {}),
      ...(organisationId ? { organisationId } : {}),
    },
  };
}

function timeDates(ctx: ReportContext) {
  return sql`te.date >= ${dayOf(ctx.window.from)}::date AND te.date <= ${dayOf(new Date(ctx.window.to.getTime() - 1))}::date`;
}

function projectOrgFilters(ctx: ReportContext) {
  const { projectId, organisationId } = ctx.filters;
  return sql`${projectId ? sql`p.id = ${projectId}` : sql`true`}
    AND ${organisationId ? sql`p.organisation_id = ${organisationId}` : sql`true`}`;
}

function costEntryFilters(ctx: ReportContext) {
  const { teamId, typeId, priority } = ctx.filters;
  return sql`${
    teamId
      ? sql`EXISTS (
          SELECT 1 FROM team_member tm
          JOIN team t ON t.id = tm.team_id AND t.workspace_id = ${ctx.workspaceId}
          JOIN person tp ON tp.user_id = tm.user_id
          WHERE tm.team_id = ${teamId} AND tp.id = ce.person_id)`
      : sql`true`
  }
    AND ${
      typeId
        ? sql`EXISTS (SELECT 1 FROM work_item wi WHERE wi.id = ce.work_item_id AND wi.type_id = ${typeId})`
        : sql`true`
    }
    AND ${
      priority
        ? sql`EXISTS (SELECT 1 FROM work_item wi WHERE wi.id = ce.work_item_id AND wi.priority = ${priority})`
        : sql`true`
    }`;
}

const PERSON = sql`COALESCE(pe.display_name, u.name, 'Unknown')`;
/** `Name (slug)`: the project label the reports build; its slug is what the drill matches. */
const slugOf = (label: unknown): string | null => {
  const value = text(label);
  if (!value) return null;
  return /\(([^()]+)\)\s*$/.exec(value)?.[1] ?? value;
};

function clockOf(ctx: ReportContext): "resolution" | "first_response" {
  return ctx.options.metric === "first_response"
    ? "first_response"
    : "resolution";
}

const breachAnalysis: ExtraDrill = {
  handleOf: (row, ctx) => {
    const by =
      ctx.options.by === "priority" || ctx.options.by === "customer"
        ? ctx.options.by
        : "type";
    return text(row[by]);
  },
  items: (ctx, handle, limit) => {
    const by =
      ctx.options.by === "priority" || ctx.options.by === "customer"
        ? ctx.options.by
        : "type";
    const clock = clockOf(ctx);
    const label =
      by === "type"
        ? sql`COALESCE((SELECT wt.name FROM work_item_type wt WHERE wt.id = w.type_id), '(no type)')`
        : by === "priority"
          ? sql`COALESCE(w.priority, 'none')`
          : sql`COALESCE((SELECT o.name FROM organisation o WHERE o.id = p.organisation_id), '(no organisation)')`;
    return itemsOf(
      ctx,
      sql`EXISTS (SELECT 1 FROM work_item_sla_cache c
          WHERE c.work_item_id = w.id AND c.metric = ${clock}
            AND c.state IN ('met', 'missed', 'breached')
            AND c.due_at >= ${tstz(ctx.window.from)} AND c.due_at < ${tstz(ctx.window.to)})
        AND ${handle === null ? sql`true` : sql`${label} = ${handle}`}`,
      limit,
      sql`(SELECT (c.state IN ('missed', 'breached'))::int FROM work_item_sla_cache c
          WHERE c.work_item_id = w.id AND c.metric = ${clock}) DESC, w.updated_at DESC`,
    );
  },
};

const satisfaction: ExtraDrill = {
  handleOf: (row, ctx) =>
    text(row[ctx.options.by === "request_type" ? "request_type" : "customer"]),
  items: (ctx, handle, limit) => {
    const byRequestType = ctx.options.by === "request_type";
    const label = byRequestType
      ? sql`COALESCE((SELECT rt.name FROM submission s2
          JOIN request_type rt ON rt.id = s2.request_type_id
          WHERE s2.work_item_id = w.id AND s2.state <> 'duplicate'
          ORDER BY s2.created_at, s2.id LIMIT 1), '(not raised through a request type)')`
      : sql`COALESCE((SELECT o.name FROM organisation o WHERE o.id = p.organisation_id), '(no organisation)')`;
    return itemsOf(
      ctx,
      sql`EXISTS (SELECT 1 FROM satisfaction_rating sr
          WHERE sr.work_item_id = w.id
            AND sr.created_at >= ${tstz(ctx.window.from)} AND sr.created_at < ${tstz(ctx.window.to)})
        AND ${handle === null ? sql`true` : sql`${label} = ${handle}`}`,
      limit,
    );
  },
};

const utilisation: ExtraDrill = {
  handleOf: (row) => text(row.person),
  items: (ctx, handle, limit) =>
    timeItemsOf(
      ctx,
      sql`${timeDates(ctx)} AND ${handle === null ? sql`true` : sql`${PERSON} = ${handle}`}`,
      sql``,
      limit,
    ),
};

const capacity: ExtraDrill = {
  handleOf: (row) => text(row.team),
  items: (ctx, handle, limit) =>
    timeItemsOf(
      ctx,
      sql`${timeDates(ctx)} AND ${
        handle === null
          ? sql`true`
          : sql`EXISTS (SELECT 1 FROM team_member tm
              JOIN team tt ON tt.id = tm.team_id AND tt.workspace_id = ${ctx.workspaceId}
              WHERE tm.user_id = pe.user_id AND tt.name = ${handle})`
      }`,
      sql``,
      limit,
    ),
};

const timeLogged: ExtraDrill = {
  handleOf: (row, ctx) =>
    text(
      row[
        ctx.options.by === "person" || ctx.options.by === "activity"
          ? ctx.options.by
          : "project"
      ],
    ),
  items: (ctx, handle, limit) => {
    const by =
      ctx.options.by === "person" || ctx.options.by === "activity"
        ? ctx.options.by
        : "project";
    const label =
      by === "project"
        ? sql`p.name || ' (' || p.slug || ')'`
        : by === "person"
          ? PERSON
          : sql`ta.name`;
    return timeItemsOf(
      ctx,
      sql`${timeDates(ctx)} AND ${handle === null ? sql`true` : sql`${label} = ${handle}`}`,
      sql`JOIN time_activity ta ON ta.id = te.activity_id`,
      limit,
    );
  },
};

const costToDeliver: ExtraDrill = {
  handleOf: (row) => text(row._drill) ?? slugOf(row.project),
  // A caller who may not see rates sees no currency either (it names the rate card in use).
  items: async (ctx, handle, limit) => {
    const items = await costToDeliverItems(ctx, handle, limit);
    return ctx.showRates
      ? items
      : items.map(({ currency: _currency, ...rest }) => rest);
  },
};

const costToDeliverItems: ExtraDrill["items"] = async (ctx, handle, limit) => {
  const budgetId = handle?.startsWith("budget:")
    ? handle.slice("budget:".length)
    : null;
  if (budgetId !== null) {
    if (!ctx.showRates || budgetId.length === 0) return [];
    const [budget] = await selectRows<{
      id: string;
      project_id: string;
      currency: string;
      period_start: string;
      period_end: string;
    }>(sql`SELECT b.id, b.project_id, b.currency, b.period_start, b.period_end
        FROM budget b JOIN project p ON p.id = b.project_id
        WHERE b.id = ${budgetId} AND b.workspace_id = ${ctx.workspaceId}
          AND p.deleted_at IS NULL AND ${ctx.reach} AND ${projectOrgFilters(ctx)}
          AND b.period_start <= ${dayOf(new Date(ctx.window.to.getTime() - 1))}::date
          AND b.period_end >= ${dayOf(ctx.window.from)}::date`);
    if (!budget) return [];

    const [timeRows, costRows] = await Promise.all([
      selectRows<{
        id: string;
        date: string;
        person: string | null;
        project_key: string | null;
        work_item_key: string | null;
        title: string | null;
        minutes: string;
        currency: string;
      }>(sql`SELECT te.id, te.date::text AS date, ${PERSON} AS person,
            p.slug AS project_key, w.key AS work_item_key,
            COALESCE(NULLIF(btrim(te.description), ''), w.title) AS title,
            te.minutes, te.currency
          ${timeFrom(ctx)}
          AND te.project_id = ${budget.project_id} AND te.currency = ${budget.currency}
          AND te.rate_minor IS NOT NULL
          AND te.date >= ${budget.period_start}::date AND te.date <= ${budget.period_end}::date
          ORDER BY te.date DESC, te.created_at DESC LIMIT ${limit}`),
      selectRows<{
        id: string;
        date: string;
        person: string | null;
        project_key: string | null;
        work_item_key: string | null;
        title: string;
        currency: string;
      }>(sql`SELECT ce.id, ce.date::text AS date, ${PERSON} AS person,
            p.slug AS project_key, w.key AS work_item_key,
            ct.name || CASE WHEN NULLIF(btrim(ce.note), '') IS NULL THEN '' ELSE ' — ' || btrim(ce.note) END AS title,
            ce.currency
          FROM cost_entry ce
          JOIN project p ON p.id = ce.project_id
          JOIN person pe ON pe.id = ce.person_id
          LEFT JOIN "user" u ON u.id = pe.user_id
          LEFT JOIN work_item w ON w.id = ce.work_item_id
          JOIN cost_type ct ON ct.id = ce.cost_type_id AND ct.workspace_id = ${ctx.workspaceId}
          WHERE ce.workspace_id = ${ctx.workspaceId} AND p.deleted_at IS NULL
            AND ${ctx.reach} AND ${projectOrgFilters(ctx)}
            AND ce.project_id = ${budget.project_id} AND ce.currency = ${budget.currency}
            AND ce.date >= ${budget.period_start}::date AND ce.date <= ${budget.period_end}::date
            AND ${ctx.readAnyTime ? sql`true` : sql`ce.person_id = ${ctx.identity.personId}`}
            AND ${costEntryFilters(ctx)}
          ORDER BY ce.date DESC, ce.created_at DESC LIMIT ${limit}`),
    ]);
    const timeItems: DrillItem[] = timeRows.map((row) => ({
      kind: "time_entry",
      key: row.id,
      title: row.title ?? "",
      projectKey: row.project_key,
      state: null,
      priority: null,
      date: row.date,
      person: row.person,
      hours: minutesToHours(num(row.minutes)),
      workItemKey: row.work_item_key,
      currency: row.currency,
    }));
    const costs: DrillItem[] = costRows.map((row) => ({
      kind: "cost_entry",
      key: row.id,
      title: row.title,
      projectKey: row.project_key,
      state: null,
      priority: null,
      date: row.date,
      person: row.person,
      workItemKey: row.work_item_key,
      currency: row.currency,
    }));
    return [...timeItems, ...costs]
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, limit);
  }

  const timeRows = await selectRows<{
    id: string;
    date: string;
    person: string | null;
    project_key: string | null;
    work_item_key: string | null;
    title: string | null;
    minutes: string;
    currency: string | null;
  }>(sql`SELECT te.id, te.date::text AS date, ${PERSON} AS person,
        p.slug AS project_key, w.key AS work_item_key,
        COALESCE(NULLIF(btrim(te.description), ''), w.title) AS title,
        te.minutes, te.currency
      ${timeFrom(ctx)}
      AND ${timeDates(ctx)}
      AND ${handle === null ? sql`true` : sql`p.slug = ${handle}`}
      ORDER BY te.date DESC, te.created_at DESC LIMIT ${limit}`);
  return timeRows.map((row) => ({
    kind: "time_entry" as const,
    key: row.id,
    title: row.title ?? "",
    projectKey: row.project_key,
    state: null,
    priority: null,
    date: row.date,
    person: row.person,
    hours: minutesToHours(num(row.minutes)),
    workItemKey: row.work_item_key,
    currency: row.currency,
  }));
};

const portfolioHealth: ExtraDrill = {
  handleOf: (row) => slugOf(row.project),
  items: (ctx, handle, limit) =>
    itemsOf(
      projectOrgOnly(ctx),
      sql`${OPEN} AND ${handle === null ? sql`true` : sql`p.slug = ${handle}`}`,
      limit,
      sql`w.due_date ASC NULLS LAST, w.created_at ASC`,
    ),
};

const predictability: ExtraDrill = {
  handleOf: (row) => {
    const project = text(row.project);
    const cycle = text(row.cycle);
    return project && cycle ? `${project}|${cycle}` : null;
  },
  items: (ctx, handle, limit) => {
    const split = handle?.indexOf("|") ?? -1;
    const slug = handle && split > 0 ? handle.slice(0, split) : null;
    const name = handle && split > 0 ? handle.slice(split + 1) : null;
    return itemsOf(
      projectOrgOnly(ctx),
      handle === null
        ? sql`w.cycle_id IN (SELECT c.id FROM cycle c WHERE c.workspace_id = ${ctx.workspaceId} AND c.completed_at >= ${tstz(ctx.window.from)} AND c.completed_at < ${tstz(ctx.window.to)})`
        : sql`p.slug = ${slug} AND w.cycle_id IN (SELECT c.id FROM cycle c
            WHERE c.workspace_id = ${ctx.workspaceId} AND c.project_id = w.project_id AND c.name = ${name}
              AND c.completed_at >= ${tstz(ctx.window.from)} AND c.completed_at < ${tstz(ctx.window.to)})`,
      limit,
    );
  },
};

const escalations: ExtraDrill = {
  handleOf: (row) => text(row.outcome),
  items: (ctx, handle, limit) =>
    itemsOf(
      projectOrgOnly(ctx),
      sql`EXISTS (SELECT 1 FROM sla_escalation e
          WHERE e.work_item_id = w.id AND e.workspace_id = ${ctx.workspaceId}
            AND e.started_at >= ${tstz(ctx.window.from)} AND e.started_at < ${tstz(ctx.window.to)}
            AND ${
              handle === null
                ? sql`true`
                : sql`(CASE WHEN e.state = 'stopped' THEN 'stopped: ' || COALESCE(e.stop_reason, 'unknown') ELSE e.state END) = ${handle}`
            })`,
      limit,
    ),
};

const kbDeflection: ExtraDrill = {
  handleOf: (row) => text(row.article),
  items: async (ctx, handle, limit) => {
    const rows = await selectRows<{
      id: string;
      title: string;
      state: string;
      project_key: string | null;
      opened: string;
    }>(sql`SELECT a.id, a.title, a.state, p.slug AS project_key, count(d.id) AS opened
      FROM deflection_event d
      JOIN kb_article a ON a.id = d.kb_article_id
      LEFT JOIN project p ON p.id = a.project_id
      WHERE d.workspace_id = ${ctx.workspaceId}
        AND (a.project_id IS NULL OR (p.deleted_at IS NULL AND ${ctx.reach}))
        AND d.created_at >= ${tstz(ctx.window.from)} AND d.created_at < ${tstz(ctx.window.to)}
        AND ${handle === null ? sql`true` : sql`a.title = ${handle}`}
      GROUP BY a.id, a.title, a.state, p.slug
      ORDER BY count(d.id) DESC, a.title LIMIT ${limit}`);
    return rows.map((row) => ({
      kind: "article" as const,
      key: row.id,
      title: row.title,
      projectKey: row.project_key,
      state: row.state,
      priority: null,
      hours: null,
      person: null,
      date: null,
      workItemKey: null,
    }));
  },
};

const cycleBurndown: ExtraDrill = {
  handleOf: (row) => text(row.date),
  items: async (ctx, handle, limit) => {
    const { chosen } = await burndownCycle(ctx);
    if (!chosen) return [];
    const day = handle && /^\d{4}-\d{2}-\d{2}$/.test(handle) ? handle : null;
    return itemsOf(
      projectOrgOnly(ctx),
      sql`w.cycle_id = ${chosen.id}
        AND ${
          day
            ? sql`w.resolved_at >= ${`${day}T00:00:00.000Z`}::timestamp AND w.resolved_at < (${`${day}T00:00:00.000Z`}::timestamp + interval '1 day')`
            : sql`true`
        }`,
      limit,
      sql`w.resolved_at DESC NULLS LAST, w.created_at ASC`,
    );
  },
};

const cycleVelocity: ExtraDrill = {
  handleOf: (row) => text(row.project),
  items: (ctx, handle, limit) =>
    itemsOf(
      projectOrgOnly(ctx),
      sql`st."group" = 'completed'
        AND ${handle === null ? sql`true` : sql`p.slug = ${handle}`}
        AND w.cycle_id IN (SELECT c.id FROM cycle c
          WHERE c.workspace_id = ${ctx.workspaceId} AND c.project_id = w.project_id
            AND c.completed_at IS NOT NULL
            AND c.id IN (SELECT c2.id FROM cycle c2
              WHERE c2.project_id = c.project_id AND c2.completed_at IS NOT NULL
              ORDER BY c2.completed_at DESC LIMIT 3))`,
      limit,
      sql`w.resolved_at DESC NULLS LAST`,
    ),
};

export const EXTRA_DRILL: Readonly<Record<string, ExtraDrill>> = {
  breach_analysis: breachAnalysis,
  satisfaction,
  utilisation,
  capacity,
  time_logged: timeLogged,
  cost_to_deliver: costToDeliver,
  portfolio_health: portfolioHealth,
  predictability,
  escalations,
  kb_deflection: kbDeflection,
  cycle_burndown: cycleBurndown,
  cycle_velocity: cycleVelocity,
};

/** The drill of a report: its own `drillItems`, else the one defined above (RP-12). */
export function drillOf(def: ReportDefinition): ExtraDrill["items"] | null {
  if (def.drillItems) return def.drillItems;
  return EXTRA_DRILL[def.key]?.items ?? null;
}
