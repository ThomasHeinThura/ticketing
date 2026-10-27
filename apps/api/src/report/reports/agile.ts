import { sql } from "drizzle-orm";
import { cycleBurndown, getCycle } from "../../agile/cycle.repository";
import { computeVelocity, type ScopeUnit } from "../../agile/logic";
import db from "../../database";
import { dayOf, num, selectRows } from "../context";
import { countValue, utc } from "../logic";
import type { ReportContext, ReportDefinition, Row } from "../types";
import {
  cell,
  col,
  emptyBody,
  pageLimit,
  pageRows,
  rowCap,
  textArray,
} from "./shared";

type CycleChoice = {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
};

async function reachableCycles(ctx: ReportContext): Promise<CycleChoice[]> {
  return selectRows<CycleChoice>(sql`SELECT c.id, c.name, p.slug, c.start_date::text AS start_date, c.end_date::text AS end_date
    FROM cycle c
    JOIN project p ON p.id = c.project_id
    WHERE c.workspace_id = ${ctx.workspaceId} AND p.deleted_at IS NULL
      AND ${ctx.reach}
      AND ${ctx.filters.projectId ? sql`p.id = ${ctx.filters.projectId}` : sql`true`}
      AND ${ctx.filters.organisationId ? sql`p.organisation_id = ${ctx.filters.organisationId}` : sql`true`}
    ORDER BY c.start_date DESC LIMIT ${rowCap(ctx, 100)}`);
}

/** The cycle the burndown shows: the requested one, else the running one, else the newest (reach-filtered). */
export async function burndownCycle(
  ctx: ReportContext,
): Promise<{ cycles: CycleChoice[]; chosen: CycleChoice | undefined }> {
  const cycles = await reachableCycles(ctx);
  const today = dayOf(ctx.now);
  const chosen =
    cycles.find((cycle) => cycle.id === ctx.options.cycle) ??
    cycles.find(
      (cycle) => cycle.start_date <= today && cycle.end_date >= today,
    ) ??
    cycles[0];
  return { cycles, chosen };
}

const cycleBurndownReport: ReportDefinition = {
  key: "cycle_burndown",
  category: "agile",
  title: "Cycle burndown",
  live: true,
  async compute(ctx) {
    const { cycles, chosen } = await burndownCycle(ctx);
    const choices = [
      {
        key: "cycle",
        values: cycles.map((cycle) => ({
          value: cycle.id,
          label: `${cycle.slug} ${cycle.name} (${cycle.start_date} to ${cycle.end_date})`,
        })),
        selected: chosen?.id ?? null,
      },
    ];
    if (!chosen) return emptyBody({ choices });
    // The cycle id came from the reach-filtered list above, so the row is one the caller reaches.
    const row = await getCycle(db, chosen.id);
    if (!row) return emptyBody({ choices });
    const burndown = await cycleBurndown(row, ctx.now);
    const last = burndown.points[burndown.points.length - 1];
    return emptyBody({
      choices,
      metrics: [
        {
          key: "scope",
          label: "Opening scope",
          unit: "count",
          ...countValue(burndown.openingScope),
        },
        {
          key: "remaining",
          label: "Remaining",
          unit: "count",
          ...countValue(last?.remaining ?? 0),
        },
        {
          key: "unestimated",
          label: "Items without an estimate",
          unit: "count",
          ...countValue(burndown.unestimated.count),
        },
      ],
      chart:
        burndown.points.length > 0 && !burndown.noScope
          ? {
              type: "line",
              unit: "count",
              categories: burndown.points.map((point) => point.date),
              series: [
                {
                  key: "remaining",
                  label: "Remaining",
                  values: burndown.points.map((point) => point.remaining),
                },
                {
                  key: "ideal",
                  label: "Ideal",
                  values: burndown.points.map((point) => point.ideal),
                },
                {
                  key: "scope",
                  label: "Scope",
                  values: burndown.points.map((point) => point.scope),
                },
              ],
            }
          : null,
      columns: [
        col("date", "Day", "date"),
        col("scope", "Scope", "number"),
        col("completed", "Completed", "number"),
        col("remaining", "Remaining", "number"),
        col("ideal", "Ideal", "number"),
      ],
      rows: burndown.points.map((point) => ({
        date: point.date,
        scope: point.scope,
        completed: point.completed,
        remaining: point.remaining,
        ideal: point.ideal,
      })),
      population: burndown.noScope ? 0 : burndown.points.length,
      notes: [
        `unit_${burndown.unit}`,
        ...(burndown.discontinuities.length > 0
          ? ["estimate_system_changed"]
          : []),
      ],
    });
  },
};

const cycleVelocity: ReportDefinition = {
  key: "cycle_velocity",
  category: "agile",
  title: "Cycle velocity",
  live: true,
  pagedExport: true,
  async compute(ctx) {
    const projectPage = await selectRows<{
      id: string;
      slug: string;
    }>(sql`SELECT p.id, p.slug
      FROM project p
      WHERE p.workspace_id = ${ctx.workspaceId} AND p.deleted_at IS NULL
        AND ${ctx.reach}
        AND ${ctx.filters.projectId ? sql`p.id = ${ctx.filters.projectId}` : sql`true`}
        AND ${ctx.filters.organisationId ? sql`p.organisation_id = ${ctx.filters.organisationId}` : sql`true`}
        AND EXISTS (SELECT 1 FROM cycle c JOIN cycle_snapshot cs ON cs.cycle_id = c.id
          WHERE c.project_id = p.id AND c.completed_at IS NOT NULL)
      ORDER BY p.slug, p.id ${pageLimit(ctx, 500)}`);
    const projectResult = pageRows(ctx, projectPage, 500);
    const projectIds = projectResult.rows.map((project) => project.id);
    const cycleRows = projectIds.length
      ? await selectRows<{
          project_id: string;
          cycle_id: string;
          completed_at: string | Date;
          unit: string;
          completed: string;
          unestimated: string;
          cycle_count: string;
          position: number;
        }>(sql`WITH history AS (
            SELECT c.project_id, c.id AS cycle_id, c.completed_at, snap.unit,
              snap.completed_points AS completed, snap.unestimated_count AS unestimated,
              count(*) OVER (PARTITION BY c.project_id) AS cycle_count,
              row_number() OVER (PARTITION BY c.project_id ORDER BY c.completed_at DESC, c.id DESC) AS position
            FROM cycle c
            JOIN LATERAL (
              SELECT cs.* FROM cycle_snapshot cs WHERE cs.cycle_id = c.id ORDER BY cs.date DESC LIMIT 1
            ) snap ON true
            WHERE c.project_id = ANY(${textArray(projectIds)})
              AND c.completed_at IS NOT NULL
          ) SELECT * FROM history WHERE position <= 3 ORDER BY project_id, position`)
      : [];
    const byProject = new Map<string, typeof cycleRows>();
    for (const row of cycleRows)
      byProject.set(row.project_id, [
        ...(byProject.get(row.project_id) ?? []),
        row,
      ]);
    const table: Row[] = [];
    let singleUnit: string | null = null;
    let mixed = false;
    for (const project of projectResult.rows) {
      const entries = byProject.get(project.id) ?? [];
      const velocity = computeVelocity(
        entries.map((entry) => ({
          cycleId: entry.cycle_id,
          completedAt: utc(entry.completed_at),
          unit: entry.unit as ScopeUnit,
          completedPoints: num(entry.completed),
        })),
      );
      const unit =
        velocity.status === "ok"
          ? velocity.unit
          : (entries[0]?.unit ?? "count");
      if (singleUnit === null) singleUnit = unit;
      else if (singleUnit !== unit) mixed = true;
      table.push({
        project: project.slug,
        unit,
        velocity:
          velocity.status === "ok"
            ? cell({ value: velocity.value, n: velocity.cycles, needed: 3 })
            : { n: velocity.cycles, needed: 3 },
        cycles: num(entries[0]?.cycle_count),
        unestimated: entries.reduce(
          (sum, entry) => sum + num(entry.unestimated),
          0,
        ),
      });
    }
    return emptyBody({
      metrics: [
        {
          key: "projects",
          label: "Projects with completed cycles",
          unit: "count",
          ...countValue(table.length),
        },
      ],
      chart:
        table.some((row) => typeof row.velocity === "number") && !mixed
          ? {
              type: "bar",
              unit: "count",
              categories: table
                .filter((row) => typeof row.velocity === "number")
                .map((row) => String(row.project)),
              series: [
                {
                  key: "velocity",
                  label: "Velocity (last three cycles)",
                  values: table
                    .filter((row) => typeof row.velocity === "number")
                    .map((row) => Number(row.velocity)),
                },
              ],
            }
          : null,
      columns: [
        col("project", "Project"),
        col("unit", "Unit"),
        col("velocity", "Velocity (mean of last three cycles)", "number"),
        col("cycles", "Completed cycles", "number"),
        col("unestimated", "Unestimated items, last three", "number"),
      ],
      rows: table,
      truncated: projectResult.truncated,
      population: table.length,
      notes: mixed ? ["mixed_units"] : [],
    });
  },
};

export const agileReports: ReportDefinition[] = [
  cycleBurndownReport,
  cycleVelocity,
];
