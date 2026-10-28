import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  dashboardTable,
  dashboardWidgetTable,
} from "../database/schema-p5-reports";
import { isUniqueViolation } from "../time-tracking/repository";
import { assertRowNotUnderLegalHold } from "../utils/workspace-legal-hold";
import { auditReport, type ReportActor } from "./audit";
import { DEFAULT_DASHBOARD_NAME, DEFAULT_WIDGETS } from "./dashboard.logic";
import { MAX_PERSONAL_DASHBOARDS, MAX_WORKSPACE_DASHBOARDS } from "./schema";

export type DashboardRow = typeof dashboardTable.$inferSelect;
export type WidgetRow = typeof dashboardWidgetTable.$inferSelect;

export class DashboardVersionConflictError extends Error {}
export class DashboardLimitError extends Error {}
export class DashboardNameTakenError extends Error {}

/** A dashboard the person may see: their own, or any workspace dashboard of this workspace. */
function visible(workspaceId: string, personId: string) {
  return and(
    eq(dashboardTable.workspaceId, workspaceId),
    or(
      eq(dashboardTable.scope, "workspace"),
      eq(dashboardTable.ownerId, personId),
    ),
  );
}

export async function getDashboardScope(id: string) {
  const [row] = await db
    .select({
      id: dashboardTable.id,
      workspaceId: dashboardTable.workspaceId,
      scope: dashboardTable.scope,
      ownerId: dashboardTable.ownerId,
    })
    .from(dashboardTable)
    .where(eq(dashboardTable.id, id))
    .limit(1);
  return row;
}

export async function getDashboard(
  workspaceId: string,
  personId: string,
  id: string,
  executor: Executor = db,
) {
  const [row] = await executor
    .select()
    .from(dashboardTable)
    .where(and(eq(dashboardTable.id, id), visible(workspaceId, personId)))
    .limit(1);
  return row;
}

export async function listWidgets(
  dashboardId: string,
  executor: Executor = db,
) {
  return executor
    .select()
    .from(dashboardWidgetTable)
    .where(eq(dashboardWidgetTable.dashboardId, dashboardId))
    .orderBy(
      asc(dashboardWidgetTable.y),
      asc(dashboardWidgetTable.x),
      asc(dashboardWidgetTable.id),
    );
}

/**
 * RP-16: a person with no dashboard of their own and a workspace with no workspace dashboard gets
 * the default one. Insert-only (a unique index decides a race), so a person who deletes it gets it
 * back only while they still have none: deleting the last dashboard is how to reset to the default.
 */
export async function ensureDefaultDashboard(
  workspaceId: string,
  personId: string,
  actor: ReportActor,
) {
  const [existing] = await db
    .select({ id: dashboardTable.id })
    .from(dashboardTable)
    .where(visible(workspaceId, personId))
    .limit(1);
  if (existing) return;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(dashboardTable)
      .values({
        workspaceId,
        ownerId: personId,
        name: DEFAULT_DASHBOARD_NAME,
        scope: "personal",
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return;
    await tx.insert(dashboardWidgetTable).values(
      DEFAULT_WIDGETS.map((widget) => ({
        dashboardId: row.id,
        reportKey: widget.reportKey,
        chartType: widget.chartType,
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h,
      })),
    );
    await auditReport(tx, {
      action: "dashboard.created",
      workspaceId,
      entityType: "dashboard",
      entityId: row.id,
      actor,
      after: { name: row.name, scope: "personal", default: true },
    });
  });
}

export async function listDashboards(workspaceId: string, personId: string) {
  const rows = await db
    .select({
      dashboard: dashboardTable,
      widgetCount: sql<number>`(SELECT count(*) FROM dashboard_widget w WHERE w.dashboard_id = ${dashboardTable.id})`,
    })
    .from(dashboardTable)
    .where(visible(workspaceId, personId))
    .orderBy(
      sql`${dashboardTable.scope} = 'personal' DESC`,
      sql`${dashboardTable.isDefault} DESC`,
      asc(dashboardTable.name),
    );
  return rows.map((row) => ({
    ...row.dashboard,
    widgetCount: Number(row.widgetCount),
  }));
}

type WidgetValues = {
  id?: string | undefined;
  reportKey?: string | null | undefined;
  savedViewId?: string | null | undefined;
  chartType: "bar" | "line" | "table" | "number";
  filters: Record<string, unknown>;
  x: number;
  y: number;
  w: number;
  h: number;
};

async function assertLimits(
  tx: Executor,
  workspaceId: string,
  personId: string,
  scope: "personal" | "workspace",
) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)` })
    .from(dashboardTable)
    .where(
      scope === "personal"
        ? and(
            eq(dashboardTable.workspaceId, workspaceId),
            eq(dashboardTable.ownerId, personId),
          )
        : and(
            eq(dashboardTable.workspaceId, workspaceId),
            eq(dashboardTable.scope, "workspace"),
          ),
    );
  const limit =
    scope === "personal" ? MAX_PERSONAL_DASHBOARDS : MAX_WORKSPACE_DASHBOARDS;
  if (Number(row?.n ?? 0) >= limit) throw new DashboardLimitError();
}

export async function createDashboard(input: {
  workspaceId: string;
  personId: string;
  name: string;
  scope: "personal" | "workspace";
  isDefault: boolean;
  widgets: WidgetValues[];
  actor: ReportActor;
}) {
  try {
    return await db.transaction(async (tx) => {
      await assertLimits(tx, input.workspaceId, input.personId, input.scope);
      if (input.isDefault && input.scope === "workspace")
        await tx
          .update(dashboardTable)
          .set({ isDefault: false })
          .where(
            and(
              eq(dashboardTable.workspaceId, input.workspaceId),
              eq(dashboardTable.isDefault, true),
            ),
          );
      const [row] = await tx
        .insert(dashboardTable)
        .values({
          workspaceId: input.workspaceId,
          ownerId: input.scope === "personal" ? input.personId : null,
          name: input.name,
          scope: input.scope,
          isDefault: input.scope === "workspace" && input.isDefault,
        })
        .returning();
      if (!row) throw new Error("expected a returned row");
      if (input.widgets.length)
        await tx.insert(dashboardWidgetTable).values(
          input.widgets.map((widget) => ({
            id: createId(),
            dashboardId: row.id,
            reportKey: widget.reportKey ?? null,
            savedViewId: widget.savedViewId ?? null,
            chartType: widget.chartType,
            filters: widget.filters,
            x: widget.x,
            y: widget.y,
            w: widget.w,
            h: widget.h,
          })),
        );
      await auditReport(tx, {
        action: "dashboard.created",
        workspaceId: input.workspaceId,
        entityType: "dashboard",
        entityId: row.id,
        actor: input.actor,
        after: {
          name: row.name,
          scope: row.scope,
          widgets: input.widgets.length,
        },
      });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error, "dashboard_scope_name_unique"))
      throw new DashboardNameTakenError();
    throw error;
  }
}

/**
 * RP-15: one atomic save of name, default flag and the whole layout, guarded by `version` so two
 * editors cannot silently overwrite each other (the second gets a 409 and reloads).
 */
export async function updateDashboard(input: {
  workspaceId: string;
  id: string;
  version: number;
  name?: string | undefined;
  isDefault?: boolean | undefined;
  widgets?: WidgetValues[] | undefined;
  actor: ReportActor;
}) {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(dashboardTable)
        .where(
          and(
            eq(dashboardTable.id, input.id),
            eq(dashboardTable.workspaceId, input.workspaceId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) return undefined;
      if (current.version !== input.version)
        throw new DashboardVersionConflictError();
      if (input.isDefault === true && current.scope === "workspace")
        await tx
          .update(dashboardTable)
          .set({ isDefault: false })
          .where(
            and(
              eq(dashboardTable.workspaceId, input.workspaceId),
              eq(dashboardTable.isDefault, true),
            ),
          );
      const [row] = await tx
        .update(dashboardTable)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isDefault !== undefined && current.scope === "workspace"
            ? { isDefault: input.isDefault }
            : {}),
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(dashboardTable.id, input.id))
        .returning();
      if (input.widgets) {
        // Widgets keep their ids across a save (a drag or resize), so a link to a widget's data survives.
        const existing = await tx
          .select({ id: dashboardWidgetTable.id })
          .from(dashboardWidgetTable)
          .where(eq(dashboardWidgetTable.dashboardId, input.id));
        const owned = new Set(existing.map((entry) => entry.id));
        const keep = input.widgets
          .map((widget) => widget.id)
          .filter((id): id is string => Boolean(id && owned.has(id)));
        const drop = existing
          .map((entry) => entry.id)
          .filter((id) => !keep.includes(id));
        if (drop.length)
          await tx
            .delete(dashboardWidgetTable)
            .where(inArray(dashboardWidgetTable.id, drop));
        for (const widget of input.widgets) {
          const values = {
            reportKey: widget.reportKey ?? null,
            savedViewId: widget.savedViewId ?? null,
            chartType: widget.chartType,
            filters: widget.filters,
            x: widget.x,
            y: widget.y,
            w: widget.w,
            h: widget.h,
          };
          if (widget.id && owned.has(widget.id))
            await tx
              .update(dashboardWidgetTable)
              .set(values)
              .where(eq(dashboardWidgetTable.id, widget.id));
          else
            await tx
              .insert(dashboardWidgetTable)
              .values({ id: createId(), dashboardId: input.id, ...values });
        }
      }
      await auditReport(tx, {
        action: "dashboard.updated",
        workspaceId: input.workspaceId,
        entityType: "dashboard",
        entityId: input.id,
        actor: input.actor,
        before: { name: current.name, version: current.version },
        after: {
          name: row?.name ?? current.name,
          version: current.version + 1,
          ...(input.widgets ? { widgets: input.widgets.length } : {}),
        },
      });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error, "dashboard_scope_name_unique"))
      throw new DashboardNameTakenError();
    throw error;
  }
}

export async function lockDashboard(tx: Executor, id: string) {
  const [row] = await tx
    .select()
    .from(dashboardTable)
    .where(eq(dashboardTable.id, id))
    .for("update")
    .limit(1);
  return row;
}

export async function deleteDashboardRow(
  tx: Executor,
  row: DashboardRow,
  actor: ReportActor,
) {
  // PA-12: an open hold on the owner or the organisation of the workspace refuses the hard delete.
  await assertRowNotUnderLegalHold(tx, {
    workspaceId: row.workspaceId,
    personIds: sql`SELECT ${row.ownerId}::text`,
  });
  const deleted = await tx
    .delete(dashboardTable)
    .where(
      and(
        eq(dashboardTable.id, row.id),
        eq(dashboardTable.version, row.version),
      ),
    )
    .returning({ id: dashboardTable.id });
  if (deleted.length === 0) return false;
  await auditReport(tx, {
    action: "dashboard.deleted",
    workspaceId: row.workspaceId,
    entityType: "dashboard",
    entityId: row.id,
    actor,
    before: { name: row.name, scope: row.scope },
  });
  return true;
}

export async function getWidget(dashboardId: string, widgetId: string) {
  const [row] = await db
    .select()
    .from(dashboardWidgetTable)
    .where(
      and(
        eq(dashboardWidgetTable.dashboardId, dashboardId),
        eq(dashboardWidgetTable.id, widgetId),
      ),
    )
    .limit(1);
  return row;
}

export { isNull };
