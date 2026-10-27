import { sql } from "drizzle-orm";
import {
  type AvailableHoursRow,
  availableMinutes,
} from "../../time-tracking/cost-logic";
import { dayOf, itemFrom, num, OPEN, selectRows, tsn } from "../context";
import { countValue, DAY_MS, minutesToHours, ratePercent, utc } from "../logic";
import { loadFactRows } from "../snapshot.repository";
import type { ReportContext, ReportDefinition, Row } from "../types";
import {
  cell,
  col,
  emptyBody,
  itemsOf,
  pageLimit,
  pageRows,
  textArray,
} from "./shared";

const WORKING_HOURS_PER_DAY = 8;
const NAME = sql`COALESCE(pe.display_name, u.name, 'Unknown')`;

const workload: ReportDefinition = {
  key: "workload",
  category: "people",
  title: "Workload",
  live: true,
  pagedExport: true,
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
      GROUP BY 1, 2 ORDER BY count(*) DESC, w.assignee_id NULLS FIRST, ${NAME} ${pageLimit(ctx, 200)}`);
    const page = pageRows(ctx, rows, 200);
    const table: Row[] = page.rows.map((row) => ({
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
      truncated: page.truncated,
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
  pagedExport: true,
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
      GROUP BY 1, 2 ORDER BY count(*) DESC, w.assignee_id NULLS FIRST, ${NAME} ${pageLimit(ctx, 200)}`);
    const page = pageRows(ctx, rows, 200);
    const table: Row[] = page.rows.map((row) => ({
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
      truncated: page.truncated,
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

const MINUTES_PER_DAY = WORKING_HOURS_PER_DAY * 60;

function hoursOf(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

/**
 * R6-06: the teams a caller may see, as a predicate over alias `t` (team). `report:read_all` sees
 * every team of the workspace; everyone else sees the teams they belong to and the teams that own
 * a project in their reach (owner-team reach, TM-4). A team outside both is not listed, and its
 * members do not appear in a capacity or utilisation row only because capacity is set.
 */
function reachableTeam(ctx: ReportContext) {
  if (ctx.readAll) return sql`true`;
  return sql`(
    EXISTS (SELECT 1 FROM team_member mine WHERE mine.team_id = t.id AND mine.user_id = ${ctx.identity.userId})
    OR EXISTS (SELECT 1 FROM project p WHERE p.owner_team_id = t.id AND p.workspace_id = ${ctx.workspaceId}
      AND p.deleted_at IS NULL AND ${ctx.reach})
  )`;
}

type AvailableRow = {
  person_id: string;
  minutes_per_week: number;
  effective_from: string | Date;
};

/** TC-20: the `available_hours` history of the given people, grouped by person. */
async function loadAvailableHours(
  ctx: ReportContext,
  personIds: readonly string[],
): Promise<Map<string, AvailableHoursRow[]>> {
  const byPerson = new Map<string, AvailableHoursRow[]>();
  if (personIds.length === 0) return byPerson;
  const rows = await selectRows<AvailableRow>(
    sql`SELECT person_id, minutes_per_week, to_char(effective_from, 'YYYY-MM-DD') AS effective_from
      FROM available_hours
      WHERE workspace_id = ${ctx.workspaceId}
        AND person_id = ANY(${textArray(personIds)})`,
  );
  for (const row of rows) {
    const list = byPerson.get(row.person_id) ?? [];
    list.push({
      personId: row.person_id,
      minutesPerWeek: num(row.minutes_per_week),
      effectiveFrom: String(row.effective_from),
    });
    byPerson.set(row.person_id, list);
  }
  return byPerson;
}

/** The team-capacity fallback of TC-21: working days per week x allocation x an eight hour day, in minutes per week. */
function fallbackMinutesPerWeek(days: unknown): number | null {
  if (days === null || days === undefined) return null;
  return Math.round(num(days) * MINUTES_PER_DAY);
}

const utilisation: ReportDefinition = {
  key: "utilisation",
  category: "people",
  title: "Utilisation",
  feature: "feature.time_tracking",
  pagedExport: true,
  async compute(ctx) {
    const timeFacts = await loadFactRows(
      ctx,
      "time_logged",
      ctx.window.from,
      ctx.window.to,
    );
    const loggedByPerson = new Map<string, number>();
    for (const fact of timeFacts) {
      const personId = fact.dimensions.personId;
      if (personId)
        loggedByPerson.set(
          personId,
          (loggedByPerson.get(personId) ?? 0) + (fact.measures.minutes ?? 0),
        );
    }
    ctx.snapshots.sources.liveComponents.add("availability");
    ctx.snapshots.use.liveParts = true;
    const loggedPersonIds = [...loggedByPerson.keys()];
    const loggedPeople = loggedPersonIds.length
      ? sql`pe.id = ANY(${textArray(loggedPersonIds)})`
      : sql`false`;
    const loggedOrder = loggedPersonIds.length
      ? sql`CASE pe.id ${sql.join(
          loggedPersonIds.map(
            (id) => sql`WHEN ${id} THEN ${loggedByPerson.get(id) ?? 0}`,
          ),
          sql` `,
        )} ELSE 0 END`
      : // ORDER BY a bare integer is interpreted as a select-list ordinal by PostgreSQL.
        // Keep this as an expression when nobody logged time in the selected period.
        sql`0::numeric`;
    const capacityVisible = ctx.readAnyTime
      ? ctx.readAll && !ctx.filters.teamId
        ? sql`true`
        : sql`(pe.id = ${ctx.identity.personId} OR pe.id IN (SELECT person_id FROM listed))`
      : sql`pe.id = ${ctx.identity.personId}`;
    // Listed: people with logged time in reach, plus people with capacity (an `available_hours`
    // row or team capacity) who are the caller, or members of a team the caller may see (R6-06).
    const rows = await selectRows<{
      person_id: string;
      name: string | null;
      minutes: string;
      days: string | null;
    }>(sql`WITH cap AS (
        SELECT pc.id AS person_id,
          max(t.capacity_days_per_week * COALESCE(tm.allocation_pct, 100) / 100.0) AS days
        FROM team t
        JOIN team_member tm ON tm.team_id = t.id
        JOIN person pc ON pc.user_id = tm.user_id
        WHERE t.workspace_id = ${ctx.workspaceId} AND t.capacity_days_per_week IS NOT NULL
        GROUP BY 1),
      listed AS (
        SELECT pc.id AS person_id
        FROM team t
        JOIN team_member tm ON tm.team_id = t.id
        JOIN person pc ON pc.user_id = tm.user_id
        WHERE t.workspace_id = ${ctx.workspaceId}
          AND ${ctx.filters.teamId ? sql`t.id = ${ctx.filters.teamId}` : sql`true`}
          AND ${reachableTeam(ctx)}
        GROUP BY 1)
      SELECT pe.id AS person_id, COALESCE(pe.display_name, u.name, 'Unknown') AS name,
        0::numeric AS minutes, c.days
      FROM person pe
      LEFT JOIN "user" u ON u.id = pe.user_id
      LEFT JOIN cap c ON c.person_id = pe.id
      WHERE ${loggedPeople}
        OR (
          (c.days IS NOT NULL OR EXISTS (SELECT 1 FROM available_hours ah
              WHERE ah.workspace_id = ${ctx.workspaceId} AND ah.person_id = pe.id))
          AND ${capacityVisible}
        )
      ORDER BY ${loggedOrder} DESC, pe.id ${pageLimit(ctx, 200)}`);
    const page = pageRows(ctx, rows, 200);
    const available = await loadAvailableHours(
      ctx,
      page.rows.map((row) => row.person_id),
    );
    const from = dayOf(ctx.window.from);
    const to = lastDay(ctx);
    let usedFallback = false;
    let someUnset = false;
    const table: Row[] = page.rows.map((row) => {
      const loggedHours = minutesToHours(
        loggedByPerson.get(row.person_id) ?? 0,
      );
      const result = availableMinutes(
        available.get(row.person_id) ?? [],
        from,
        to,
        fallbackMinutesPerWeek(row.days),
      );
      if (result?.fellBack) usedFallback = true;
      if (result === null) someUnset = true;
      const availableHours = result === null ? null : hoursOf(result.minutes);
      return {
        person: row.name ?? "Unknown",
        logged: loggedHours,
        available: availableHours,
        utilisation:
          availableHours === null
            ? { n: 0, needed: 1 }
            : cell(ratePercent(loggedHours, availableHours, 1)),
      };
    });
    const logged = table.reduce((sum, row) => sum + Number(row.logged), 0);
    const notes: string[] = [];
    if (usedFallback) notes.push("assumes_eight_hour_day");
    if (usedFallback) notes.push("available_hours_fallback");
    if (!ctx.readAnyTime) notes.push("own_time_only");
    if (someUnset) notes.push("no_capacity_set");
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
      truncated: page.truncated,
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
  pagedExport: true,
  async compute(ctx) {
    const teams = await selectRows<{
      id: string;
      name: string;
      days: string | null;
      members: string;
    }>(sql`SELECT t.id, t.name, t.capacity_days_per_week AS days,
        (SELECT count(*) FROM team_member tm WHERE tm.team_id = t.id) AS members
      FROM team t
      WHERE t.workspace_id = ${ctx.workspaceId}
        AND ${ctx.filters.teamId ? sql`t.id = ${ctx.filters.teamId}` : sql`true`}
        AND ${reachableTeam(ctx)}
      ORDER BY t.name, t.id ${pageLimit(ctx, 200)}`);
    const page = pageRows(ctx, teams, 200);
    const selectedTeams = page.rows;
    const selectedTeamIds = selectedTeams.map((team) => team.id);
    const members = selectedTeams.length
      ? await selectRows<{
          team_id: string;
          person_id: string;
          allocation: string;
        }>(sql`SELECT tm.team_id, pc.id AS person_id, COALESCE(tm.allocation_pct, 100) AS allocation
          FROM team_member tm
          JOIN person pc ON pc.user_id = tm.user_id
          WHERE tm.team_id IN (${sql.join(
            selectedTeams.map((team) => sql`${team.id}`),
            sql`, `,
          )})`)
      : [];
    // R7-04: another person's individual hours are `time_entry:read_any` data (the same gate as
    // GET /api/available-hours). Without it only the caller's own rows are read; every other
    // member contributes the documented team-capacity fallback instead of their own figure.
    const available = await loadAvailableHours(
      ctx,
      [...new Set(members.map((member) => member.person_id))].filter(
        (id) => ctx.readAnyTime || id === ctx.identity.personId,
      ),
    );
    const timeFacts = await loadFactRows(
      ctx,
      "time_logged",
      ctx.window.from,
      ctx.window.to,
    );
    const loggedBy = new Map<string, number>();
    for (const fact of timeFacts) {
      const personId = fact.dimensions.personId;
      if (!personId) continue;
      for (const member of members) {
        if (
          member.person_id === personId &&
          selectedTeamIds.includes(member.team_id)
        )
          loggedBy.set(
            member.team_id,
            (loggedBy.get(member.team_id) ?? 0) + (fact.measures.minutes ?? 0),
          );
      }
    }
    ctx.snapshots.sources.liveComponents.add("availability");
    ctx.snapshots.sources.liveComponents.add("commitments");
    ctx.snapshots.use.liveParts = true;
    const open =
      selectedTeamIds.length > 0
        ? await selectRows<{
            team_id: string;
            n: string;
          }>(sql`SELECT tm.team_id, count(*) AS n
      ${itemFrom(ctx, sql`JOIN person pa ON pa.id = w.assignee_id JOIN team_member tm ON tm.user_id = pa.user_id JOIN team tt ON tt.id = tm.team_id AND tt.workspace_id = ${ctx.workspaceId}`)}
      AND ${OPEN}
      AND tm.team_id = ANY(${textArray(selectedTeamIds)})
      GROUP BY 1`)
        : [];
    const openBy = new Map(open.map((row) => [row.team_id, num(row.n)]));
    const from = dayOf(ctx.window.from);
    const to = lastDay(ctx);
    let usedFallback = false;
    const table: Row[] = selectedTeams.map((team) => {
      // TC-20/TC-22: each member contributes their own available hours (scaled by their
      // allocation to this team); a member without a row falls back to the team's working days.
      let total = 0;
      let anySet = false;
      for (const member of members.filter(
        (entry) => entry.team_id === team.id,
      )) {
        const allocation = num(member.allocation) / 100;
        const rows = (available.get(member.person_id) ?? []).map((row) => ({
          ...row,
          minutesPerWeek: Math.round(row.minutesPerWeek * allocation),
        }));
        const result = availableMinutes(
          rows,
          from,
          to,
          fallbackMinutesPerWeek(
            team.days === null ? null : num(team.days) * allocation,
          ),
        );
        if (result === null) continue;
        if (result.fellBack) usedFallback = true;
        anySet = true;
        total += result.minutes;
      }
      const availableHours = anySet ? hoursOf(Math.round(total)) : null;
      const loggedHours = minutesToHours(loggedBy.get(team.id) ?? 0);
      return {
        team: team.name,
        members: num(team.members),
        capacity: availableHours,
        logged: loggedHours,
        open: openBy.get(team.id) ?? 0,
        utilisation:
          availableHours === null
            ? { n: 0, needed: 1 }
            : cell(ratePercent(loggedHours, availableHours, 1)),
      };
    });
    const notes = ["committed_work_in_items"];
    if (usedFallback) notes.unshift("assumes_eight_hour_day");
    if (usedFallback) notes.push("available_hours_fallback");
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
      truncated: page.truncated,
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
