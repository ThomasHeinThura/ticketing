import type { ResolvedIdentity } from "@taskdesk/permissions";
import { sql } from "drizzle-orm";
import { z } from "../openapi";
import {
  buildContext,
  cleanFilters,
  dayOf,
  itemFilterSql,
  itemFrom,
  num,
  selectRows,
  timeFrom,
  tsn,
} from "./context";
import { epicReportCtes, parseEpicDrillHandle } from "./epic-rollup";
import { workspaceFeatureEnabled } from "./feature";
import { countValue, minutesToHours, type ReportWindow } from "./logic";
import { type ReportEnvelope, stripRates } from "./present";
import { itemsOf, pageLimit, pageRows, timeItemsOf } from "./reports/shared";
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
  "epic",
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

type EpicReportGroup = {
  label: string;
  handle: string;
  value: string;
  completed: string | null;
  total: string | null;
};

function epicGroupColumns() {
  return [
    { key: "group", label: "Group", kind: "text" as const },
    {
      key: "value",
      label: "Matching work items",
      kind: "number" as const,
    },
    {
      key: "progressCompleted",
      label: "Completed descendants",
      kind: "number" as const,
    },
    {
      key: "progressTotal",
      label: "All descendants",
      kind: "number" as const,
    },
    {
      key: "progressPercent",
      label: "Progress (all descendants)",
      kind: "percent" as const,
    },
  ];
}

function epicGroupLabelSql() {
  return sql`CASE
    WHEN mapping.available = false THEN 'Epic unavailable'
    WHEN mapping.epic_id IS NULL THEN 'No epic'
    ELSE mapping.epic_key || ' — ' || mapping.epic_title
  END`;
}

function epicGroupHandleSql() {
  return sql`CASE
    WHEN mapping.available = false THEN 'epic-unavailable'
    WHEN mapping.epic_id IS NULL THEN 'epic-none'
    ELSE 'epic:' || mapping.epic_id
  END`;
}

async function selectEpicGroups(ctx: ReturnType<typeof buildContext>) {
  return selectRows<EpicReportGroup>(sql`${epicReportCtes(ctx)}
    SELECT
      ${epicGroupLabelSql()} AS label,
      ${epicGroupHandleSql()} AS handle,
      count(*)::text AS value,
      CASE WHEN mapping.available = true AND mapping.epic_id IS NOT NULL
        THEN COALESCE(progress.completed, '0') ELSE NULL END AS completed,
      CASE WHEN mapping.available = true AND mapping.epic_id IS NOT NULL
        THEN COALESCE(progress.total, '0') ELSE NULL END AS total
    ${itemFrom(
      ctx,
      sql`LEFT JOIN epic_mapping mapping ON mapping.item_id = w.id
        LEFT JOIN epic_progress progress ON progress.epic_id = mapping.epic_id`,
    )}
    AND w.created_at >= ${tsn(ctx.window.from)} AND w.created_at < ${tsn(ctx.window.to)}
    GROUP BY mapping.available, mapping.epic_id, mapping.epic_key, mapping.epic_title,
      progress.completed, progress.total
    ORDER BY count(*) DESC, 1
    ${pageLimit(ctx, 200)}`);
}

function epicReportRows(groups: EpicReportGroup[]): Row[] {
  return groups.map((group) => {
    const row: Row = { group: group.label, value: num(group.value) };
    if (group.handle === "epic-none" || group.handle === "epic-unavailable") {
      row.progressCompleted = null;
      row.progressTotal = null;
      row.progressPercent = null;
    } else {
      const completed = num(group.completed ?? "0");
      const total = num(group.total ?? "0");
      row.progressCompleted = completed;
      row.progressTotal = total;
      row.progressPercent = total === 0 ? null : (completed / total) * 100;
    }
    row._drill = group.handle;
    return row;
  });
}

async function epicDrillItems(
  ctx: ReturnType<typeof buildContext>,
  narrowed: ReturnType<typeof sql>,
  limit: number,
): Promise<DrillItem[]> {
  const rows = await selectRows<{
    key: string;
    title: string;
    project_key: string | null;
    state_name: string | null;
    priority: string | null;
  }>(sql`${epicReportCtes(ctx)}
    SELECT w.key, w.title, p.slug AS project_key, st.name AS state_name, w.priority
    FROM work_item w
    JOIN project p ON p.id = w.project_id
    JOIN state s ON s.id = w.state_id
    JOIN state_template st ON st.id = s.state_template_id
    LEFT JOIN epic_mapping mapping ON mapping.item_id = w.id
    WHERE w.workspace_id = ${ctx.workspaceId}
      AND w.deleted_at IS NULL AND p.deleted_at IS NULL
      AND ${ctx.reach} AND ${itemFilterSql(ctx)} AND ${narrowed}
    ORDER BY w.created_at DESC LIMIT ${limit}`);
  return rows.map((row) => ({
    kind: "work_item" as const,
    key: row.key,
    title: row.title,
    projectKey: row.project_key,
    state: row.state_name,
    priority: row.priority,
  }));
}

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
  exportPage?: { offset: number; limit: number };
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
    ...(input.exportPage ? { exportPage: input.exportPage } : {}),
    ...(input.exporting ? { exporting: true } : {}),
  });
  const timeOn =
    query.entity === "time_entry" &&
    (await workspaceFeatureEnabled(input.workspaceId, "feature.time_tracking"));
  const epicGrouped = query.entity === "work_item" && query.groupBy === "epic";
  const { label, joins } = epicGrouped
    ? { label: sql`''`, joins: sql`` }
    : await groupExpression(query, input.workspaceId);
  const summing = query.aggregate?.fn === "sum";
  const measure = summing ? sql`sum(te.minutes)` : sql`count(*)`;
  let groups: Array<{ label: string; value: string }> = [];
  let rows: Row[];
  let truncated: boolean;
  if (epicGrouped) {
    const epicGroups = await selectEpicGroups(ctx);
    const page = pageRows(ctx, epicGroups, 200);
    rows = epicReportRows(page.rows);
    truncated = page.truncated;
  } else {
    if (query.entity === "work_item") {
      groups = await selectRows(sql`SELECT ${label} AS label, count(*) AS value
        ${itemFrom(ctx, joins)}
        AND w.created_at >= ${tsn(ctx.window.from)} AND w.created_at < ${tsn(ctx.window.to)}
        GROUP BY 1 ORDER BY count(*) DESC, 1 ${pageLimit(ctx, 200)}`);
    } else if (timeOn) {
      groups =
        await selectRows(sql`SELECT ${label} AS label, ${measure} AS value
        ${timeFrom(ctx, joins)}
        AND te.date >= ${dayOf(ctx.window.from)}::date AND te.date <= ${dayOf(new Date(ctx.window.to.getTime() - 1))}::date
        GROUP BY 1 ORDER BY ${measure} DESC, 1 ${pageLimit(ctx, 200)}`);
    }
    const page = pageRows(ctx, groups, 200);
    rows = page.rows.map((row) => ({
      group: row.label,
      value: summing ? minutesToHours(num(row.value)) : num(row.value),
    }));
    truncated = page.truncated;
  }
  const timeUnits = summing;
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
    sources: {
      metricSnapshot: false,
      cycleSnapshot: false,
      liveComponents: ["selected_period"],
    },
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
    columns: epicGrouped
      ? epicGroupColumns()
      : [
          {
            key: "group",
            label: query.groupBy ? "Group" : "All",
            kind: "text",
          },
          {
            key: "value",
            label: timeUnits ? "Hours" : "Count",
            kind: timeUnits ? "hours" : "number",
          },
        ],
    // RP-12: a group row carries its own label as the drill handle; the same expression picks its items.
    rows: empty
      ? []
      : rows.map((row) =>
          epicGrouped ? row : { ...row, _drill: String(row.group) },
        ),
    truncated,
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
    notes: epicGrouped
      ? ["epic_progress_all_descendants"]
      : query.entity === "time_entry" && !timeOn
        ? ["time_tracking_off"]
        : [],
    drill: !empty,
    costVisible: false,
  };
  return stripRates(envelope, false);
}

/**
 * RP-12: the work items or time entries behind one group of a tier 3 report, under the same window,
 * filters and reach as the report. Epic handles are opaque IDs or typed special buckets; other
 * groups retain the label-based handle used by the current builder. No handle lists the matching
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
  if (query.entity === "work_item" && query.groupBy === "epic") {
    let groupNarrowing = sql`true`;
    if (handle !== null) {
      const parsed = parseEpicDrillHandle(handle);
      if (!parsed) return [];
      groupNarrowing =
        parsed.kind === "epic"
          ? sql`mapping.available = true AND mapping.epic_id = ${parsed.id}`
          : parsed.kind === "none"
            ? sql`mapping.available = true AND mapping.epic_id IS NULL`
            : sql`mapping.available = false`;
    }
    return epicDrillItems(
      ctx,
      sql`w.created_at >= ${tsn(ctx.window.from)} AND w.created_at < ${tsn(ctx.window.to)} AND ${groupNarrowing}`,
      input.limit,
    );
  }
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
