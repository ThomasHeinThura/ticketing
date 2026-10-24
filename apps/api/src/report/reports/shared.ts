import { sql } from "drizzle-orm";
import { itemFilterSql, num, selectRows, tsn } from "../context";
import {
  DEFAULT_MIN_SAMPLE,
  isoDay,
  utc,
  weekStartOf,
  weeksBetween,
} from "../logic";
import type {
  Cell,
  Column,
  DrillItem,
  ReportBody,
  ReportContext,
  Row,
} from "../types";

export const ROW_CAP = 500;

export function emptyBody(overrides: Partial<ReportBody> = {}): ReportBody {
  return {
    metrics: [],
    chart: null,
    columns: [],
    rows: [],
    population: 0,
    outsideWindow: 0,
    excluded: null,
    notes: [],
    drill: false,
    ...overrides,
  };
}

export function cell(value: {
  value: number | null;
  n: number;
  needed: number;
}): Cell {
  return value.value === null
    ? { n: value.n, needed: value.needed }
    : value.value;
}

export const MIN = DEFAULT_MIN_SAMPLE;

/** Monday-keyed week of a timestamp, as `YYYY-MM-DD`. */
export function weekKey(value: Date | string): string {
  return isoDay(weekStartOf(utc(value)));
}

export function weekAxis(ctx: ReportContext): string[] {
  return weeksBetween(ctx.window.from, ctx.window.to);
}

export const col = (
  key: string,
  label: string,
  kind: Column["kind"] = "text",
  sensitive = false,
): Column => ({ key, label, kind, ...(sensitive ? { sensitive: true } : {}) });

/** Work items behind a row (RP-12): same population and filters, optionally narrowed by `extra`. */
export async function itemsOf(
  ctx: ReportContext,
  extra: ReturnType<typeof sql>,
  limit: number,
  order: ReturnType<typeof sql> = sql`w.updated_at DESC`,
): Promise<DrillItem[]> {
  const rows = await selectRows<{
    key: string;
    title: string;
    project_key: string | null;
    state_name: string | null;
    priority: string | null;
  }>(sql`SELECT w.key, w.title, p.slug AS project_key, st.name AS state_name, w.priority
    FROM work_item w
    JOIN project p ON p.id = w.project_id
    JOIN state s ON s.id = w.state_id
    JOIN state_template st ON st.id = s.state_template_id
    WHERE w.workspace_id = ${ctx.workspaceId}
      AND w.deleted_at IS NULL AND p.deleted_at IS NULL
      AND ${ctx.reach} AND ${itemFilterSql(ctx)} AND ${extra}
    ORDER BY ${order} LIMIT ${limit}`);
  return rows.map((row) => ({
    key: row.key,
    title: row.title,
    projectKey: row.project_key,
    state: row.state_name,
    priority: row.priority,
  }));
}

/** Items created before `window.from` and still relevant: the "outside the window" total (RP-5). */
export async function countOutside(
  ctx: ReportContext,
  column: "created_at" | "resolved_at",
  extra: ReturnType<typeof sql> = sql`true`,
): Promise<number> {
  const [row] = await selectRows<{ n: string }>(sql`SELECT count(*) AS n
    FROM work_item w
    JOIN project p ON p.id = w.project_id
    JOIN state s ON s.id = w.state_id
    JOIN state_template st ON st.id = s.state_template_id
    WHERE w.workspace_id = ${ctx.workspaceId}
      AND w.deleted_at IS NULL AND p.deleted_at IS NULL
      AND ${ctx.reach} AND ${itemFilterSql(ctx)} AND ${extra}
      AND w.${sql.raw(column)} IS NOT NULL
      AND w.${sql.raw(column)} < ${tsn(ctx.window.from)}`);
  return num(row?.n);
}

export type { Row };
