import type { ResolvedIdentity } from "@taskdesk/permissions";
import { sql } from "drizzle-orm";
import { buildContext, num, selectRows } from "./context";
import { workspaceFeatureEnabled } from "./feature";
import type { ReportWindow } from "./logic";
import { type ReportEnvelope, stripRates } from "./present";
import { reportByKey } from "./registry";
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

export async function runReport(input: {
  def: ReportDefinition;
  workspaceId: string;
  identity: ResolvedIdentity;
  caps: ReportCaps;
  window: ReportWindow;
  filters: ReportFilters;
  options?: Record<string, string | undefined>;
  now?: Date;
}): Promise<ReportEnvelope> {
  const { def } = input;
  if (
    def.feature &&
    !(await workspaceFeatureEnabled(input.workspaceId, def.feature))
  )
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
  });
  const body = await def.compute(ctx);
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
    boundary: "live",
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
