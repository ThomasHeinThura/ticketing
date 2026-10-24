import { sql } from "drizzle-orm";
import {
  dayOf,
  itemFrom,
  num,
  OPEN,
  selectRows,
  timeFrom,
  tsn,
} from "../context";
import { countValue, DAY_MS, minutesToHours, ratePercent, utc } from "../logic";
import type { ReportContext, ReportDefinition, Row } from "../types";
import { cell, col, emptyBody, itemsOf } from "./shared";

const WORKING_HOURS_PER_DAY = 8;
const NAME = sql`COALESCE(pe.display_name, u.name, 'Unknown')`;

const workload: ReportDefinition = {
  key: "workload",
  category: "people",
  title: "Workload",
  live: true,
  async compute(ctx) {
    const rows = await selectRows<{
      assignee_id: string | null;
      name: string | null;
      open: string;
      overdue: string;
      urgent: string;
    }>(sql`SELECT w.assignee_id, ${NAME} AS name, count(*) AS open,
        count(*) FILTER (WHERE w.due_date IS NOT NULL AND w.due_date < ${tsn(ctx.now)}) AS overdue,
        count(*) FILTER (WHERE w.priority IN ('urgent', 'high')) AS urgent
      ${itemFrom(ctx, sql`LEFT JOIN person pe ON pe.id = w.assignee_id LEFT JOIN "user" u ON u.id = pe.user_id`)}
      AND ${OPEN}
      GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 200`);
    const table: Row[] = rows.map((row) => ({
      assignee: row.assignee_id ? (row.name ?? "Unknown") : "(unassigned)",
      open: num(row.open),
      overdue: num(row.overdue),
      urgent: num(row.urgent),
      _drill: row.assignee_id ?? "none",
    }));
    const open = table.reduce((sum, row) => sum + Number(row.open), 0);
    return emptyBody({
      metrics: [
        {
          key: "open",
          label: "Open items",
          unit: "count",
          ...countValue(open),
        },
        {
          key: "overdue",
          label: "Overdue",
          unit: "count",
          ...countValue(
            table.reduce((sum, row) => sum + Number(row.overdue), 0),
          ),
        },
      ],
      chart:
        open > 0
          ? {
              type: "bar",
              unit: "count",
              categories: table.slice(0, 15).map((row) => String(row.assignee)),
              series: [
                {
                  key: "open",
                  label: "Open",
                  values: table.slice(0, 15).map((row) => Number(row.open)),
                },
                {
                  key: "overdue",
                  label: "Overdue",
                  values: table.slice(0, 15).map((row) => Number(row.overdue)),
                },
              ],
            }
          : null,
      columns: [
        col("assignee", "Assignee"),
        col("open", "Open", "number"),
        col("overdue", "Overdue", "number"),
        col("urgent", "Urgent or high", "number"),
      ],
      rows: table,
      population: open,
      drill: true,
    });
  },
  drillItems: (ctx, handle, limit) =>
    itemsOf(
      ctx,
      sql`${OPEN} AND ${handle ? (handle === "none" ? sql`w.assignee_id IS NULL` : sql`w.assignee_id = ${handle}`) : sql`true`}`,
      limit,
      sql`w.updated_at ASC`,
    ),
};

function staleDays(ctx: ReportContext): number {
  const requested = Number(ctx.options.days);
  return [7, 14, 30, 60, 90].includes(requested) ? requested : 14;
}

const staleWork: ReportDefinition = {
  key: "stale_work",
  category: "people",
  title: "Stale work",
  live: true,
  async compute(ctx) {
    const days = staleDays(ctx);
    const cutoff = new Date(ctx.now.getTime() - days * DAY_MS);
    const rows = await selectRows<{
      assignee_id: string | null;
      name: string | null;
      stale: string;
      oldest: string | Date;
    }>(sql`SELECT w.assignee_id, ${NAME} AS name, count(*) AS stale, min(w.updated_at) AS oldest
      ${itemFrom(ctx, sql`LEFT JOIN person pe ON pe.id = w.assignee_id LEFT JOIN "user" u ON u.id = pe.user_id`)}
      AND ${OPEN} AND w.updated_at < ${tsn(cutoff)}
      GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 200`);
    const table: Row[] = rows.map((row) => ({
      assignee: row.assignee_id ? (row.name ?? "Unknown") : "(unassigned)",
      stale: num(row.stale),
      oldest: Math.floor(
        (ctx.now.getTime() - utc(row.oldest).getTime()) / DAY_MS,
      ),
      _drill: row.assignee_id ?? "none",
    }));
    const total = table.reduce((sum, row) => sum + Number(row.stale), 0);
    return emptyBody({
      metrics: [
        {
          key: "stale",
          label: `Untouched for ${days} days or more`,
          unit: "count",
          ...countValue(total),
        },
      ],
      chart:
        total > 0
          ? {
              type: "bar",
              unit: "count",
              categories: table.slice(0, 15).map((row) => String(row.assignee)),
              series: [
                {
                  key: "stale",
                  label: "Stale items",
                  values: table.slice(0, 15).map((row) => Number(row.stale)),
                },
              ],
            }
          : null,
      columns: [
        col("assignee", "Assignee"),
        col("stale", "Stale items", "number"),
        col("oldest", "Longest untouched (days)", "days"),
      ],
      rows: table,
      population: total,
      drill: true,
    });
  },
  drillItems: (ctx, handle, limit) =>
    itemsOf(
      ctx,
      sql`${OPEN} AND w.updated_at < ${tsn(new Date(ctx.now.getTime() - staleDays(ctx) * DAY_MS))}
        AND ${handle ? (handle === "none" ? sql`w.assignee_id IS NULL` : sql`w.assignee_id = ${handle}`) : sql`true`}`,
      limit,
      sql`w.updated_at ASC`,
    ),
};

function lastDay(ctx: ReportContext): string {
  return dayOf(new Date(ctx.window.to.getTime() - 1));
}

function weeksIn(ctx: ReportContext): number {
  return ctx.window.days / 7;
}

function timeWindow(ctx: ReportContext) {
  return sql`te.date >= ${dayOf(ctx.window.from)}::date AND te.date <= ${lastDay(ctx)}::date`;
}

const utilisation: ReportDefinition = {
  key: "utilisation",
  category: "people",
  title: "Utilisation",
  feature: "feature.time_tracking",
  async compute(ctx) {
    const rows = await selectRows<{
      person_id: string;
      name: string | null;
      minutes: string;
      days: string | null;
    }>(sql`WITH logged AS (
        SELECT te.person_id, sum(te.minutes) AS minutes
        ${timeFrom(ctx)} AND ${timeWindow(ctx)}
        GROUP BY 1),
      cap AS (
        SELECT pc.id AS person_id,
          max(t.capacity_days_per_week * COALESCE(tm.allocation_pct, 100) / 100.0) AS days
        FROM team t
        JOIN team_member tm ON tm.team_id = t.id
        JOIN person pc ON pc.user_id = tm.user_id
        WHERE t.workspace_id = ${ctx.workspaceId} AND t.capacity_days_per_week IS NOT NULL
        GROUP BY 1)
      SELECT pe.id AS person_id, COALESCE(pe.display_name, u.name, 'Unknown') AS name,
        COALESCE(l.minutes, 0) AS minutes, c.days
      FROM person pe
      LEFT JOIN "user" u ON u.id = pe.user_id
      LEFT JOIN logged l ON l.person_id = pe.id
      LEFT JOIN cap c ON c.person_id = pe.id
      WHERE pe.id IN (SELECT person_id FROM logged)
        OR (c.days IS NOT NULL AND ${ctx.readAnyTime ? sql`true` : sql`pe.id = ${ctx.identity.personId}`})
      ORDER BY COALESCE(l.minutes, 0) DESC LIMIT 200`);
    const table: Row[] = rows.map((row) => {
      const loggedHours = minutesToHours(num(row.minutes));
      const available =
        row.days === null
          ? null
          : Math.round(
              num(row.days) * WORKING_HOURS_PER_DAY * weeksIn(ctx) * 10,
            ) / 10;
      return {
        person: row.name ?? "Unknown",
        logged: loggedHours,
        available,
        utilisation:
          available === null
            ? { n: 0, needed: 1 }
            : cell(ratePercent(loggedHours, available, 1)),
      };
    });
    const logged = table.reduce((sum, row) => sum + Number(row.logged), 0);
    const notes = ["assumes_eight_hour_day"];
    if (!ctx.readAnyTime) notes.push("own_time_only");
    if (table.some((row) => row.available === null))
      notes.push("no_capacity_set");
    return emptyBody({
      metrics: [
        {
          key: "logged",
          label: "Hours logged",
          unit: "hours",
          ...countValue(Math.round(logged * 10) / 10),
        },
      ],
      chart:
        table.length > 0
          ? {
              type: "bar",
              unit: "hours",
              categories: table.slice(0, 15).map((row) => String(row.person)),
              series: [
                {
                  key: "logged",
                  label: "Logged",
                  values: table.slice(0, 15).map((row) => Number(row.logged)),
                },
                {
                  key: "available",
                  label: "Available",
                  values: table
                    .slice(0, 15)
                    .map((row) =>
                      row.available === null ? null : Number(row.available),
                    ),
                },
              ],
            }
          : null,
      columns: [
        col("person", "Person"),
        col("logged", "Logged (hours)", "hours"),
        col("available", "Available (hours)", "hours"),
        col("utilisation", "Utilisation", "percent"),
      ],
      rows: table,
      population: table.length,
      notes,
      drill: false,
    });
  },
};

const capacity: ReportDefinition = {
  key: "capacity",
  category: "people",
  title: "Capacity",
  feature: "feature.time_tracking",
  async compute(ctx) {
    const teams = await selectRows<{
      id: string;
      name: string;
      days: string | null;
      members: string;
      allocated_days: string | null;
    }>(sql`SELECT t.id, t.name, t.capacity_days_per_week AS days,
        (SELECT count(*) FROM team_member tm WHERE tm.team_id = t.id) AS members,
        (SELECT sum(t.capacity_days_per_week * COALESCE(tm.allocation_pct, 100) / 100.0)
           FROM team_member tm WHERE tm.team_id = t.id) AS allocated_days
      FROM team t
      WHERE t.workspace_id = ${ctx.workspaceId}
        AND ${ctx.filters.teamId ? sql`t.id = ${ctx.filters.teamId}` : sql`true`}
      ORDER BY t.name LIMIT 200`);
    const logged = await selectRows<{
      team_id: string;
      minutes: string;
    }>(sql`SELECT tm.team_id, sum(te.minutes) AS minutes
      ${timeFrom(ctx, sql`JOIN team_member tm ON tm.user_id = pe.user_id JOIN team tt ON tt.id = tm.team_id AND tt.workspace_id = ${ctx.workspaceId}`)}
      AND ${timeWindow(ctx)}
      GROUP BY 1`);
    const open = await selectRows<{
      team_id: string;
      n: string;
    }>(sql`SELECT tm.team_id, count(*) AS n
      ${itemFrom(ctx, sql`JOIN person pa ON pa.id = w.assignee_id JOIN team_member tm ON tm.user_id = pa.user_id JOIN team tt ON tt.id = tm.team_id AND tt.workspace_id = ${ctx.workspaceId}`)}
      AND ${OPEN}
      GROUP BY 1`);
    const loggedBy = new Map(
      logged.map((row) => [row.team_id, num(row.minutes)]),
    );
    const openBy = new Map(open.map((row) => [row.team_id, num(row.n)]));
    const table: Row[] = teams.map((team) => {
      const available =
        team.days === null || team.allocated_days === null
          ? null
          : Math.round(
              num(team.allocated_days) *
                WORKING_HOURS_PER_DAY *
                weeksIn(ctx) *
                10,
            ) / 10;
      const loggedHours = minutesToHours(loggedBy.get(team.id) ?? 0);
      return {
        team: team.name,
        members: num(team.members),
        capacity: available,
        logged: loggedHours,
        open: openBy.get(team.id) ?? 0,
        utilisation:
          available === null
            ? { n: 0, needed: 1 }
            : cell(ratePercent(loggedHours, available, 1)),
      };
    });
    const notes = ["assumes_eight_hour_day", "committed_work_in_items"];
    if (!ctx.readAnyTime) notes.push("own_time_only");
    if (table.some((row) => row.capacity === null))
      notes.push("no_capacity_set");
    return emptyBody({
      metrics: [
        {
          key: "teams",
          label: "Teams",
          unit: "count",
          ...countValue(table.length),
        },
      ],
      chart:
        table.length > 0
          ? {
              type: "bar",
              unit: "hours",
              categories: table.map((row) => String(row.team)),
              series: [
                {
                  key: "capacity",
                  label: "Capacity",
                  values: table.map((row) =>
                    row.capacity === null ? null : Number(row.capacity),
                  ),
                },
                {
                  key: "logged",
                  label: "Logged",
                  values: table.map((row) => Number(row.logged)),
                },
              ],
            }
          : null,
      columns: [
        col("team", "Team"),
        col("members", "Members", "number"),
        col("capacity", "Capacity (hours)", "hours"),
        col("logged", "Logged (hours)", "hours"),
        col("utilisation", "Logged against capacity", "percent"),
        col("open", "Open items assigned", "number"),
      ],
      rows: table,
      population: table.length,
      notes,
    });
  },
};

export const peopleReports: ReportDefinition[] = [
  workload,
  staleWork,
  utilisation,
  capacity,
];
