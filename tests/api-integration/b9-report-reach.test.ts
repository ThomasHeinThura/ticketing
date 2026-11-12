import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  dashboardTable,
  dashboardWidgetTable,
  reportExportChunkTable,
  reportExportTable,
} from "../../apps/api/src/database/schema-p5-reports";
import { createApp } from "../../apps/api/src/index";
import { resolveRequestIdentity } from "../../apps/api/src/permissions/resolve-request-identity";
import { reachPredicate, selectRows } from "../../apps/api/src/report/context";
import { processExport } from "../../apps/api/src/report/export.service";
import { writeWorkspaceDays } from "../../apps/api/src/report/snapshot.repository";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, grantProjectRole } from "./helpers/fixtures";
import { setFeature } from "./helpers/p5-reports";
import {
  addCanonicalMember,
  addMember,
  createItem,
  json,
  makeState,
  setAmbientHeaders,
  setupWorld,
} from "./helpers/reach-world";

describe("B-9 report project reach", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  for (const role of [
    "member",
    "lead",
    "viewer",
    "manager",
    "admin",
    "owner",
  ] as const) {
    it(`${role} report data and exports follow project reach even with report:read_all`, async () => {
      const world = await setupWorld();
      const { app } = createApp();
      const projectA = await createProjectFixture({
        workspaceId: world.workspaceId,
        name: "B9 Visible A",
      });
      const state = await makeState(
        world.workspaceId,
        projectA.project.id,
        "backlog",
        true,
      );
      const hidden = await createItem(app, world, "B9 Secret B");
      await db.insert(schema.workItemTable).values({
        workspaceId: world.workspaceId,
        projectId: projectA.project.id,
        stateId: state.state.id,
        typeId: world.type.id,
        title: "B9 Visible A task",
        number: 33,
        key: "B9-A-33",
      });
      const closedDay = new Date(Date.now() - 2 * 86400000);
      await db
        .update(schema.workItemTable)
        .set({ createdAt: closedDay })
        .where(eq(schema.workItemTable.workspaceId, world.workspaceId));
      await setFeature(world.workspaceId, "feature.reports", true);
      await writeWorkspaceDays(
        world.workspaceId,
        [closedDay.toISOString().slice(0, 10)],
        new Date(),
      );
      const caller =
        role === "manager" || role === "lead"
          ? await addCanonicalMember(world.workspaceId, role)
          : await addMember(world.workspaceId, role);
      if (role === "member" || role === "viewer")
        await grantProjectRole(caller.user.id, projectA.project.id, [
          "project:read",
          "work_item:read",
        ]);
      await db
        .update(schema.roleTable)
        .set({
          capabilities: sql`${schema.roleTable.capabilities} || '["report:read_all", "report:export"]'::jsonb`,
        })
        .where(
          and(
            eq(schema.roleTable.workspaceId, world.workspaceId),
            eq(schema.roleTable.scope, "workspace"),
            eq(schema.roleTable.key, role),
          ),
        );
      const identity = await resolveRequestIdentity({ userId: caller.user.id });
      if (!identity) throw new Error("identity missing");
      const ids = await selectRows<{ id: string }>(
        sql`SELECT p.id FROM project p WHERE p.workspace_id = ${world.workspaceId} AND p.deleted_at IS NULL AND ${reachPredicate(identity, false)}`,
      );
      const allowed = new Set(ids.map((row) => row.id));
      if (role === "member" || role === "viewer") {
        expect(allowed.has(projectA.project.id)).toBe(true);
        expect(allowed.has(world.project.id)).toBe(false);
      }
      if (role === "lead") expect(allowed.size).toBe(0);
      const [dashboard] = await db
        .insert(dashboardTable)
        .values({
          workspaceId: world.workspaceId,
          name: "B9 shared",
          scope: "workspace",
        })
        .returning();
      if (!dashboard) throw new Error("dashboard missing");
      const [widget] = await db
        .insert(dashboardWidgetTable)
        .values({
          dashboardId: dashboard.id,
          reportKey: "work_mix",
          filters: { window: "30" },
        })
        .returning();
      if (!widget) throw new Error("widget missing");
      const [hiddenWidget] = await db
        .insert(dashboardWidgetTable)
        .values({
          dashboardId: dashboard.id,
          reportKey: "work_mix",
          filters: { projectId: world.project.id },
        })
        .returning();
      if (!hiddenWidget) throw new Error("hidden widget missing");
      mockAuthenticatedSession(caller.user);
      const dashboardDetail = await json(
        app,
        "GET",
        `/api/dashboards/${dashboard.id}`,
      );
      expect(dashboardDetail.status).toBe(200);
      const dashboardText = await dashboardDetail.text();
      expect(dashboardText.includes(hiddenWidget.id)).toBe(
        allowed.has(world.project.id),
      );
      expect(dashboardText.includes(world.project.id)).toBe(
        allowed.has(world.project.id),
      );
      const widgetDrill = await json(
        app,
        "GET",
        `/api/dashboards/${dashboard.id}/widgets/${widget.id}/items`,
      );
      expect(widgetDrill.status).toBe(200);
      expect((await widgetDrill.text()).includes(hidden.key)).toBe(
        allowed.has(world.project.id),
      );
      const widgetExport = await json(
        app,
        "POST",
        `/api/dashboards/${dashboard.id}/widgets/${widget.id}/export`,
        {},
      );
      expect(widgetExport.status, await widgetExport.clone().text()).toBe(200);
      const customPreview = await json(
        app,
        "POST",
        "/api/reports/custom/preview",
        {
          workspaceId: world.workspaceId,
          query: { entity: "work_item", groupBy: "project" },
          chartType: "table",
        },
      );
      expect(customPreview.status, await customPreview.clone().text()).toBe(
        200,
      );
      const previewText = await customPreview.text();
      expect(previewText.includes(world.project.name)).toBe(
        allowed.has(world.project.id),
      );
      const report = await json(
        app,
        "GET",
        `/api/reports/work_mix?workspaceId=${world.workspaceId}&window=30`,
      );
      expect(report.status, await report.clone().text()).toBe(200);
      const body = await report.text();
      const parsed = JSON.parse(body) as {
        scope: { projectCount: number };
        metrics: Array<{ key: string; value: number | null }>;
        sources: { metricSnapshot: boolean };
      };
      expect(parsed.sources.metricSnapshot).toBe(true);
      expect(parsed.scope.projectCount).toBe(allowed.size);
      expect(
        parsed.metrics.find((metric) => metric.key === "created")?.value ?? 0,
      ).toBe(
        Number(allowed.has(projectA.project.id)) +
          Number(allowed.has(world.project.id)),
      );
      const drill = await json(
        app,
        "GET",
        `/api/reports/work_mix/items?workspaceId=${world.workspaceId}&window=30`,
      );
      expect(drill.status).toBe(200);
      expect((await drill.text()).includes(hidden.key)).toBe(
        allowed.has(world.project.id),
      );
      const widgetData = await json(
        app,
        "GET",
        `/api/dashboards/${dashboard.id}/widgets/${widget.id}/data`,
      );
      expect(widgetData.status, await widgetData.clone().text()).toBe(200);
      expect(
        ((await widgetData.json()) as { scope: { projectCount: number } }).scope
          .projectCount,
      ).toBe(allowed.size);
      const csv = await json(app, "POST", "/api/reports/work_mix/export", {
        workspaceId: world.workspaceId,
        window: "30",
      });
      expect(csv.status, await csv.clone().text()).toBe(200);
      const customCsv = await json(app, "POST", "/api/reports/custom/export", {
        workspaceId: world.workspaceId,
        query: { entity: "work_item", groupBy: "project" },
        chartType: "table",
      });
      expect(customCsv.status, await customCsv.clone().text()).toBe(200);
      const csvText = await customCsv.text();
      expect(csvText.includes("B9 Visible A")).toBe(
        allowed.has(projectA.project.id),
      );
      expect(csvText.includes(world.project.name)).toBe(
        allowed.has(world.project.id),
      );
      const [queued] = await db
        .insert(reportExportTable)
        .values({
          workspaceId: world.workspaceId,
          personId: identity.personId,
          userId: caller.user.id,
          kind: "custom",
          title: "B9 queued",
          spec: {
            kind: "custom",
            name: "B9 queued",
            query: { entity: "work_item", groupBy: "project" },
            chartType: "table",
          },
          caps: { readAll: true, showRates: false, readAnyTime: false },
          status: "running",
        })
        .returning();
      if (!queued) throw new Error("queued export missing");
      expect(await processExport(queued)).toBe("ready");
      const chunks = await db
        .select()
        .from(reportExportChunkTable)
        .where(eq(reportExportChunkTable.exportId, queued.id));
      const queuedCsv = chunks.map((chunk) => chunk.content).join("");
      expect(queuedCsv.includes("B9 Visible A")).toBe(
        allowed.has(projectA.project.id),
      );
      expect(queuedCsv.includes(world.project.name)).toBe(
        allowed.has(world.project.id),
      );
      const saved = await db
        .select()
        .from(reportExportTable)
        .where(eq(reportExportTable.id, queued.id));
      expect(new Set(saved[0]?.caps.projectIds as string[])).toEqual(allowed);
      const hiddenReport = await json(
        app,
        "GET",
        `/api/reports/work_mix?workspaceId=${world.workspaceId}&projectId=${world.project.id}`,
      );
      expect(hiddenReport.status).toBe(
        allowed.has(world.project.id) ? 200 : 404,
      );
      if (!allowed.has(world.project.id)) {
        const missingReport = await json(
          app,
          "GET",
          `/api/reports/work_mix?workspaceId=${world.workspaceId}&projectId=missing-b9`,
        );
        expect(missingReport.status).toBe(404);
        expect(await hiddenReport.text()).toBe(await missingReport.text());
      }
      if (role === "member") {
        const [pending] = await db
          .insert(reportExportTable)
          .values({
            workspaceId: world.workspaceId,
            personId: identity.personId,
            userId: caller.user.id,
            kind: "custom",
            title: "B9 pending",
            spec: queued.spec,
            caps: {
              readAll: false,
              showRates: false,
              readAnyTime: false,
              projectIds: [projectA.project.id],
            },
            status: "running",
          })
          .returning();
        if (!pending) throw new Error("pending export missing");
        await db
          .delete(schema.membershipTable)
          .where(
            and(
              eq(schema.membershipTable.personId, identity.personId),
              eq(schema.membershipTable.scope, "project"),
              eq(schema.membershipTable.scopeId, projectA.project.id),
            ),
          );
        expect(await processExport(pending)).toBe("ready");
        const after = await db
          .select()
          .from(reportExportChunkTable)
          .where(eq(reportExportChunkTable.exportId, pending.id));
        expect(after.map((chunk) => chunk.content).join("")).not.toContain(
          "B9 Visible A",
        );
        expect(
          (await json(app, "GET", `/api/report-exports/${queued.id}/download`))
            .status,
        ).toBe(404);
        const [legacy] = await db
          .insert(reportExportTable)
          .values({
            workspaceId: world.workspaceId,
            personId: identity.personId,
            userId: caller.user.id,
            kind: "custom",
            title: "B9 old",
            spec: queued.spec,
            caps: { readAll: true },
            status: "ready",
            content: "B9 old secret",
          })
          .returning();
        if (!legacy) throw new Error("legacy export missing");
        expect(
          (await json(app, "GET", `/api/report-exports/${legacy.id}`)).status,
        ).toBe(404);
      }
    });
  }
});
