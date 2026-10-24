import type { ResolvedIdentity } from "@taskdesk/permissions";
import { sql } from "drizzle-orm";
import { z } from "../openapi";
import {
  buildContext,
  cleanFilters,
  dayOf,
  itemFrom,
  num,
  selectRows,
  timeFrom,
  tsn,
} from "./context";
import { workspaceFeatureEnabled } from "./feature";
import { countValue, minutesToHours, type ReportWindow } from "./logic";
import { type ReportEnvelope, stripRates } from "./present";
import { itemsOf, rowCap, timeItemsOf } from "./reports/shared";
import { type ReportCaps, scopeCounts } from "./run";
import type { DrillItem, Row } from "./types";

/**
 * Tier 3 (RP, "Customisable reports"): a saved view's query with a `groupBy` and an `aggregate`.
 * The filter grammar is deliberately small: no joins across entities, no computed fields and no
 * scripting. Anything outside it is a 422, never a silently ignored clause.
 */
export const CUSTOM_ENTITIES = ["work_item", "time_entry"] as const;
export const CUSTOM_CHART_TYPES = ["bar", "line", "table", "number"] as const;
export const CUSTOM_FILTER_KEYS = [
  "projectId",
  "organisationId",
  "teamId",
  "typeId",
  "priority",
  "window",
  "from",
  "to",
] as const;

export const customQuerySchema = z.object({
  entity: z.enum(CUSTOM_ENTITIES).default("work_item"),
  filter: z.record(z.string(), z.unknown()).optional(),
  groupBy: z.string().min(1).max(120).optional(),
  aggregate: z.record(z.string(), z.unknown()).optional(),
});

export type CustomQuery = z.infer<typeof customQuerySchema>;

export type CustomProblem =
  | "unsupported_filter"
  | "unsupported_group"
  | "unsupported_aggregate";

const ITEM_GROUPS = [
  "project",
  "assignee",
  "type",
  "priority",
  "state",
  "week",
];
const TIME_GROUPS = ["project", "person", "activity", "week"];

export function validateCustomQuery(query: CustomQuery): CustomProblem | null {
  for (const key of Object.keys(query.filter ?? {}))
    if (!(CUSTOM_FILTER_KEYS as readonly string[]).includes(key))
      return "unsupported_filter";
  const group = query.groupBy;
  if (group) {
    const allowed = query.entity === "work_item" ? ITEM_GROUPS : TIME_GROUPS;
    const isField = group.startsWith("field:") && query.entity === "work_item";
    if (!allowed.includes(group) && !isField) return "unsupported_group";
  }
  const fn = query.aggregate?.fn;
  if (fn !== undefined && fn !== "count" && fn !== "sum")
    return "unsupported_aggregate";
  if (
    fn === "sum" &&
    (query.entity !== "time_entry" || query.aggregate?.field !== "minutes")
  )
    return "unsupported_aggregate";
  return null;
}

export function customWindowInput(query: CustomQuery) {
  const filter = query.filter ?? {};
  const read = (key: string) =>
    typeof filter[key] === "string" ? (filter[key] as string) : undefined;
  return { window: read("window"), from: read("from"), to: read("to") };
}

const NO_VALUE = "(none)";

/** The label and SQL grouping of one `groupBy` over the entity's aliases. */
async function groupExpression(
  query: CustomQuery,
  workspaceId: string,
): Promise<{ label: ReturnType<typeof sql>; joins: ReturnType<typeof sql> }> {
  const group = query.groupBy;
  const none = sql.raw(`'${NO_VALUE}'`);
  if (!group) return { label: sql`'Total'`, joins: sql`` };
  if (query.entity === "time_entry") {
    switch (group) {
      case "project":
        return { label: sql`p.name`, joins: sql`` };
      case "person":
        return {
          label: sql`COALESCE(pe.display_name, u.name, 'Unknown')`,
          joins: sql``,
        };
      case "activity":
        return {
          label: sql`ta.name`,
          joins: sql`JOIN time_activity ta ON ta.id = te.activity_id`,
        };
      default:
        return {
          label: sql`to_char(date_trunc('week', te.date::timestamp), 'YYYY-MM-DD')`,
          joins: sql``,
        };
    }
  }
  if (group.startsWith("field:")) {
    const fieldId = group.slice("field:".length);
    const [field] = await selectRows<{
      id: string;
    }>(sql`SELECT id FROM custom_field
      WHERE id = ${fieldId} AND workspace_id = ${workspaceId} AND deleted_at IS NULL`);
    // A field deleted after the report was saved keeps the report: one group, labelled as such.
    if (!field) return { label: sql`'(deleted field)'`, joins: sql`` };
    return {
      label: sql`COALESCE(cfv.value #>> '{}', cfv.value::text, ${none})`,
      joins: sql`LEFT JOIN custom_field_value cfv ON cfv.custom_field_id = ${fieldId}
        AND cfv.entity_type = 'work_item' AND cfv.entity_id = w.id`,
    };
  }
  switch (group) {
    case "project":
      return { label: sql`p.name`, joins: sql`` };
    case "assignee":
      return {
        label: sql`COALESCE(pa.display_name, ua.name, '(unassigned)')`,
        joins: sql`LEFT JOIN person pa ON pa.id = w.assignee_id LEFT JOIN "user" ua ON ua.id = pa.user_id`,
      };
    case "type":
      return {
        label: sql`COALESCE(wt.name, '(no type)')`,
        joins: sql`LEFT JOIN work_item_type wt ON wt.id = w.type_id`,
      };
    case "priority":
      return { label: sql`COALESCE(w.priority, 'none')`, joins: sql`` };
    case "state":
      return { label: sql`st.name`, joins: sql`` };
    default:
      return {
        label: sql`to_char(date_trunc('week', w.created_at), 'YYYY-MM-DD')`,
        joins: sql``,
      };
  }
}

export async function runCustomReport(input: {
  title: string;
  query: CustomQuery;
  workspaceId: string;
  identity: ResolvedIdentity;
  caps: ReportCaps;
  window: ReportWindow;
  chartType: (typeof CUSTOM_CHART_TYPES)[number];
  now?: Date;
  /** RP-10: a background export, which returns more groups than the screen. */
  exporting?: boolean;
}): Promise<ReportEnvelope> {
  const { query } = input;
  const ctx = buildContext({
    workspaceId: input.workspaceId,
    identity: input.identity,
    readAll: input.caps.readAll,
    showRates: false,
    readAnyTime: input.caps.readAnyTime,
    ...(input.now ? { now: input.now } : {}),
    window: input.window,
    filters: cleanFilters(query.filter ?? {}),
    ...(input.exporting ? { exporting: true } : {}),
  });
  const cap = rowCap(ctx, 200);
  const timeOn =
    query.entity === "time_entry" &&
    (await workspaceFeatureEnabled(input.workspaceId, "feature.time_tracking"));
  const { label, joins } = await groupExpression(query, input.workspaceId);
  const summing = query.aggregate?.fn === "sum";
  const measure = summing ? sql`sum(te.minutes)` : sql`count(*)`;
  let groups: Array<{ label: string; value: string }> = [];
  if (query.entity === "work_item") {
    groups = await selectRows(sql`SELECT ${label} AS label, count(*) AS value
      ${itemFrom(ctx, joins)}
      AND w.created_at >= ${tsn(ctx.window.from)} AND w.created_at < ${tsn(ctx.window.to)}
      GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT ${cap}`);
  } else if (timeOn) {
    groups = await selectRows(sql`SELECT ${label} AS label, ${measure} AS value
      ${timeFrom(ctx, joins)}
      AND te.date >= ${dayOf(ctx.window.from)}::date AND te.date <= ${dayOf(new Date(ctx.window.to.getTime() - 1))}::date
      GROUP BY 1 ORDER BY ${measure} DESC, 1 LIMIT ${cap}`);
  }
  const timeUnits = summing;
  const rows: Row[] = groups.map((row) => ({
    group: row.label,
    value: timeUnits ? minutesToHours(num(row.value)) : num(row.value),
  }));
  const total = rows.reduce((sum, row) => sum + Number(row.value), 0);
  const unit = timeUnits ? "hours" : "count";
  const weekly = query.groupBy === "week";
  if (weekly)
    rows.sort((a, b) => String(a.group).localeCompare(String(b.group)));
  const scope = await scopeCounts(ctx);
  const empty = rows.length === 0;
  const envelope: ReportEnvelope = {
    key: "custom",
    title: input.title,
    category: "delivery",
    tier: 1,
    scope: {
      kind: input.caps.readAll ? "all" : "reach",
      projectCount: scope.projects,
    },
    window: {
      preset: input.window.preset,
      from: input.window.from.toISOString(),
      to: input.window.to.toISOString(),
      days: input.window.days,
      live: false,
    },
    asOf: ctx.now.toISOString(),
    boundary: "live",
    snapshot: null,
    filters: ctx.filters,
    options: { chartType: input.chartType },
    choices: [],
    metrics: [
      {
        key: "total",
        label: timeUnits
          ? "Hours"
          : query.entity === "work_item"
            ? "Items"
            : "Entries",
        unit,
        ...countValue(Math.round(total * 10) / 10),
      },
    ],
    chart:
      empty || input.chartType === "table" || input.chartType === "number"
        ? null
        : {
            type: input.chartType === "line" ? "line" : "bar",
            unit,
            categories: rows.map((row) => String(row.group)),
            series: [
              {
                key: "value",
                label: timeUnits ? "Hours" : "Count",
                values: rows.map((row) => Number(row.value)),
              },
            ],
          },
    columns: [
      { key: "group", label: query.groupBy ? "Group" : "All", kind: "text" },
      {
        key: "value",
        label: timeUnits ? "Hours" : "Count",
        kind: timeUnits ? "hours" : "number",
      },
    ],
    // RP-12: a group row carries its own label as the drill handle; the same expression picks its items.
    rows: empty
      ? []
      : rows.map((row) => ({ ...row, _drill: String(row.group) })),
    truncated: groups.length >= cap,
    empty: empty
      ? {
          reason:
            query.entity === "time_entry" && !timeOn
              ? "no_data"
              : "no_data_in_window",
          outsideWindow: 0,
          excluded: null,
        }
      : null,
    excluded: null,
    notes:
      query.entity === "time_entry" && !timeOn ? ["time_tracking_off"] : [],
    drill: !empty,
    costVisible: false,
  };
  return stripRates(envelope, false);
}

/**
 * RP-12: the work items or time entries behind one group of a tier 3 report, under the same window,
 * filters and reach as the report. The handle is the group's label (the report groups by that
 * label, so two people with one name are one group and one drill). No handle lists the whole
 * population. Time entries carry hours only, never a rate.
 */
export async function drillCustomReport(input: {
  query: CustomQuery;
  handle: string | null;
  limit: number;
  workspaceId: string;
  identity: ResolvedIdentity;
  caps: ReportCaps;
  window: ReportWindow;
  now?: Date;
}): Promise<DrillItem[]> {
  const { query, handle } = input;
  const ctx = buildContext({
    workspaceId: input.workspaceId,
    identity: input.identity,
    readAll: input.caps.readAll,
    showRates: false,
    readAnyTime: input.caps.readAnyTime,
    ...(input.now ? { now: input.now } : {}),
    window: input.window,
    filters: cleanFilters(query.filter ?? {}),
  });
  const { label, joins } = await groupExpression(query, input.workspaceId);
  const narrowed =
    handle !== null && query.groupBy ? sql`${label} = ${handle}` : sql`true`;
  if (query.entity === "time_entry") {
    if (
      !(await workspaceFeatureEnabled(
        input.workspaceId,
        "feature.time_tracking",
      ))
    )
      return [];
    return timeItemsOf(
      ctx,
      sql`te.date >= ${dayOf(ctx.window.from)}::date AND te.date <= ${dayOf(new Date(ctx.window.to.getTime() - 1))}::date AND ${narrowed}`,
      joins,
      input.limit,
    );
  }
  return itemsOf(
    ctx,
    sql`w.created_at >= ${tsn(ctx.window.from)} AND w.created_at < ${tsn(ctx.window.to)} AND ${narrowed}`,
    input.limit,
    sql`w.created_at DESC`,
    joins,
  );
}
