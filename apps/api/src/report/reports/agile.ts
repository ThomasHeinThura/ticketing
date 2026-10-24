import { sql } from "drizzle-orm";
import { cycleBurndown, getCycle } from "../../agile/cycle.repository";
import { computeVelocity, type ScopeUnit } from "../../agile/logic";
import db from "../../database";
import { dayOf, num, selectRows } from "../context";
import { countValue, utc } from "../logic";
import type { ReportContext, ReportDefinition, Row } from "../types";
import { cell, col, emptyBody, rowCap } from "./shared";

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
  async compute(ctx) {
    const rows = await selectRows<{
      project_id: string;
      slug: string;
      cycle_id: string;
      completed_at: string | Date;
      unit: string;
      completed: string;
      scope: string;
      unestimated: string;
    }>(sql`SELECT c.project_id, p.slug, c.id AS cycle_id, c.completed_at, snap.unit,
        snap.completed_points AS completed, snap.scope_points AS scope,
        snap.unestimated_count AS unestimated
      FROM cycle c
      JOIN project p ON p.id = c.project_id
      JOIN LATERAL (
        SELECT cs.* FROM cycle_snapshot cs WHERE cs.cycle_id = c.id ORDER BY cs.date DESC LIMIT 1
      ) snap ON true
      WHERE c.workspace_id = ${ctx.workspaceId} AND p.deleted_at IS NULL
        AND c.completed_at IS NOT NULL AND ${ctx.reach}
        AND ${ctx.filters.projectId ? sql`p.id = ${ctx.filters.projectId}` : sql`true`}
        AND ${ctx.filters.organisationId ? sql`p.organisation_id = ${ctx.filters.organisationId}` : sql`true`}
      ORDER BY c.completed_at DESC LIMIT ${rowCap(ctx, 500)}`);
    const byProject = new Map<string, typeof rows>();
    for (const row of rows)
      byProject.set(row.slug, [...(byProject.get(row.slug) ?? []), row]);
    const table: Row[] = [];
    let singleUnit: string | null = null;
    let mixed = false;
    for (const [slug, entries] of byProject) {
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
      const recent = entries.slice(0, 3);
      table.push({
        project: slug,
        unit,
        velocity:
          velocity.status === "ok"
            ? cell({ value: velocity.value, n: velocity.cycles, needed: 3 })
            : { n: velocity.cycles, needed: 3 },
        cycles: entries.length,
        unestimated: recent.reduce(
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
      truncated: rows.length >= rowCap(ctx, 500),
      population: rows.length,
      notes: mixed ? ["mixed_units"] : [],
    });
  },
};

export const agileReports: ReportDefinition[] = [
  cycleBurndownReport,
  cycleVelocity,
];
