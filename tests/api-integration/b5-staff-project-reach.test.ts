import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPersonalApiKey } from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import {
  cycleTable,
  moduleTable,
} from "../../apps/api/src/database/schema-p5-agile";
import { projectPageTable } from "../../apps/api/src/database/schema-p5-pages";
import {
  dashboardTable,
  dashboardWidgetTable,
  reportExportTable,
} from "../../apps/api/src/database/schema-p5-reports";
import {
  changeDetailTable,
  changeServiceTable,
  serviceLinkTable,
  serviceTable,
} from "../../apps/api/src/database/schema-p5-service";
import {
  timeActivityTable,
  timeEntryTable,
} from "../../apps/api/src/database/schema-p5-time";
import { createApp } from "../../apps/api/src/index";
import { putAttachmentObject } from "../../apps/api/src/storage";
import { TaskDeskClient } from "../../packages/mcp/src/taskdesk/client";
import { registerTools } from "../../packages/mcp/src/tools/register";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, grantProjectRole } from "./helpers/fixtures";
import { setAgileFlags } from "./helpers/p5-agile";
import { setPagesFlag } from "./helpers/p5-pages";
import { setFeature } from "./helpers/p5-reports";
import { setServiceFlag } from "./helpers/p5-service";
import { setTimeFlags } from "./helpers/p5-time";
import {
  addMember,
  createItem,
  json,
  makeApiKey,
  seedLegacy,
  setAmbientHeaders,
  setupWorld,
} from "./helpers/reach-world";
import { upsertWorkspaceRoleRows } from "./helpers/workspace-role-rows";

describe("B-5: staff project reach", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterEach(() => {
    setAmbientHeaders({});
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  for (const role of ["member", "lead", "viewer"] as const) {
    it(`${role} cannot read the other managed service or its item`, async () => {
      const world = await setupWorld();
      const { app } = createApp();
      const visible = await createProjectFixture({
        workspaceId: world.workspaceId,
        name: "Visible B5 project",
      });
      const [calendar] = await db
        .insert(schema.serviceCalendarTable)
        .values({
          workspaceId: world.workspaceId,
          name: "B5 calendar",
          timezone: "UTC",
          windows: {},
          holidays: [],
        })
        .returning();
      if (!calendar) throw new Error("calendar fixture missing");
      await db
        .update(schema.workspaceTable)
        .set({ defaultServiceCalendarId: calendar.id })
        .where(eq(schema.workspaceTable.id, world.workspaceId));
      await db
        .update(schema.projectTable)
        .set({
          name: "Hidden B5 service",
          kind: "managed_service",
          supportLevel: "L1",
          serviceCalendarMode: "inherit",
        })
        .where(eq(schema.projectTable.id, world.project.id));
      const item = await createItem(app, world, "Hidden B5 work item");
      const legacy = await seedLegacy(world, world.projectMember.user.id);
      const [legacyEntry] = await db
        .insert(schema.taskTimeEntryTable)
        .values({
          taskId: legacy.taskId,
          userId: world.projectMember.user.id,
          startTime: new Date(),
          duration: 42,
        })
        .returning();
      if (!legacyEntry) throw new Error("legacy time fixture missing");
      const [attachment] = await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: world.workspaceId,
          workItemId: item.id,
          objectKey: `b5/${item.id}`,
          filename: "Hidden B5 attachment.pdf",
          mimeType: "application/pdf",
          size: 12,
          state: "ready",
        })
        .returning();
      if (!attachment) throw new Error("attachment fixture missing");
      await setServiceFlag(world.workspaceId, true);
      await setFeature(world.workspaceId, "feature.reports", true);
      const [service] = await db
        .insert(serviceTable)
        .values({ workspaceId: world.workspaceId, name: "Shared service" })
        .returning();
      if (!service) throw new Error("service fixture missing");
      await db.insert(serviceLinkTable).values({
        workspaceId: world.workspaceId,
        serviceId: service.id,
        kind: "project",
        projectId: world.project.id,
      });
      await db
        .update(schema.workItemTypeTable)
        .set({ key: "incident" })
        .where(eq(schema.workItemTypeTable.id, world.type.id));
      await db
        .update(schema.workItemTable)
        .set({ serviceId: service.id })
        .where(eq(schema.workItemTable.id, item.id));
      const [changeType] = await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: world.workspaceId,
          key: "change",
          name: "Change",
          category: "service",
          isChange: true,
        })
        .returning();
      if (!changeType) throw new Error("change type fixture missing");
      const [change] = await db
        .insert(schema.workItemTable)
        .values({
          workspaceId: world.workspaceId,
          projectId: world.project.id,
          typeId: changeType.id,
          stateId: world.started.state.id,
          title: "Hidden B5 change",
          number: 2,
          key: "B5-CHANGE",
          serviceId: service.id,
        })
        .returning();
      if (!change) throw new Error("change fixture missing");
      await db
        .insert(schema.workItemRelationTable)
        .values({ sourceId: item.id, targetId: change.id, type: "blocks" });
      await db
        .insert(changeDetailTable)
        .values({ workspaceId: world.workspaceId, workItemId: change.id });
      await db.insert(changeServiceTable).values({
        workspaceId: world.workspaceId,
        workItemId: change.id,
        serviceId: service.id,
      });
      await setAgileFlags(world.project.id, { cycles: true, modules: true });
      await setPagesFlag([world.project.id], true);
      const [cycle] = await db
        .insert(cycleTable)
        .values({
          workspaceId: world.workspaceId,
          projectId: world.project.id,
          name: "Hidden B5 cycle",
          startDate: "2030-01-01",
          endDate: "2030-01-31",
        })
        .returning();
      const [module] = await db
        .insert(moduleTable)
        .values({
          workspaceId: world.workspaceId,
          projectId: world.project.id,
          name: "Hidden B5 module",
        })
        .returning();
      const [page] = await db
        .insert(projectPageTable)
        .values({
          workspaceId: world.workspaceId,
          projectId: world.project.id,
          title: "Hidden B5 page",
          body: { type: "doc", content: [] },
        })
        .returning();
      if (!cycle || !module || !page)
        throw new Error("project fixture missing");
      await db.insert(schema.milestoneTable).values({
        projectId: world.project.id,
        name: "Hidden B5 milestone",
        date: new Date("2030-01-01"),
      });
      await db.insert(schema.documentLinkTable).values({
        projectId: world.project.id,
        title: "Hidden B5 document",
        url: "https://example.invalid/b5",
      });
      await db.insert(schema.projectContractTable).values({
        projectId: world.project.id,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        contractedMinutes: 900,
        coverage: "9x5",
      });
      const caller = await addMember(world.workspaceId, role);
      const [savedExport] = await db
        .insert(reportExportTable)
        .values({
          workspaceId: world.workspaceId,
          personId: caller.personId,
          userId: caller.user.id,
          kind: "custom",
          title: "Hidden B5 export",
          spec: { kind: "custom" },
          caps: {
            readAll: false,
            readAnyTime: false,
            projectIds: [world.project.id],
          },
          status: "ready",
          content: "Hidden B5 report",
        })
        .returning();
      if (!savedExport) throw new Error("export fixture missing");
      const [missingExport] = await db
        .insert(reportExportTable)
        .values({
          workspaceId: world.workspaceId,
          personId: caller.personId,
          userId: caller.user.id,
          kind: "custom",
          title: "Missing project export",
          spec: { kind: "custom" },
          caps: { readAll: false, projectIds: ["missing-project"] },
          status: "ready",
          content: "Old report",
        })
        .returning();
      if (!missingExport) throw new Error("missing export fixture missing");
      const [view] = await db
        .insert(schema.savedViewTable)
        .values({
          workspaceId: world.workspaceId,
          createdBy: caller.personId,
          name: "Hidden B5 view",
          scope: "project",
          scopeId: world.project.id,
          visibility: "workspace",
          layout: "calendar",
          query: { entity: "work_item" },
        })
        .returning();
      if (!view) throw new Error("view fixture missing");
      const [dashboard] = await db
        .insert(dashboardTable)
        .values({
          workspaceId: world.workspaceId,
          name: "Shared B5 dashboard",
          scope: "workspace",
        })
        .returning();
      if (!dashboard) throw new Error("dashboard fixture missing");
      const [widget] = await db
        .insert(dashboardWidgetTable)
        .values({
          dashboardId: dashboard.id,
          reportKey: "work_mix",
          filters: { projectId: world.project.id, window: "30" },
        })
        .returning();
      if (!widget) throw new Error("widget fixture missing");
      const [chartView] = await db
        .insert(schema.savedViewTable)
        .values({
          workspaceId: world.workspaceId,
          createdBy: caller.personId,
          name: "Hidden B5 chart",
          scope: "project",
          scopeId: world.project.id,
          visibility: "workspace",
          layout: "chart",
          query: { entity: "work_item" },
        })
        .returning();
      if (!chartView) throw new Error("chart fixture missing");
      const [viewWidget, cycleWidget] = await db
        .insert(dashboardWidgetTable)
        .values([
          { dashboardId: dashboard.id, savedViewId: chartView.id, x: 6 },
          {
            dashboardId: dashboard.id,
            reportKey: "cycle_burndown",
            filters: { cycle: cycle.id },
            y: 4,
          },
        ])
        .returning();
      if (!viewWidget || !cycleWidget)
        throw new Error("widget fixtures missing");
      const [personal] = await db
        .insert(dashboardTable)
        .values({
          workspaceId: world.workspaceId,
          name: "Personal B5 dashboard",
          scope: "personal",
          ownerId: caller.personId,
        })
        .returning();
      if (!personal) throw new Error("personal dashboard fixture missing");
      const [personalWidget] = await db
        .insert(dashboardWidgetTable)
        .values({
          dashboardId: personal.id,
          reportKey: "work_mix",
          filters: { projectId: world.project.id },
        })
        .returning();
      if (!personalWidget) throw new Error("personal widget fixture missing");
      await setTimeFlags(world.workspaceId);
      const [timeActivity] = await db
        .insert(timeActivityTable)
        .values({ workspaceId: world.workspaceId, name: "B5 activity" })
        .returning();
      if (!timeActivity) throw new Error("time activity fixture missing");
      const [entry] = await db
        .insert(timeEntryTable)
        .values({
          workspaceId: world.workspaceId,
          projectId: world.project.id,
          workItemId: item.id,
          personId: caller.personId,
          date: "2026-11-01",
          minutes: 37,
          activityId: timeActivity.id,
          billable: false,
          description: "Hidden B5 time",
        })
        .returning();
      if (!entry) throw new Error("time entry fixture missing");
      await db.insert(schema.notificationTable).values({
        userId: caller.user.id,
        personId: caller.personId,
        type: "work_item_transitioned",
        kind: "work_item.transitioned",
        resourceType: "work_item",
        resourceId: item.id,
        eventData: { kind: "work_item.transitioned" },
        title: "Hidden B5 notification",
        body: "Hidden B5 body",
        isRead: false,
      });
      if (role !== "lead")
        await grantProjectRole(caller.user.id, visible.project.id, [
          "project:read",
          "work_item:read",
        ]);
      mockAuthenticatedSession(world.projectMember.user);
      const allServices = await json(
        app,
        "GET",
        `/api/services?workspaceId=${world.workspaceId}`,
      );
      expect(allServices.status).toBe(200);
      const serviceRows = (await allServices.json()) as {
        data: Array<{ incidentCount: number; openChangeCount: number }>;
      };
      expect(serviceRows.data[0]).toMatchObject({
        incidentCount: 1,
        openChangeCount: 1,
      });
      const readableDetail = await json(
        app,
        "GET",
        `/api/services/${service.id}`,
      );
      expect(readableDetail.status).toBe(200);
      const fullDetail = (await readableDetail.json()) as {
        deletionBlockers: string[];
      };
      expect(fullDetail.deletionBlockers).toContain(
        "The service has 1 open change.",
      );
      const reportUrl = `/api/reports/work_mix?workspaceId=${world.workspaceId}&window=30`;
      const fullReport = await json(app, "GET", reportUrl);
      expect(fullReport.status, await fullReport.clone().text()).toBe(200);
      const reportAll = (await fullReport.json()) as {
        scope: { kind: string; projectCount: number };
        rows: unknown[];
        metrics: Array<{ key: string; value: number | null }>;
      };
      expect(reportAll.scope).toEqual({ kind: "all", projectCount: 2 });
      expect(reportAll.rows.length).toBeGreaterThan(0);
      expect(
        reportAll.metrics.find((metric) => metric.key === "created")?.value,
      ).toBe(2);
      const fullProjectReport = await json(
        app,
        "GET",
        `${reportUrl}&projectId=${world.project.id}`,
      );
      expect(fullProjectReport.status).toBe(200);
      const fullProjectBody = (await fullProjectReport.json()) as {
        scope: { kind: string };
        metrics: Array<{ key: string; value: number | null }>;
      };
      expect(fullProjectBody.scope.kind).toBe("all");
      expect(
        fullProjectBody.metrics.find((metric) => metric.key === "created")
          ?.value,
      ).toBe(2);
      const hiddenPaths = [
        `/api/project/${world.project.id}`,
        `/api/project/${world.project.id}/overview`,
        `/api/projects/${world.project.id}/work-items`,
        `/api/projects/${world.project.id}/work-items/combined`,
        `/api/task/${legacy.taskId}`,
        `/api/task/tasks/${world.project.id}`,
        `/api/column/${world.project.id}`,
        `/api/projects/${world.project.id}/states`,
        `/api/activity/${legacy.taskId}`,
        `/api/time-entry/task/${legacy.taskId}`,
        `/api/time-entry/${legacyEntry.id}`,
        `/api/work-items/${item.key}`,
        `/api/work-items/${item.key}/activity`,
        `/api/audit/entity/work_item/${item.key}`,
        `/api/work-items/${item.key}/attachments`,
        `/api/project/${world.project.id}/milestones`,
        `/api/project/${world.project.id}/document-links`,
        `/api/project/${world.project.id}/contract`,
        `/api/projects/${world.project.id}/pages`,
        `/api/projects/${world.project.id}/pages/${page.id}`,
        `/api/projects/${world.project.slug}/cycles`,
        `/api/projects/${world.project.slug}/modules`,
        `/api/projects/${world.project.slug}/dependencies`,
        `/api/projects/${world.project.slug}/wip-limits`,
        `/api/cycles/${cycle.id}`,
        `/api/modules/${module.id}`,
      ];
      for (const path of hiddenPaths) {
        const response = await json(app, "GET", path);
        expect(
          response.status,
          `reachable ${path}: ${await response.clone().text()}`,
        ).toBe(200);
      }
      const download = await json(
        app,
        "GET",
        `/api/attachments/${attachment.id}`,
      );
      expect(download.status).toBe(302);
      expect(download.headers.has("location")).toBe(true);
      mockAuthenticatedSession(caller.user);
      const list = await json(
        app,
        "GET",
        `/api/project?workspaceId=${world.workspaceId}`,
      );
      expect(list.status, await list.clone().text()).toBe(200);
      const listText = await list.text();
      expect(listText).not.toContain("Hidden B5 service");
      expect(listText.includes("Visible B5 project")).toBe(role !== "lead");
      expect(
        (await json(app, "GET", `/api/workspaces/${world.workspaceId}/audit`))
          .status,
      ).toBe(403);
      for (const path of hiddenPaths) {
        const response = await json(app, "GET", path);
        expect(response.status, path).toBe(404);
      }
      const hiddenDownload = await json(
        app,
        "GET",
        `/api/attachments/${attachment.id}`,
      );
      expect(hiddenDownload.status).toBe(404);
      expect(hiddenDownload.headers.has("location")).toBe(false);
      const combined = await json(
        app,
        "POST",
        `/api/projects/${world.project.id}/work-items/combined`,
        { query: { entity: "work_item" } },
      );
      expect(combined.status).toBe(404);
      const workSearch = await json(app, "POST", "/api/work-items/search", {
        workspaceId: world.workspaceId,
        query: { entity: "work_item" },
      });
      expect(workSearch.status).toBe(200);
      const workSearchBody = (await workSearch.json()) as {
        data: unknown[];
        meta: { total: number };
      };
      expect(workSearchBody.data).toEqual([]);
      expect(workSearchBody.meta.total).toBe(0);
      const search = await json(
        app,
        "GET",
        `/api/search?q=Hidden%20B5&workspaceId=${world.workspaceId}&type=projects`,
      );
      expect(search.status).toBe(200);
      const body = (await search.json()) as { totalCount: number };
      expect(body.totalCount).toBe(0);
      for (const path of ["/api/notification", "/api/notification/inbox"]) {
        const response = await json(app, "GET", path);
        expect(response.status, path).toBe(200);
        const text = await response.text();
        expect(text).not.toContain("Hidden B5 notification");
        if (path.endsWith("inbox"))
          expect(
            (JSON.parse(text) as { unreadCount: number }).unreadCount,
          ).toBe(0);
      }
      const palette = await json(
        app,
        "GET",
        `/api/search?q=Hidden%20B5&workspaceId=${world.workspaceId}&type=all&limit=20`,
      );
      expect(palette.status).toBe(200);
      expect(
        ((await palette.json()) as { totalCount: number }).totalCount,
      ).toBe(0);
      const time = await json(
        app,
        "GET",
        `/api/time-entries?workspaceId=${world.workspaceId}`,
      );
      expect(time.status).toBe(role === "viewer" ? 403 : 200);
      expect(await time.text()).not.toContain(entry.id);
      const timeSummary = await json(
        app,
        "GET",
        `/api/time-entries/summary?workspaceId=${world.workspaceId}&projectId=${world.project.id}`,
      );
      expect(timeSummary.status).toBe(role === "viewer" ? 403 : 404);
      for (const scope of [
        `workItemId=${item.id}`,
        `cycleId=${cycle.id}`,
        `moduleId=${module.id}`,
      ]) {
        const summary = await json(
          app,
          "GET",
          `/api/time-entries/summary?workspaceId=${world.workspaceId}&${scope}`,
        );
        expect(summary.status).toBe(role === "viewer" ? 403 : 404);
      }
      const report = await json(app, "GET", reportUrl);
      expect(report.status, await report.clone().text()).toBe(200);
      const scopedReport = (await report.json()) as {
        scope: { kind: string; projectCount: number };
        rows: unknown[];
      };
      expect(scopedReport.scope.kind).toBe("reach");
      expect(scopedReport.scope.projectCount).toBe(role === "lead" ? 0 : 1);
      expect(scopedReport.rows).toEqual([]);
      const hiddenReport = await json(
        app,
        "GET",
        `${reportUrl}&projectId=${world.project.id}`,
      );
      expect(hiddenReport.status).toBe(404);
      const hiddenDrill = await json(
        app,
        "GET",
        `/api/reports/workload/items?workspaceId=${world.workspaceId}&projectId=${world.project.id}`,
      );
      expect(hiddenDrill.status).toBe(404);
      const customBody = {
        workspaceId: world.workspaceId,
        query: { entity: "work_item", filter: { projectId: world.project.id } },
        chartType: "table",
      };
      expect(
        (await json(app, "POST", "/api/reports/custom/preview", customBody))
          .status,
      ).toBe(404);
      expect(
        (await json(app, "POST", "/api/reports/custom/items", customBody))
          .status,
      ).toBe(404);
      const hiddenExport = await json(
        app,
        "POST",
        "/api/reports/work_mix/export",
        { workspaceId: world.workspaceId, projectId: world.project.id },
      );
      expect(hiddenExport.status).toBe(role === "lead" ? 404 : 403);
      const hiddenCustomExport = await json(
        app,
        "POST",
        "/api/reports/custom/export",
        customBody,
      );
      expect(hiddenCustomExport.status).toBe(role === "lead" ? 404 : 403);
      const drill = await json(
        app,
        "GET",
        `/api/reports/workload/items?workspaceId=${world.workspaceId}&window=30`,
      );
      expect(drill.status, await drill.clone().text()).toBe(200);
      const drillText = await drill.text();
      expect(drillText).not.toContain(item.key);
      expect(drillText).not.toContain(change.key);
      const csv = await json(app, "POST", "/api/reports/work_mix/export", {
        workspaceId: world.workspaceId,
        window: "30",
      });
      expect(csv.status).toBe(role === "lead" ? 200 : 403);
      expect(await csv.text()).not.toContain("Hidden B5");
      const exports = await json(
        app,
        "GET",
        `/api/report-exports?workspaceId=${world.workspaceId}`,
      );
      expect(exports.status).toBe(role === "lead" ? 200 : 403);
      expect(await exports.text()).not.toContain(savedExport.id);
      if (role === "lead")
        expect(
          (await json(app, "GET", `/api/report-exports/${missingExport.id}`))
            .status,
        ).toBe(404);
      const exportDetail = await json(
        app,
        "GET",
        `/api/report-exports/${savedExport.id}`,
      );
      expect(exportDetail.status).toBe(role === "lead" ? 404 : 403);
      const exportDownload = await json(
        app,
        "GET",
        `/api/report-exports/${savedExport.id}/download`,
      );
      expect(exportDownload.status).toBe(role === "lead" ? 404 : 403);
      const views = await json(
        app,
        "GET",
        `/api/views?workspaceId=${world.workspaceId}`,
      );
      expect(views.status).toBe(200);
      expect(await views.text()).not.toContain(view.id);
      for (const path of [
        `/api/views/${view.id}`,
        `/api/views/${view.id}/count`,
      ]) {
        const response = await json(app, "GET", path);
        expect(response.status, path).toBe(404);
      }
      expect(
        (await json(app, "POST", `/api/views/${view.id}/run`)).status,
      ).toBe(404);
      const dashboards = await json(
        app,
        "GET",
        `/api/dashboards?workspaceId=${world.workspaceId}`,
      );
      expect(dashboards.status).toBe(200);
      const dashboardsText = await dashboards.text();
      expect(dashboardsText).not.toContain(world.project.id);
      expect(
        (
          JSON.parse(dashboardsText) as {
            data: Array<{ id: string; widgetCount: number }>;
          }
        ).data.find((row) => row.id === dashboard.id)?.widgetCount,
      ).toBe(0);
      expect(
        (
          JSON.parse(dashboardsText) as {
            data: Array<{ id: string; canEdit: boolean }>;
          }
        ).data.find((row) => row.id === personal.id)?.canEdit,
      ).toBe(false);
      const save = await json(app, "PATCH", `/api/dashboards/${personal.id}`, {
        version: 1,
        widgets: [],
      });
      expect(save.status).toBe(404);
      expect(
        await db
          .select()
          .from(dashboardWidgetTable)
          .where(eq(dashboardWidgetTable.id, personalWidget.id)),
      ).toHaveLength(1);
      const dashboardDetails = await json(
        app,
        "GET",
        `/api/dashboards/${dashboard.id}`,
      );
      expect(dashboardDetails.status).toBe(200);
      expect(await dashboardDetails.text()).not.toContain(world.project.id);
      const widgetData = await json(
        app,
        "GET",
        `/api/dashboards/${dashboard.id}/widgets/${widget.id}/data`,
      );
      expect(widgetData.status).toBe(404);
      for (const id of [viewWidget.id, cycleWidget.id]) {
        expect(
          (
            await json(
              app,
              "GET",
              `/api/dashboards/${dashboard.id}/widgets/${id}/data`,
            )
          ).status,
        ).toBe(404);
      }
      for (const path of [
        `/api/services?workspaceId=${world.workspaceId}`,
        `/api/services/${service.id}`,
      ]) {
        const response = await json(app, "GET", path);
        expect(
          response.status,
          `${path}: ${await response.clone().text()}`,
        ).toBe(200);
        const text = await response.text();
        expect(text).not.toContain(world.project.id);
        const payload = JSON.parse(text) as {
          data?: Array<{ incidentCount: number; openChangeCount: number }>;
          incidentCount?: number;
          openChangeCount?: number;
          deletionBlockers?: string[];
        };
        expect(payload.data?.[0]?.incidentCount ?? payload.incidentCount).toBe(
          0,
        );
        expect(
          payload.data?.[0]?.openChangeCount ?? payload.openChangeCount,
        ).toBe(0);
        expect(payload.deletionBlockers ?? []).not.toContain(
          "The service has 1 open change.",
        );
      }
      await db
        .insert(schema.instanceFeatureFlagTable)
        .values({ featureKey: "feature.mcp", enabled: true })
        .onConflictDoUpdate({
          target: schema.instanceFeatureFlagTable.featureKey,
          set: { enabled: true },
        });
      for (const isMcp of [false, true]) {
        const key = await createPersonalApiKey(
          { userId: caller.user.id },
          {
            name: "B5 probe",
            isMcp,
            capabilities: ["workspace:read", "project:read", "work_item:read"],
          },
        );
        mockAnonymousSession();
        setAmbientHeaders({ "x-api-key": key.key });
        const denied = await json(app, "GET", `/api/work-items/${item.key}`);
        expect(denied.status, `MCP=${isMcp}`).toBe(404);
        const projectList = await json(
          app,
          "GET",
          `/api/project?workspaceId=${world.workspaceId}`,
        );
        expect(projectList.status).toBe(200);
        expect(await projectList.text()).not.toContain(world.project.id);
        if (isMcp) {
          const toolHandlers = new Map<
            string,
            (
              args: Record<string, unknown>,
            ) => Promise<{ isError?: boolean; content: unknown[] }>
          >();
          const server = {
            registerTool(
              name: string,
              _config: unknown,
              handler: (
                args: Record<string, unknown>,
              ) => Promise<{ isError?: boolean; content: unknown[] }>,
            ) {
              toolHandlers.set(name, handler);
            },
          };
          const client = new TaskDeskClient({
            baseUrl: "http://localhost:1337",
            auth: {
              usingApiKey: true,
              getAccessToken: async () => key.key,
            } as never,
          });
          vi.spyOn(client, "reportToolInvocation").mockResolvedValue();
          vi.stubGlobal(
            "fetch",
            async (input: string | URL, init?: RequestInit) => {
              const url = new URL(String(input));
              return app.request(`${url.pathname}${url.search}`, init);
            },
          );
          registerTools(server as never, { client });
          for (const [name, args] of [
            ["get_project", { projectId: world.project.id }],
            ["get_work_item", { key: item.key }],
            ["list_projects", { workspaceId: world.workspaceId }],
            ["search_work_items", { workspaceId: world.workspaceId }],
          ] as const) {
            const handler = toolHandlers.get(name);
            if (!handler) throw new Error(`missing MCP tool ${name}`);
            const result = await handler(args);
            expect(JSON.stringify(result)).not.toContain("Hidden B5");
            if (name.startsWith("get_")) expect(result.isError).toBe(true);
            else {
              expect(result.isError).not.toBe(true);
              expect(JSON.stringify(result)).not.toContain(world.project.id);
              expect(JSON.stringify(result)).not.toContain(item.key);
            }
          }
          vi.unstubAllGlobals();
        }
        setAmbientHeaders({});
      }
    });
  }

  it("reorder returns only reachable projects and never renumbers hidden rows", async () => {
    const world = await setupWorld();
    const { app } = createApp();
    const visible = await createProjectFixture({
      workspaceId: world.workspaceId,
      name: "Visible reorder",
    });
    const second = await createProjectFixture({
      workspaceId: world.workspaceId,
      name: "Second visible reorder",
    });
    const caller = await addMember(world.workspaceId, "member");
    await grantProjectRole(caller.user.id, visible.project.id, [
      "project:read",
      "work_item:read",
    ]);
    await grantProjectRole(caller.user.id, second.project.id, [
      "project:read",
      "work_item:read",
    ]);
    await upsertWorkspaceRoleRows(world.workspaceId, "reorderer", {
      workspace: ["read"],
      project: ["update"],
    });
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "reorderer" })
      .where(eq(schema.workspaceUserTable.userId, caller.user.id));
    await db
      .update(schema.projectTable)
      .set({ position: 4 })
      .where(eq(schema.projectTable.id, world.project.id));
    mockAuthenticatedSession(caller.user);
    const response = await json(
      app,
      "PUT",
      `/api/project/reorder?workspaceId=${world.workspaceId}`,
      {
        projects: [
          { id: second.project.id, position: 0 },
          { id: visible.project.id, position: 1 },
        ],
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const rows = (await response.json()) as Array<{ id: string }>;
    expect(rows.map((row) => row.id)).toEqual([
      second.project.id,
      visible.project.id,
    ]);
    const [hidden] = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, world.project.id));
    expect(hidden?.position).toBe(4);
    const rejected = await json(
      app,
      "PUT",
      `/api/project/reorder?workspaceId=${world.workspaceId}`,
      { projects: [{ id: world.project.id, position: 0 }] },
    );
    expect(rejected.status).toBe(404);
    const missing = await json(
      app,
      "PUT",
      `/api/project/reorder?workspaceId=${world.workspaceId}`,
      {
        projects: [{ id: "missing-project", position: 0 }],
      },
    );
    expect(missing.status).toBe(404);
    expect(await rejected.text()).toBe(await missing.text());
    const key = await makeApiKey(caller.user.id, {
      project: ["read", "update"],
      workspace: ["read"],
    });
    mockAnonymousSession();
    setAmbientHeaders({ "x-api-key": key });
    const keyed = await json(
      app,
      "PUT",
      `/api/project/reorder?workspaceId=${world.workspaceId}`,
      { projects: [{ id: visible.project.id, position: 0 }] },
    );
    expect(keyed.status, await keyed.clone().text()).toBe(200);
    expect(await keyed.text()).not.toContain(world.project.id);
  });

  it("honors an existing attachment link after project reach is revoked", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "b5-download-"));
    vi.stubEnv("TASKDESK_STORAGE_FILESYSTEM_ROOT", root);
    vi.stubEnv("TASKDESK_STORAGE_DRIVER", undefined);
    try {
      const world = await setupWorld();
      const { app } = createApp();
      const item = await createItem(app, world, "B5 private attachment");
      const caller = await addMember(world.workspaceId, "member");
      await grantProjectRole(caller.user.id, world.project.id, [
        "project:read",
        "work_item:read",
      ]);
      const objectKey = `b5/${item.id}/file.txt`;
      await putAttachmentObject(
        objectKey,
        new TextEncoder().encode("B5 private bytes"),
        "text/plain",
        100,
      );
      const [attachment] = await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: world.workspaceId,
          workItemId: item.id,
          objectKey,
          filename: "file.txt",
          mimeType: "text/plain",
          size: 16,
          state: "ready",
        })
        .returning();
      if (!attachment) throw new Error("attachment fixture missing");
      mockAuthenticatedSession(caller.user);
      const issued = await json(
        app,
        "GET",
        `/api/attachments/${attachment.id}`,
      );
      expect(issued.status).toBe(302);
      const location = issued.headers.get("location");
      if (!location) throw new Error("download location missing");
      const signed = new URL(location);
      const getBytes = () => app.request(`${signed.pathname}${signed.search}`);
      const before = await getBytes();
      expect(before.status).toBe(200);
      expect(await before.text()).toBe("B5 private bytes");
      await db
        .delete(schema.membershipTable)
        .where(
          and(
            eq(schema.membershipTable.personId, caller.personId),
            eq(schema.membershipTable.scope, "project"),
            eq(schema.membershipTable.scopeId, world.project.id),
          ),
        );
      const after = await getBytes();
      // AT-5 makes issued download links valid for five minutes; whether to
      // revoke them immediately when project reach is lost awaits an owner decision.
      expect(after.status).toBe(200);
      expect(await after.text()).toBe("B5 private bytes");
      expect(
        (await json(app, "GET", `/api/attachments/${attachment.id}`)).status,
      ).toBe(404);
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });
});
