import type { ResolvedIdentity } from "@taskdesk/permissions";
import { sql } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  buildContext,
  currentReportExecutor,
  num,
  selectRows,
  withReportExecutor,
} from "./context";
import { reportFeatureScope } from "./feature-scope";
import type { ReportWindow } from "./logic";
import { type ReportEnvelope, stripRates } from "./present";
import { reportByKey } from "./registry";
import { EXTRA_DRILL } from "./reports/drill-extra";
import type { ReportChoice, ReportDefinition, ReportFilters } from "./types";

export type ReportCaps = {
  readAll: boolean;
  showRates: boolean;
  readAnyTime: boolean;
};

export class ReportFeatureDisabledError extends Error {}

/** Options a report may read from the URL. Anything else is dropped. */
export const OPTION_KEYS = ["by", "metric", "days", "cycle"] as const;

function selectOptions(
  def: ReportDefinition,
  raw: Record<string, string | undefined>,
): Record<string, string> {
  const options: Record<string, string> = {};
  for (const key of OPTION_KEYS) {
    const value = raw[key];
    if (typeof value !== "string" || value.length === 0 || value.length > 200)
      continue;
    const declared = def.options?.find((option) => option.key === key);
    if (declared && !declared.values.includes(value)) continue;
    options[key] = value;
  }
  return options;
}

function staticChoices(
  def: ReportDefinition,
  options: Record<string, string>,
): ReportChoice[] {
  return (def.options ?? []).map((option) => ({
    key: option.key,
    values: option.values.map((value) => ({ value, label: value })),
    selected: options[option.key] ?? option.values[0] ?? null,
  }));
}

/** RP-3: how many projects the caller's reach covers (and how many of those are archived). */
export async function scopeCounts(
  ctx: ReturnType<typeof buildContext>,
): Promise<{ projects: number; archived: number }> {
  const [row] = await selectRows<{
    n: string;
    archived: string;
  }>(sql`SELECT count(*) AS n,
      count(*) FILTER (WHERE p.archived_at IS NOT NULL) AS archived
    FROM project p
    WHERE p.workspace_id = ${ctx.workspaceId} AND p.deleted_at IS NULL AND ${ctx.reach}
      AND ${ctx.filters.projectId ? sql`p.id = ${ctx.filters.projectId}` : sql`true`}
      AND ${ctx.filters.organisationId ? sql`p.organisation_id = ${ctx.filters.organisationId}` : sql`true`}`);
  return { projects: num(row?.n), archived: num(row?.archived) };
}

type RunReportInput = {
  def: ReportDefinition;
  workspaceId: string;
  identity: ResolvedIdentity;
  caps: ReportCaps;
  window: ReportWindow;
  filters: ReportFilters;
  options?: Record<string, string | undefined>;
  now?: Date;
  /** RP-9: `false` computes every period live (tests compare the two). */
  snapshots?: boolean;
  /** RP-10: a background export, which may return more rows than the screen. */
  exporting?: boolean;
  exportPage?: { offset: number; limit: number };
  executor?: Executor;
};

export async function runReport(
  input: RunReportInput,
): Promise<ReportEnvelope> {
  const executor = input.executor ?? currentReportExecutor() ?? db;
  return withReportExecutor(executor, () =>
    runReportInContext({ ...input, executor }),
  );
}

async function runReportInContext(
  input: RunReportInput & { executor: Executor },
): Promise<ReportEnvelope> {
  const { def } = input;
  const featureScope = await reportFeatureScope(
    def.feature,
    input.workspaceId,
    input.executor,
  );
  if (def.feature && featureScope === "off")
    throw new ReportFeatureDisabledError(def.feature);
  const options = selectOptions(def, input.options ?? {});
  // Rate data is selected only for a caller who may see it: the report is built for that caller.
  const ctx = buildContext({
    workspaceId: input.workspaceId,
    identity: input.identity,
    readAll: input.caps.readAll,
    showRates: input.caps.showRates,
    readAnyTime: input.caps.readAnyTime,
    ...(input.now ? { now: input.now } : {}),
    window: input.window,
    filters: input.filters,
    options,
    executor: input.executor,
    ...(input.exportPage ? { exportPage: input.exportPage } : {}),
    ...(input.snapshots === false ? { snapshots: false } : {}),
    ...(input.exporting ? { exporting: true } : {}),
    ...(Array.isArray(featureScope) ? { featureProjects: featureScope } : {}),
  });
  const body = await def.compute(ctx);
  // RP-12: a report with no drill of its own takes the one in `drill-extra.ts` (its rows get a handle).
  const extra = def.drillItems ? undefined : EXTRA_DRILL[def.key];
  if (extra) {
    body.rows = body.rows.map((row) => {
      const handle = extra.handleOf(row, ctx);
      return handle ? { ...row, _drill: handle } : row;
    });
    body.drill = true;
  }
  const use = ctx.snapshots.use;
  const sources = ctx.snapshots.sources;
  if (
    !sources.metricSnapshot &&
    !sources.cycleSnapshot &&
    sources.liveComponents.size === 0
  )
    sources.liveComponents.add(def.live ? "current_state" : "selected_period");
  // Source metadata includes comparison and supporting reads, but the boundary is about the
  // selected window. Only a stored day actually used by that window makes it historical.
  const hasHistorical = use.snapshotDays > 0;
  // Comparison ranges are auxiliary context for trend reports; the boundary describes the
  // selected window itself. Keep their provenance visible without making a fully stored selected
  // period appear mixed just because the preceding comparison range is still live.
  const hasWindowLive = [...sources.liveComponents].some(
    (component) =>
      component !== "comparison_period" &&
      (component !== "outside_window" || body.population === 0),
  );
  const hasLive = hasWindowLive || use.liveParts || use.uncoveredDays > 0;
  const boundary = !hasHistorical ? "live" : hasLive ? "mixed" : "snapshot";
  const scope = await scopeCounts(ctx);
  const empty = body.population === 0;
  const notes = [...body.notes];
  if (scope.archived > 0) notes.push("archived_projects_included");
  const envelope: ReportEnvelope = {
    key: def.key,
    title: def.title,
    category: def.category,
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
      live: def.live === true,
    },
    asOf: ctx.now.toISOString(),
    boundary,
    sources: {
      metricSnapshot: sources.metricSnapshot || use.snapshotDays > 0,
      cycleSnapshot: sources.cycleSnapshot,
      liveComponents: [...sources.liveComponents].sort(),
    },
    snapshot:
      use.snapshotDays > 0
        ? {
            closedDays: use.snapshotDays,
            uncoveredDays: use.uncoveredDays,
            computedAt: use.computedAt?.toISOString() ?? null,
            through: use.throughDay?.toISOString() ?? null,
          }
        : null,
    filters: input.filters,
    options,
    choices: [...staticChoices(def, options), ...(body.choices ?? [])],
    metrics: body.metrics,
    // RP-5: an empty population is "—" with its explanation, never a chart of nothing.
    chart: empty ? null : body.chart,
    columns: body.columns,
    rows: empty ? [] : body.rows,
    truncated: body.truncated === true,
    empty: empty
      ? {
          reason: body.outsideWindow > 0 ? "no_data_in_window" : "no_data",
          outsideWindow: body.outsideWindow,
          excluded: body.excluded,
        }
      : null,
    excluded: body.excluded,
    notes,
    drill: body.drill,
    costVisible: input.caps.showRates,
  };
  return stripRates(envelope, input.caps.showRates);
}

export function definitionOrThrow(key: string): ReportDefinition {
  const def = reportByKey(key);
  if (!def) throw new Error("unknown report");
  return def;
}
