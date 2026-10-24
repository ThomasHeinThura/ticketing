import type { ResolvedIdentity } from "@taskdesk/permissions";
import { type SQL, sql } from "drizzle-orm";
import db from "../database";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import {
  previousWindow,
  type ReportWindow,
  resolveWindow,
  type WindowInput,
} from "./logic";
import { emptyUse } from "./snapshot.logic";
import { FILTER_KEYS, type ReportContext, type ReportFilters } from "./types";

/** A statement that returns rows: the raw `db.execute` result unwrapped. */
export async function selectRows<T>(query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

/** Postgres returns counts and sums as strings; every report number goes through this. */
export function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * RP-17: the caller's reach as a predicate over alias `p` (project). `report:read_all` widens it
 * to the whole workspace, never beyond it: the workspace is a separate predicate on every query.
 */
export function reachPredicate(
  identity: ResolvedIdentity,
  readAll: boolean,
): SQL {
  if (readAll) return sql`true`;
  return (
    currentProjectReachPredicate(
      identity,
      sql`p.id`,
      sql`p.workspace_id`,
      sql`p.organisation_id`,
      db,
    ) ?? sql`false`
  );
}

export function buildContext(input: {
  workspaceId: string;
  identity: ResolvedIdentity;
  readAll: boolean;
  showRates: boolean;
  readAnyTime: boolean;
  now?: Date;
  window: ReportWindow;
  filters: ReportFilters;
  options?: Record<string, string>;
  /** RP-9: read closed days from snapshots (default). Off, every period is computed live. */
  snapshots?: boolean;
  /** RP-10: a background export, which may return more rows than the screen. */
  exporting?: boolean;
}): ReportContext {
  return {
    workspaceId: input.workspaceId,
    identity: input.identity,
    readAll: input.readAll,
    showRates: input.showRates,
    readAnyTime: input.readAnyTime,
    now: input.now ?? new Date(),
    window: input.window,
    previous: previousWindow(input.window),
    filters: input.filters,
    reach: reachPredicate(input.identity, input.readAll),
    options: input.options ?? {},
    snapshots: { enabled: input.snapshots !== false, use: emptyUse() },
    exporting: input.exporting === true,
  };
}

export function parseWindowOrThrow(input: WindowInput, now: Date) {
  const result = resolveWindow(input, now);
  if (!result.ok) return result;
  return result;
}

export function cleanFilters(raw: Record<string, unknown>): ReportFilters {
  const filters: ReportFilters = {};
  for (const key of FILTER_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 200)
      filters[key] = value;
  }
  return filters;
}

/** RP-7: project, organisation, team, type and priority narrow a work-item population. */
export function itemFilterSql(ctx: ReportContext): SQL {
  const parts: SQL[] = [];
  const { projectId, organisationId, teamId, typeId, priority } = ctx.filters;
  if (projectId) parts.push(sql`w.project_id = ${projectId}`);
  if (organisationId) parts.push(sql`p.organisation_id = ${organisationId}`);
  if (typeId) parts.push(sql`w.type_id = ${typeId}`);
  if (priority) parts.push(sql`w.priority = ${priority}`);
  if (teamId)
    parts.push(sql`EXISTS (
      SELECT 1 FROM team_member tm
      JOIN team t ON t.id = tm.team_id AND t.workspace_id = ${ctx.workspaceId}
      JOIN person pe ON pe.user_id = tm.user_id
      WHERE tm.team_id = ${teamId} AND pe.id = w.assignee_id)`);
  return parts.length ? sql.join(parts, sql` AND `) : sql`true`;
}

/**
 * The work items a report counts: this workspace, not deleted, in a project the caller reaches,
 * narrowed by the filters. Aliases: `w` item, `p` project, `s` state, `st` state template.
 */
export function itemFrom(ctx: ReportContext, joins: SQL = sql``): SQL {
  return sql`FROM work_item w
    JOIN project p ON p.id = w.project_id
    JOIN state s ON s.id = w.state_id
    JOIN state_template st ON st.id = s.state_template_id
    ${joins}
    WHERE w.workspace_id = ${ctx.workspaceId}
      AND w.deleted_at IS NULL AND p.deleted_at IS NULL
      AND ${ctx.reach} AND ${itemFilterSql(ctx)}`;
}

/** Open means not completed and not cancelled. */
export const OPEN = sql`st."group" NOT IN ('completed', 'cancelled')`;

export function timeFilterSql(ctx: ReportContext): SQL {
  const parts: SQL[] = [];
  const { projectId, organisationId, teamId, typeId, priority } = ctx.filters;
  if (!ctx.readAnyTime)
    parts.push(sql`te.person_id = ${ctx.identity.personId}`);
  if (projectId) parts.push(sql`te.project_id = ${projectId}`);
  if (organisationId) parts.push(sql`p.organisation_id = ${organisationId}`);
  if (typeId) parts.push(sql`w.type_id = ${typeId}`);
  if (priority) parts.push(sql`w.priority = ${priority}`);
  if (teamId)
    parts.push(sql`EXISTS (
      SELECT 1 FROM team_member tm
      JOIN team t ON t.id = tm.team_id AND t.workspace_id = ${ctx.workspaceId}
      JOIN person pe2 ON pe2.user_id = tm.user_id
      WHERE tm.team_id = ${teamId} AND pe2.id = te.person_id)`);
  return parts.length ? sql.join(parts, sql` AND `) : sql`true`;
}

/**
 * The time entries a report counts. Aliases: `te` entry, `p` project, `pe` person, `w` item
 * (left: an entry whose item was deleted stays on its project, flagged in reporting).
 */
export function timeFrom(ctx: ReportContext, joins: SQL = sql``): SQL {
  return sql`FROM time_entry te
    JOIN project p ON p.id = te.project_id
    JOIN person pe ON pe.id = te.person_id
    LEFT JOIN "user" u ON u.id = pe.user_id
    LEFT JOIN work_item w ON w.id = te.work_item_id
    ${joins}
    WHERE te.workspace_id = ${ctx.workspaceId}
      AND p.deleted_at IS NULL
      AND ${ctx.reach} AND ${timeFilterSql(ctx)}`;
}

/**
 * Instants are passed as ISO strings and cast, never as `Date` parameters: `node-pg` serialises a
 * `Date` in the process time zone, which would shift every `timestamp` (no zone) comparison.
 * `work_item` columns are naive UTC; the SLA, escalation and KB columns carry a zone.
 */
export function tsn(date: Date): SQL {
  return sql`${date.toISOString()}::timestamp`;
}
export function tstz(date: Date): SQL {
  return sql`${date.toISOString()}::timestamptz`;
}
export function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}
