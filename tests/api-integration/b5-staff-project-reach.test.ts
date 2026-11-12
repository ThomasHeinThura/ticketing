import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPersonalApiKey } from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import {
  automationTable,
  workItemTemplateTable,
} from "../../apps/api/src/database/schema";
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
  budgetTable,
  timeActivityTable,
  timeEntryTable,
} from "../../apps/api/src/database/schema-p5-time";
import { createApp } from "../../apps/api/src/index";
import { putAttachmentObject } from "../../apps/api/src/storage";
import * as viewRepository from "../../apps/api/src/view/repository";
import { TaskDeskClient } from "../../packages/mcp/src/taskdesk/client";
import { registerTools } from "../../packages/mcp/src/tools/register";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, grantProjectRole } from "./helpers/fixtures";
import { makeCustomField, setCustomValue } from "./helpers/p4-closeout";
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
  makeState,
  seedLegacy,
  setAmbientHeaders,
  setupWorld,
} from "./helpers/reach-world";
import { upsertWorkspaceRoleRows } from "./helpers/workspace-role-rows";

describe("B-5: staff project reach", () => {
  let mixedStorageRoot: string | undefined;
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterEach(async () => {
    setAmbientHeaders({});
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (mixedStorageRoot)
      await rm(mixedStorageRoot, { recursive: true, force: true });
    mixedStorageRoot = undefined;
  });

  for (const role of ["member", "lead", "viewer"] as const) {
    it(`${role} sees reachable data in mixed-project collections`, async () => {
      mixedStorageRoot = await mkdtemp(
        path.join(tmpdir(), "b5-review-upload-"),
      );
      vi.stubEnv("TASKDESK_STORAGE_FILESYSTEM_ROOT", mixedStorageRoot);
      vi.stubEnv("TASKDESK_STORAGE_DRIVER", undefined);
      const world = await setupWorld();
      const { app } = createApp();
      const visible = await createProjectFixture({
        workspaceId: world.workspaceId,
        name: "Visible mixed project",
      });
      const state = await makeState(
        world.workspaceId,
        visible.project.id,
        "backlog",
        true,
      );
      const automationRole = await grantProjectRole(
        world.admin.user.id,
        visible.project.id,
        [
          "project:read",
          "work_item:read",
          "work_item:update",
          "attachment:create",
          "budget:read",
        ],
      );
      const hidden = await createItem(app, world, "Mixed hidden item");
      const [allowed] = await db
        .insert(schema.workItemTable)
        .values({
          workspaceId: world.workspaceId,
          projectId: visible.project.id,
          typeId: world.type.id,
          stateId: state.state.id,
          title: "Visible mixed item",
          number: 1,
          key: "VISIBLE-1",
        })
        .returning();
      if (!allowed) throw new Error("visible item missing");
      const [allowedSecond] = await db
        .insert(schema.workItemTable)
        .values({
          workspaceId: world.workspaceId,
          projectId: visible.project.id,
          typeId: world.type.id,
          stateId: state.state.id,
          title: "Visible mixed second item",
          number: 2,
          key: "VISIBLE-2",
        })
        .returning();
      if (!allowedSecond) throw new Error("second visible item missing");
      mockAuthenticatedSession(world.admin.user);
      const createdRelation = await json(
        app,
        "POST",
        `/api/work-items/${hidden.key}/relations`,
        { targetKey: allowed.key, type: "blocks" },
      );
      expect(createdRelation.status, await createdRelation.clone().text()).toBe(
        200,
      );
      const presign = await json(
        app,
        "POST",
        `/api/work-items/${allowed.key}/attachments/presign`,
        { filename: "visible.png", contentType: "image/png", size: 12 },
      );
      expect(presign.status, await presign.clone().text()).toBe(200);
      const upload = (await presign.json()) as {
        attachmentId: string;
        uploadUrl: string;
        uploadHeaders: Record<string, string>;
      };
      const uploadResponse = await app.request(upload.uploadUrl, {
        method: "PUT",
        headers: upload.uploadHeaders,
        body: Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
        ]),
      });
      expect(uploadResponse.status).toBe(204);
      const complete = await json(
        app,
        "POST",
        `/api/attachments/${upload.attachmentId}/complete`,
      );
      expect(complete.status, await complete.clone().text()).toBe(200);
      const relationEvents = await db.select().from(schema.outboxTable);
      const visibleEvents = JSON.stringify(
        relationEvents.filter((event) =>
          JSON.stringify(event).includes(allowed.id),
        ),
      );
      expect(visibleEvents).not.toContain(hidden.id);
      expect(visibleEvents).not.toContain(hidden.key);
      const caller = await addMember(world.workspaceId, role);
      await setFeature(world.workspaceId, "feature.automations", true);
      await db.insert(automationTable).values([
        {
          workspaceId: world.workspaceId,
          projectId: visible.project.id,
          name: "Visible mixed automation",
          trigger: "work_item.created",
          effectiveRoleId: automationRole.id,
          createdBy: caller.personId,
        },
        {
          workspaceId: world.workspaceId,
          projectId: world.project.id,
          name: "Hidden mixed automation",
          trigger: "work_item.created",
          effectiveRoleId: automationRole.id,
          createdBy: caller.personId,
        },
      ]);
      await db.insert(workItemTemplateTable).values({
        workspaceId: world.workspaceId,
        typeId: world.type.id,
        name: "Workspace template",
        title: "Workspace template title",
      });
      const labelRows = await db
        .insert(schema.labelTable)
        .values([
          {
            workspaceId: world.workspaceId,
            projectId: visible.project.id,
            name: "Visible mixed label",
            color: "#111111",
          },
          {
            workspaceId: world.workspaceId,
            projectId: world.project.id,
            name: "Hidden mixed label",
            color: "#111111",
          },
        ])
        .returning();
      if (labelRows.length !== 2) throw new Error("labels missing");
      await setAgileFlags(visible.project.id, { cycles: true, modules: true });
      await setPagesFlag([visible.project.id], true);
      await setTimeFlags(world.workspaceId);
      await setFeature(world.workspaceId, "feature.cost_tracking", true);
      await setFeature(world.workspaceId, "feature.reports", true);
      await setServiceFlag(world.workspaceId, true);
      const [mixedService] = await db
        .insert(serviceTable)
        .values({ workspaceId: world.workspaceId, name: "Mixed service" })
        .returning();
      if (!mixedService) throw new Error("service missing");
      await db
        .update(schema.workItemTypeTable)
        .set({ key: "incident", isChange: true })
        .where(eq(schema.workItemTypeTable.id, world.type.id));
      for (const itemId of [allowed.id, hidden.id]) {
        await db
          .update(schema.workItemTable)
          .set({ serviceId: mixedService.id })
          .where(eq(schema.workItemTable.id, itemId));
        await db.insert(changeDetailTable).values({
          workspaceId: world.workspaceId,
          workItemId: itemId,
          windowStart: new Date("2030-01-10T09:00:00Z"),
          windowEnd: new Date("2030-01-10T10:00:00Z"),
        });
      }
      const [activity] = await db
        .insert(timeActivityTable)
        .values({ workspaceId: world.workspaceId, name: "Mixed activity" })
        .returning();
      if (!activity) throw new Error("activity missing");
      let visibleCycleId = "";
      let visibleModuleId = "";
      let hiddenAttachmentId = "";
      for (const [projectId, itemId, name] of [
        [visible.project.id, allowed.id, "Visible mixed"],
        [world.project.id, hidden.id, "Hidden mixed"],
      ] as const) {
        await db.insert(budgetTable).values({
          workspaceId: world.workspaceId,
          projectId,
          name: `${name} budget`,
          plannedAmountMinor: 10000,
          currency: "USD",
          periodStart: "2026-01-01",
          periodEnd: "2026-12-31",
        });
        await db.insert(schema.projectContractTable).values({
          projectId,
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          contractedMinutes: 900,
          coverage: "9x5",
        });
        await db.insert(timeEntryTable).values({
          workspaceId: world.workspaceId,
          projectId,
          workItemId: itemId,
          personId: caller.personId,
          date: "2026-11-01",
          minutes: 37,
          activityId: activity.id,
          billable: true,
          description: `${name} time`,
        });
        await db.insert(projectPageTable).values({
          workspaceId: world.workspaceId,
          projectId,
          title: `${name} page`,
          body: { type: "doc", content: [] },
        });
        const [cycleRow] = await db
          .insert(cycleTable)
          .values({
            workspaceId: world.workspaceId,
            projectId,
            name: `${name} cycle`,
            startDate: "2030-01-01",
            endDate: "2030-01-31",
          })
          .returning();
        const [moduleRow] = await db
          .insert(moduleTable)
          .values({
            workspaceId: world.workspaceId,
            projectId,
            name: `${name} module`,
          })
          .returning();
        if (projectId === visible.project.id) {
          visibleCycleId = cycleRow?.id ?? "";
          visibleModuleId = moduleRow?.id ?? "";
        }
        await db.insert(schema.milestoneTable).values({
          projectId,
          name: `${name} milestone`,
          date: new Date("2030-01-01"),
        });
        await db.insert(schema.documentLinkTable).values({
          projectId,
          title: `${name} document`,
          url: "https://example.invalid/document",
        });
        const [attachmentRow] = await db
          .insert(schema.attachmentTable)
          .values({
            workspaceId: world.workspaceId,
            workItemId: itemId,
            objectKey: `mixed/${itemId}`,
            filename: `${name}.pdf`,
            mimeType: "application/pdf",
            size: 12,
            state: "ready",
          })
          .returning();
        if (projectId === world.project.id)
          hiddenAttachmentId = attachmentRow?.id ?? "";
        await db.insert(schema.notificationTable).values({
          userId: caller.user.id,
          personId: caller.personId,
          type: "work_item_transitioned",
          kind: "work_item.transitioned",
          resourceType: "work_item",
          resourceId: itemId,
          eventData: { kind: "work_item.transitioned" },
          title: `${name} notification`,
          body: name,
          isRead: false,
        });
      }
      await db.insert(schema.notificationTable).values({
        userId: caller.user.id,
        personId: caller.personId,
        type: "work_item_transitioned",
        kind: "work_item.transitioned",
        resourceType: "work_item",
        resourceId: allowedSecond.id,
        eventData: { kind: "work_item.transitioned" },
        title: "Visible mixed second notification",
        body: "Visible mixed",
        isRead: false,
      });
      const [mixedView] = await db
        .insert(schema.savedViewTable)
        .values({
          workspaceId: world.workspaceId,
          createdBy: caller.personId,
          name: "Mixed workspace view",
          scope: "workspace",
          scopeId: world.workspaceId,
          visibility: "workspace",
          layout: "list",
          query: { entity: "work_item" },
        })
        .returning();
      if (!mixedView) throw new Error("view missing");
      const [hiddenFilterView] = await db
        .insert(schema.savedViewTable)
        .values({
          workspaceId: world.workspaceId,
          createdBy: caller.personId,
          name: "Hidden filter view",
          scope: "workspace",
          scopeId: world.workspaceId,
          visibility: "workspace",
          layout: "list",
          query: {
            entity: "work_item",
            filter: { field: "project", op: "eq", value: world.project.slug },
          },
        })
        .returning();
      if (!hiddenFilterView) throw new Error("hidden filter view missing");
      const department = await makeCustomField(
        world.workspaceId,
        world.type.id,
        { key: "department", format: "text" },
      );
      await setCustomValue(
        world.workspaceId,
        department.id,
        { id: allowed.id, projectId: visible.project.id },
        world.project.slug,
      );
      const [collisionView] = await db
        .insert(schema.savedViewTable)
        .values({
          workspaceId: world.workspaceId,
          createdBy: caller.personId,
          name: "Department collision",
          scope: "workspace",
          scopeId: world.workspaceId,
          visibility: "workspace",
          layout: "list",
          query: {
            entity: "work_item",
            filter: {
              field: "cf.department",
              op: "eq",
              value: world.project.slug,
            },
          },
        })
        .returning();
      if (!collisionView) throw new Error("collision view missing");
      const [arrayView] = await db
        .insert(schema.savedViewTable)
        .values({
          workspaceId: world.workspaceId,
          createdBy: caller.personId,
          name: "Nested project array",
          scope: "workspace",
          scopeId: world.workspaceId,
          visibility: "workspace",
          layout: "list",
          query: {
            entity: "work_item",
            filter: {
              and: [
                {
                  field: "project",
                  op: "in",
                  value: [visible.project.slug, world.project.slug],
                },
              ],
            },
          },
        })
        .returning();
      if (!arrayView) throw new Error("array view missing");
      const [mixedDashboard] = await db
        .insert(dashboardTable)
        .values({
          workspaceId: world.workspaceId,
          name: "Mixed dashboard",
          scope: "workspace",
        })
        .returning();
      if (!mixedDashboard) throw new Error("dashboard missing");
      const [allowedWidget, hiddenWidget, hiddenViewWidget, collisionWidget] =
        await db
          .insert(dashboardWidgetTable)
          .values([
            {
              dashboardId: mixedDashboard.id,
              reportKey: "work_mix",
              filters: { projectId: visible.project.id },
            },
            {
              dashboardId: mixedDashboard.id,
              reportKey: "work_mix",
              filters: { projectId: world.project.id },
              x: 6,
            },
            {
              dashboardId: mixedDashboard.id,
              savedViewId: hiddenFilterView.id,
              y: 4,
            },
            {
              dashboardId: mixedDashboard.id,
              savedViewId: collisionView.id,
              x: 6,
              y: 4,
            },
          ])
          .returning();
      if (
        !allowedWidget ||
        !hiddenWidget ||
        !hiddenViewWidget ||
        !collisionWidget
      )
        throw new Error("widgets missing");
      mockAuthenticatedSession(world.admin.user);
      expect(
        (await json(app, "GET", `/api/views/${hiddenFilterView.id}`)).status,
      ).toBe(200);
      const ownerViewSearch = await json(
        app,
        "GET",
        `/api/search?workspaceId=${world.workspaceId}&q=Hidden%20filter&type=views`,
      );
      expect(
        ((await ownerViewSearch.json()) as { totalCount: number }).totalCount,
      ).toBe(1);
      if (role !== "lead")
        await grantProjectRole(caller.user.id, visible.project.id, [
          "project:read",
          "work_item:read",
          ...(role === "member" ? ["work_item:update" as const] : []),
        ]);
      mockAuthenticatedSession(caller.user);
      const sidebar = await json(
        app,
        "GET",
        `/api/project?workspaceId=${world.workspaceId}`,
      );
      expect(sidebar.status).toBe(200);
      const sidebarRows = (await sidebar.json()) as Array<{
        id: string;
        statistics: { totalTasks: number };
      }>;
      expect(sidebarRows.map((row) => row.id)).toEqual(
        role === "lead" ? [] : [visible.project.id],
      );
      if (role !== "lead")
        expect(sidebarRows[0]?.statistics.totalTasks).toBe(2);
      const labels = await json(
        app,
        "GET",
        `/api/label/workspace/${world.workspaceId}`,
      );
      expect(labels.status).toBe(200);
      const labelsText = await labels.text();
      expect(labelsText).not.toContain("Hidden mixed label");
      expect(labelsText).not.toContain("Visible mixed label");
      const hiddenCatalogue = await json(
        app,
        "GET",
        `/api/label/project/${world.project.id}/catalogue`,
      );
      expect(hiddenCatalogue.status).toBe(404);
      const allowedCatalogue = await json(
        app,
        "GET",
        `/api/label/project/${visible.project.id}/catalogue`,
      );
      expect(allowedCatalogue.status).toBe(role === "lead" ? 404 : 200);
      if (role !== "lead")
        expect(await allowedCatalogue.text()).toContain("Visible mixed label");
      expect(
        (
          await json(
            app,
            "GET",
            `/api/projects/${world.project.slug}/automations`,
          )
        ).status,
      ).toBe(404);
      const deniedAutomation = await json(
        app,
        "POST",
        `/api/projects/${world.project.slug}/automations`,
        {
          name: "Denied",
          trigger: "work_item.created",
          conditions: [],
          actions: [{ type: "set_priority", priority: "high" }],
          effectiveRoleId: automationRole.id,
        },
      );
      expect(deniedAutomation.status).toBe(404);
      expect(
        (
          await json(
            app,
            "POST",
            `/api/attachments/${hiddenAttachmentId}/complete`,
          )
        ).status,
      ).toBe(404);
      const allowedAutomations = await json(
        app,
        "GET",
        `/api/projects/${visible.project.slug}/automations`,
      );
      expect(allowedAutomations.status).toBe(role === "lead" ? 404 : 200);
      if (role !== "lead") {
        const automationText = await allowedAutomations.text();
        expect(automationText).toContain("Visible mixed automation");
        expect(automationText).not.toContain("Hidden mixed automation");
      }
      const templates = await json(
        app,
        "GET",
        `/api/workspace/${world.workspaceId}/work-item-templates`,
      );
      expect(templates.status).toBe(200);
      expect(await templates.text()).toContain("Workspace template");
      const relation = await json(
        app,
        "GET",
        `/api/work-items/${allowed.key}/relations`,
      );
      if (role === "lead") expect(relation.status).toBe(404);
      else {
        expect(relation.status).toBe(200);
        // RH-4 intentionally exposes the hidden peer count; the owner decision is pending.
        expect(await relation.json()).toEqual({ data: [], hiddenCount: 1 });
      }
      const search = await json(app, "POST", "/api/work-items/search", {
        workspaceId: world.workspaceId,
        query: { entity: "work_item" },
      });
      expect(search.status).toBe(200);
      const searchBody = (await search.json()) as {
        data: unknown[];
        meta: { total: number };
      };
      expect(searchBody.meta.total).toBe(role === "lead" ? 0 : 2);
      expect(JSON.stringify(searchBody)).not.toContain(hidden.key);
      expect(JSON.stringify(searchBody)).not.toContain(hidden.id);
      expect(JSON.stringify(searchBody)).not.toContain(world.project.id);
      expect(JSON.stringify(searchBody)).not.toContain("Mixed hidden item");
      expect(JSON.stringify(searchBody).includes(allowed.key)).toBe(
        role !== "lead",
      );
      if (role !== "lead") {
        const row = (
          searchBody.data as Array<{ key: string; blockedByOpenCount?: number }>
        ).find((item) => item.key === allowed.key);
        // RH-17 currently counts the hidden open blocker; its disclosure needs an owner decision.
        expect(row?.blockedByOpenCount).toBe(1);
      }
      const count = await json(app, "GET", `/api/views/${mixedView.id}/count`);
      expect(count.status).toBe(200);
      expect(await count.json()).toEqual({ count: role === "lead" ? 0 : 2 });
      const viewRun = await json(
        app,
        "POST",
        `/api/views/${mixedView.id}/run?limit=1`,
      );
      expect(viewRun.status).toBe(200);
      const viewText = await viewRun.text();
      expect(viewText).not.toContain(hidden.key);
      expect(
        (JSON.parse(viewText) as { meta: { total: number }; data: unknown[] })
          .meta.total,
      ).toBe(role === "lead" ? 0 : 2);
      expect((JSON.parse(viewText) as { data: unknown[] }).data).toHaveLength(
        role === "lead" ? 0 : 1,
      );
      const views = await json(
        app,
        "GET",
        `/api/views?workspaceId=${world.workspaceId}`,
      );
      expect(views.status).toBe(200);
      const viewsText = await views.text();
      expect(viewsText).not.toContain(world.project.id);
      expect(viewsText).not.toContain(hiddenFilterView.id);
      expect(viewsText).toContain(collisionView.id);
      const hiddenFilteredView = await json(
        app,
        "GET",
        `/api/views/${hiddenFilterView.id}`,
      );
      expect(hiddenFilteredView.status).toBe(404);
      expect(
        (await json(app, "GET", `/api/views/${arrayView.id}`)).status,
      ).toBe(404);
      const arraySearch = await json(
        app,
        "GET",
        `/api/search?workspaceId=${world.workspaceId}&q=Nested%20project%20array&type=views`,
      );
      expect(
        ((await arraySearch.json()) as { totalCount: number }).totalCount,
      ).toBe(0);
      expect(
        (await json(app, "GET", `/api/views/${collisionView.id}`)).status,
      ).toBe(200);
      const collisionCount = await json(
        app,
        "GET",
        `/api/views/${collisionView.id}/count`,
      );
      expect(collisionCount.status, await collisionCount.clone().text()).toBe(
        200,
      );
      expect(await collisionCount.json()).toEqual({
        count: role === "lead" ? 0 : 1,
      });
      const collisionRun = await json(
        app,
        "POST",
        `/api/views/${collisionView.id}/run`,
      );
      expect(collisionRun.status, await collisionRun.clone().text()).toBe(200);
      expect(
        ((await collisionRun.json()) as { meta: { total: number } }).meta.total,
      ).toBe(role === "lead" ? 0 : 1);
      const collisionSearch = await json(
        app,
        "GET",
        `/api/search?workspaceId=${world.workspaceId}&q=Department%20collision&type=views`,
      );
      expect(collisionSearch.status).toBe(200);
      expect(
        ((await collisionSearch.json()) as { totalCount: number }).totalCount,
      ).toBe(1);
      for (const [method, suffix] of [
        ["GET", "count"],
        ["POST", "run"],
        ["POST", "pin"],
      ] as const) {
        expect(
          (
            await json(
              app,
              method,
              `/api/views/${hiddenFilterView.id}/${suffix}`,
            )
          ).status,
        ).toBe(404);
      }
      const hiddenViewSearch = await json(
        app,
        "GET",
        `/api/search?workspaceId=${world.workspaceId}&q=Hidden%20filter&type=views`,
      );
      expect(hiddenViewSearch.status).toBe(200);
      expect(
        ((await hiddenViewSearch.json()) as { totalCount: number }).totalCount,
      ).toBe(0);
      const dashboards = await json(
        app,
        "GET",
        `/api/dashboards?workspaceId=${world.workspaceId}`,
      );
      expect(dashboards.status).toBe(200);
      const dashboardRows = (await dashboards.json()) as {
        data: Array<{ id: string; widgetCount: number }>;
      };
      expect(
        dashboardRows.data.find((row) => row.id === mixedDashboard.id)
          ?.widgetCount,
      ).toBe(role === "lead" ? 1 : 2);
      const dashboard = await json(
        app,
        "GET",
        `/api/dashboards/${mixedDashboard.id}`,
      );
      expect(dashboard.status).toBe(200);
      const dashboardText = await dashboard.text();
      expect(dashboardText).not.toContain(hiddenWidget.id);
      expect(dashboardText).not.toContain(hiddenViewWidget.id);
      expect(dashboardText).toContain(collisionWidget.id);
      expect(dashboardText.includes(allowedWidget.id)).toBe(role !== "lead");
      const widgetExport = await json(
        app,
        "POST",
        `/api/dashboards/${mixedDashboard.id}/widgets/${hiddenWidget.id}/export`,
      );
      expect(widgetExport.status).toBe(role === "lead" ? 404 : 403);
      const hiddenViewData = await json(
        app,
        "GET",
        `/api/dashboards/${mixedDashboard.id}/widgets/${hiddenViewWidget.id}/data`,
      );
      expect(hiddenViewData.status).toBe(404);
      const palette = await json(
        app,
        "GET",
        `/api/search?workspaceId=${world.workspaceId}&q=mixed&type=all&limit=20`,
      );
      expect(palette.status).toBe(200);
      const paletteText = await palette.text();
      expect(paletteText).not.toContain(hidden.key);
      expect(paletteText.includes(allowed.key)).toBe(role !== "lead");
      const changeCalendar = await json(
        app,
        "GET",
        `/api/changes/calendar?workspaceId=${world.workspaceId}&from=2030-01-01T00%3A00%3A00Z&to=2030-02-01T00%3A00%3A00Z`,
      );
      expect(changeCalendar.status).toBe(200);
      const calendarText = await changeCalendar.text();
      expect(calendarText).not.toContain(hidden.key);
      expect(calendarText.includes(allowed.key)).toBe(role !== "lead");
      const services = await json(
        app,
        "GET",
        `/api/services?workspaceId=${world.workspaceId}`,
      );
      expect(services.status).toBe(200);
      const serviceBody = (await services.json()) as {
        data: Array<{
          id: string;
          incidentCount: number;
          openChangeCount: number;
        }>;
      };
      expect(
        serviceBody.data.find((entry) => entry.id === mixedService.id),
      ).toMatchObject({
        incidentCount: role === "lead" ? 0 : 1,
        openChangeCount: role === "lead" ? 0 : 1,
      });
      const combined = await json(
        app,
        "POST",
        `/api/projects/${visible.project.id}/work-items/combined`,
        {
          limit: 1,
          query: {
            entity: "work_item",
            sort: [{ field: "position", order: "asc" }],
          },
        },
      );
      expect(combined.status).toBe(role === "lead" ? 404 : 200);
      const combinedText = await combined.text();
      expect(combinedText).not.toContain(hidden.key);
      if (role !== "lead") {
        const first = JSON.parse(combinedText) as {
          data: Array<{ key: string }>;
          meta: { total: number };
          page: { hasMore: boolean; nextCursor: string | null };
        };
        expect(first.meta.total).toBe(2);
        expect(first.page.hasMore).toBe(true);
        expect(first.page.nextCursor).toBeTruthy();
        const next = await json(
          app,
          "POST",
          `/api/projects/${visible.project.id}/work-items/combined`,
          {
            limit: 1,
            cursor: first.page.nextCursor,
            query: {
              entity: "work_item",
              sort: [{ field: "position", order: "asc" }],
            },
          },
        );
        expect(next.status).toBe(200);
        const second = (await next.json()) as {
          data: Array<{ key: string }>;
          meta: { total: number };
          page: { hasMore: boolean };
        };
        expect(second.meta.total).toBe(2);
        expect(second.page.hasMore).toBe(false);
        expect(
          [...first.data, ...second.data].map((item) => item.key).sort(),
        ).toEqual([allowed.key, allowedSecond.key].sort());
      }
      const detail = await json(
        app,
        "GET",
        `/api/project/${visible.project.id}`,
      );
      expect(detail.status).toBe(role === "lead" ? 404 : 200);
      const itemDetail = await json(
        app,
        "GET",
        `/api/work-items/${allowed.key}`,
      );
      expect(itemDetail.status).toBe(role === "lead" ? 404 : 200);
      const candidates = await json(
        app,
        "GET",
        `/api/work-items/${allowed.key}/relation-candidates?q=Visible`,
      );
      expect(candidates.status).toBe(
        role === "lead" ? 404 : role === "viewer" ? 403 : 200,
      );
      const candidateText = await candidates.text();
      expect(candidateText).not.toContain(hidden.key);
      expect(candidateText.includes(allowedSecond.key)).toBe(role === "member");
      for (const suffix of [
        "children",
        "tree",
        "labels",
        "activity",
        "relations",
        "relation-candidates?q=Mixed",
        "comments/mention-candidates?q=Mixed",
        "sla",
      ]) {
        const denied = await json(
          app,
          "GET",
          `/api/work-items/${hidden.key}/${suffix}`,
        );
        expect(denied.status, suffix).toBe(404);
      }
      for (const suffix of ["children", "tree", "labels", "activity"]) {
        const allowedRead = await json(
          app,
          "GET",
          `/api/work-items/${allowed.key}/${suffix}`,
        );
        expect(allowedRead.status, suffix).toBe(role === "lead" ? 404 : 200);
        const allowedText = await allowedRead.text();
        expect(allowedText).not.toContain(hidden.key);
        expect(allowedText).not.toContain(hidden.id);
        expect(allowedText).not.toContain("Mixed hidden item");
      }
      for (const [suffix, payload] of [
        ["watch", undefined],
        [
          "attachments/presign",
          { filename: "test.png", contentType: "image/png", size: 10 },
        ],
      ] as const) {
        const denied = await json(
          app,
          "POST",
          `/api/work-items/${hidden.key}/${suffix}`,
          payload,
        );
        expect(denied.status, suffix).toBe(404);
      }
      const hiddenBeforeMutations = await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, hidden.id));
      for (const [path, body, headers] of [
        [`/api/work-items/${hidden.key}/rank`, { beforeId: allowed.id }, {}],
        [
          `/api/work-items/${hidden.key}/parent`,
          { parentKey: allowed.key },
          { "if-match": '"1"' },
        ],
        [
          `/api/v2/work-items/${hidden.key}/move`,
          { targetProjectId: visible.project.id, moveChildren: false },
          { "if-match": '"1"' },
        ],
      ] as const) {
        expect(
          (await json(app, "POST", path, body, headers)).status,
          path,
        ).toBe(404);
      }
      expect(
        await db
          .select()
          .from(schema.workItemTable)
          .where(eq(schema.workItemTable.id, hidden.id)),
      ).toEqual(hiddenBeforeMutations);
      const allowedBeforeMove = await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, allowed.id));
      const move = await json(
        app,
        "POST",
        `/api/v2/work-items/${allowed.key}/move`,
        { targetProjectId: world.project.id, moveChildren: false },
        { "if-match": '"1"' },
      );
      expect([403, 404]).toContain(move.status);
      expect(
        await db
          .select()
          .from(schema.workItemTable)
          .where(eq(schema.workItemTable.id, allowed.id)),
      ).toEqual(allowedBeforeMove);
      for (const path of [
        `/api/projects/${visible.project.id}/work-items`,
        `/api/projects/${visible.project.id}/work-items/combined`,
        `/api/projects/${visible.project.id}/pages`,
        `/api/project/${visible.project.id}/document-links`,
        `/api/project/${visible.project.id}/milestones`,
        `/api/projects/${visible.project.slug}/cycles`,
        `/api/projects/${visible.project.slug}/modules`,
        `/api/work-items/${allowed.key}/attachments`,
      ]) {
        const response = await json(app, "GET", path);
        expect(response.status, path).toBe(role === "lead" ? 404 : 200);
        const text = await response.text();
        expect(text).not.toContain("Hidden mixed");
        if (role !== "lead") expect(text, path).toContain("Visible mixed");
      }
      const inbox = await json(app, "GET", "/api/notification/inbox");
      expect(inbox.status).toBe(200);
      const inboxBody = (await inbox.json()) as { unreadCount: number };
      expect(inboxBody.unreadCount).toBe(role === "lead" ? 0 : 2);
      expect(JSON.stringify(inboxBody)).not.toContain("Hidden mixed");
      expect(JSON.stringify(inboxBody).includes("Visible mixed")).toBe(
        role !== "lead",
      );
      const inboxPage = await json(
        app,
        "GET",
        "/api/notification/inbox?limit=1",
      );
      expect(inboxPage.status).toBe(200);
      const pageOne = (await inboxPage.json()) as {
        data: Array<{ id: string }>;
        unreadCount: number;
        hasMore: boolean;
        nextCursor: string | null;
      };
      expect(pageOne.unreadCount).toBe(role === "lead" ? 0 : 2);
      if (role !== "lead") {
        expect(pageOne.data).toHaveLength(1);
        expect(pageOne.hasMore).toBe(true);
        expect(pageOne.nextCursor).toBeTruthy();
        const pageTwoResponse = await json(
          app,
          "GET",
          `/api/notification/inbox?limit=1&cursor=${encodeURIComponent(pageOne.nextCursor as string)}`,
        );
        expect(pageTwoResponse.status).toBe(200);
        const pageTwo = (await pageTwoResponse.json()) as {
          data: Array<{ id: string }>;
          unreadCount: number;
          hasMore: boolean;
        };
        expect(pageTwo.unreadCount).toBe(2);
        expect(pageTwo.data).toHaveLength(1);
        expect(pageTwo.data[0]?.id).not.toBe(pageOne.data[0]?.id);
        expect(pageTwo.hasMore).toBe(false);
        expect(JSON.stringify(pageTwo)).not.toContain("Hidden mixed");
      }
      const entries = await json(
        app,
        "GET",
        `/api/time-entries?workspaceId=${world.workspaceId}`,
      );
      expect(entries.status).toBe(role === "viewer" ? 403 : 200);
      const entriesText = await entries.text();
      expect(entriesText).not.toContain("Hidden mixed");
      if (role === "member") expect(entriesText).toContain("Visible mixed");
      const contract = await json(
        app,
        "GET",
        `/api/project/${visible.project.id}/contract`,
      );
      expect(contract.status).toBe(role === "lead" ? 404 : 200);
      if (role !== "lead")
        expect((await contract.json()) as object).toMatchObject({
          hourBank: { usedMinutes: 37, remainingMinutes: 863 },
        });
      const summary = await json(
        app,
        "GET",
        `/api/time-entries/summary?workspaceId=${world.workspaceId}&projectId=${visible.project.id}`,
      );
      expect(summary.status).toBe(
        role === "viewer" ? 403 : role === "lead" ? 404 : 200,
      );
      if (role === "member")
        expect(await summary.json()).toMatchObject({ totalMinutes: 37 });
      expect(
        (await json(app, "GET", `/api/projects/${world.project.id}/budget`))
          .status,
      ).toBe(404);
      const timer = await json(
        app,
        "GET",
        `/api/time-entries/timer?workspaceId=${world.workspaceId}`,
      );
      expect(timer.status).toBe(role === "viewer" ? 403 : 200);
      expect(await timer.text()).not.toContain(hidden.id);
      const timerStart = await json(
        app,
        "POST",
        "/api/time-entries/timer/start",
        { workspaceId: world.workspaceId, workItemId: hidden.id },
      );
      expect(timerStart.status).toBe(role === "viewer" ? 403 : 404);
      if (role === "member") {
        const startVisible = await json(
          app,
          "POST",
          "/api/time-entries/timer/start",
          { workspaceId: world.workspaceId, workItemId: allowed.id },
        );
        expect(startVisible.status, await startVisible.clone().text()).toBe(
          200,
        );
        const activeTimer = await json(
          app,
          "GET",
          `/api/time-entries/timer?workspaceId=${world.workspaceId}`,
        );
        expect(await activeTimer.text()).toContain(allowed.id);
      }
      const exported = await json(app, "POST", "/api/work-items/export", {
        workspaceId: world.workspaceId,
        query: { entity: "work_item", columns: ["key", "title"] },
      });
      expect(exported.status).toBe(role === "lead" ? 200 : 403);
      expect(await exported.text()).not.toContain(hidden.key);
      mockAuthenticatedSession(world.admin.user);
      const ownerBudget = await json(
        app,
        "GET",
        `/api/projects/${visible.project.id}/budget`,
      );
      expect(ownerBudget.status).toBe(200);
      expect(await ownerBudget.text()).toContain("Visible mixed budget");
      const ownerExport = await json(app, "POST", "/api/work-items/export", {
        workspaceId: world.workspaceId,
        query: { entity: "work_item", columns: ["key", "title"] },
      });
      expect(ownerExport.status).toBe(200);
      const ownerCsv = await ownerExport.text();
      expect(ownerCsv).toContain(allowed.key);
      expect(ownerCsv).toContain(hidden.key);
      mockAuthenticatedSession(caller.user);
      const before = await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, hidden.id));
      const [beforeAllowed] = await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, allowed.id));
      for (const [kind, target] of [
        ["cycles", visibleCycleId],
        ["modules", visibleModuleId],
      ] as const) {
        const assignment = await json(
          app,
          "POST",
          `/api/${kind}/${target}/work-items`,
          { workItemKeys: [allowed.key, hidden.key] },
        );
        expect(assignment.status).toBe(
          role === "lead" ? 404 : role === "viewer" ? 403 : 200,
        );
        if (assignment.status === 200) {
          const payload = (await assignment.json()) as {
            added: string[];
            refused: Array<{ key: string; reason: string }>;
          };
          expect(payload.added).toEqual([allowed.key]);
          expect(payload.refused).toEqual([
            { key: hidden.key, reason: "not_found" },
          ]);
          const [updated] = await db
            .select()
            .from(schema.workItemTable)
            .where(eq(schema.workItemTable.id, allowed.id));
          expect(kind === "cycles" ? updated?.cycleId : updated?.moduleId).toBe(
            target,
          );
        } else {
          const [unchanged] = await db
            .select()
            .from(schema.workItemTable)
            .where(eq(schema.workItemTable.id, allowed.id));
          expect(unchanged).toEqual(beforeAllowed);
        }
      }
      const bulk = await json(app, "POST", "/api/work-items/bulk", {
        workspaceId: world.workspaceId,
        workItemKeys: [allowed.key, hidden.key],
        operation: "set_due_date",
        dueDate: "2030-01-01T00:00:00Z",
      });
      expect(bulk.status).toBe(role === "viewer" ? 403 : 200);
      if (bulk.status === 200) {
        const result = (await bulk.json()) as {
          succeeded: string[];
          failed: Array<{ id: string; reason: string }>;
        };
        expect(result.succeeded).toEqual(
          role === "member" ? [allowed.key] : [],
        );
        expect(result.failed).toEqual(
          role === "member"
            ? [{ id: hidden.key, reason: "Work item not found" }]
            : [
                { id: allowed.key, reason: "Work item not found" },
                { id: hidden.key, reason: "Work item not found" },
              ],
        );
        const [updated] = await db
          .select()
          .from(schema.workItemTable)
          .where(eq(schema.workItemTable.id, allowed.id));
        expect(updated?.dueDate?.toISOString() ?? null).toBe(
          role === "member" ? "2030-01-01T00:00:00.000Z" : null,
        );
      }
      if (role === "viewer") {
        const [unchanged] = await db
          .select()
          .from(schema.workItemTable)
          .where(eq(schema.workItemTable.id, allowed.id));
        expect(unchanged).toEqual(beforeAllowed);
      }
      expect(
        await db
          .select()
          .from(schema.workItemTable)
          .where(eq(schema.workItemTable.id, hidden.id)),
      ).toEqual(before);
      const personalKey = await createPersonalApiKey(
        { userId: caller.user.id },
        {
          name: "mixed reach",
          isMcp: false,
          capabilities: [
            "workspace:read",
            "project:read",
            "work_item:read",
            "saved_view:read",
          ],
        },
      );
      mockAnonymousSession();
      setAmbientHeaders({ "x-api-key": personalKey.key });
      const keyedA = await json(app, "GET", `/api/work-items/${allowed.key}`);
      expect(keyedA.status).toBe(role === "lead" ? 404 : 200);
      expect(
        (await json(app, "GET", `/api/work-items/${hidden.key}`)).status,
      ).toBe(404);
      const keyedViews = await json(
        app,
        "GET",
        `/api/views?workspaceId=${world.workspaceId}`,
      );
      expect(keyedViews.status).toBe(200);
      const keyedText = await keyedViews.text();
      expect(keyedText).toContain(mixedView.id);
      expect(keyedText).not.toContain(hiddenFilterView.id);
      await db
        .insert(schema.instanceFeatureFlagTable)
        .values({ featureKey: "feature.mcp", enabled: true })
        .onConflictDoUpdate({
          target: schema.instanceFeatureFlagTable.featureKey,
          set: { enabled: true },
        });
      const mcpKey = await createPersonalApiKey(
        { userId: caller.user.id },
        {
          name: "mixed mcp",
          isMcp: true,
          capabilities: ["workspace:read", "project:read", "work_item:read"],
        },
      );
      const handlers = new Map<
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
          handlers.set(name, handler);
        },
      };
      const client = new TaskDeskClient({
        baseUrl: "http://localhost:1337",
        auth: {
          usingApiKey: true,
          getAccessToken: async () => mcpKey.key,
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
      const mcpItem = handlers.get("get_work_item");
      const mcpSearch = handlers.get("search_work_items");
      if (!mcpItem || !mcpSearch) throw new Error("MCP handlers missing");
      expect((await mcpItem({ key: hidden.key })).isError).toBe(true);
      expect((await mcpItem({ key: allowed.key })).isError === true).toBe(
        role === "lead",
      );
      const mcpResults = await mcpSearch({ workspaceId: world.workspaceId });
      expect(JSON.stringify(mcpResults)).not.toContain(hidden.key);
      expect(JSON.stringify(mcpResults).includes(allowed.key)).toBe(
        role !== "lead",
      );
      vi.unstubAllGlobals();
      setAmbientHeaders({});
      mockAuthenticatedSession(caller.user);
      if (role !== "lead") {
        const recentUrl = `/api/search?workspaceId=${world.workspaceId}&q=${encodeURIComponent(allowed.key)}&type=work_items&limit=50`;
        const reachableRecent = await json(app, "GET", recentUrl);
        expect(
          JSON.stringify(
            ((await reachableRecent.json()) as { results: unknown[] }).results,
          ),
        ).toContain(allowed.key);
        await db
          .delete(schema.membershipTable)
          .where(
            and(
              eq(schema.membershipTable.personId, caller.personId),
              eq(schema.membershipTable.scope, "project"),
              eq(schema.membershipTable.scopeId, visible.project.id),
            ),
          );
        const revokedRecent = await json(app, "GET", recentUrl);
        expect(revokedRecent.status).toBe(200);
        expect(
          ((await revokedRecent.json()) as { results: unknown[] }).results,
        ).toEqual([]);
      }
    });
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

  it("rechecks the materialized view after concurrent query changes for read and edit", async () => {
    const world = await setupWorld();
    const { app } = createApp();
    const caller = await addMember(world.workspaceId, "member");
    const [saved] = await db
      .insert(schema.savedViewTable)
      .values({
        workspaceId: world.workspaceId,
        createdBy: caller.personId,
        name: "Race view",
        scope: "workspace",
        scopeId: world.workspaceId,
        visibility: "private",
        layout: "list",
        query: { entity: "work_item" },
      })
      .returning();
    if (!saved) throw new Error("view missing");
    await db
      .insert(schema.sessionTable)
      .values({
        id: `session-${caller.user.id}`,
        userId: caller.user.id,
        token: `race-${caller.user.id}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .onConflictDoNothing();
    const hiddenQuery = {
      entity: "work_item",
      filter: { field: "project", op: "eq", value: world.project.slug },
    };
    mockAuthenticatedSession(caller.user);
    const original = viewRepository.findSavedViewById;
    for (const method of ["GET", "PATCH", "DELETE"] as const) {
      await db
        .update(schema.savedViewTable)
        .set({ query: { entity: "work_item" }, name: "Race view" })
        .where(eq(schema.savedViewTable.id, saved.id));
      let changed = false;
      const spy = vi
        .spyOn(viewRepository, "findSavedViewById")
        .mockImplementation(async (id) => {
          const row = await original(id);
          if (!changed && id === saved.id) {
            changed = true;
            await db
              .update(schema.savedViewTable)
              .set({ query: hiddenQuery })
              .where(eq(schema.savedViewTable.id, saved.id));
          }
          return row;
        });
      const response = await json(
        app,
        method,
        `/api/views/${saved.id}`,
        method === "PATCH" ? { name: "Should not be saved" } : undefined,
      );
      expect(changed).toBe(true);
      expect(
        response.status,
        `${method}: ${await response.clone().text()}`,
      ).toBe(404);
      expect(await response.text()).not.toContain(world.project.slug);
      spy.mockRestore();
      const [persisted] = await db
        .select()
        .from(schema.savedViewTable)
        .where(eq(schema.savedViewTable.id, saved.id));
      expect(persisted?.name).toBe("Race view");
      expect(persisted?.query).toEqual(hiddenQuery);
      if (method === "DELETE")
        expect(await db.select().from(schema.pendingActionTable)).toHaveLength(
          0,
        );
    }
    await db
      .update(schema.savedViewTable)
      .set({ query: { entity: "work_item" } })
      .where(eq(schema.savedViewTable.id, saved.id));
    const inject = await json(app, "PATCH", `/api/views/${saved.id}`, {
      query: hiddenQuery,
    });
    expect(inject.status).toBe(404);
    const [unchanged] = await db
      .select()
      .from(schema.savedViewTable)
      .where(eq(schema.savedViewTable.id, saved.id));
    expect(unchanged?.query).toEqual({ entity: "work_item" });
  });

  it("rechecks project membership after saved-view admission", async () => {
    const world = await setupWorld();
    const { app } = createApp();
    const caller = await addMember(world.workspaceId, "member");
    const [saved] = await db
      .insert(schema.savedViewTable)
      .values({
        workspaceId: world.workspaceId,
        createdBy: caller.personId,
        name: "Membership race",
        scope: "workspace",
        scopeId: world.workspaceId,
        visibility: "private",
        layout: "list",
        query: {
          entity: "work_item",
          filter: { field: "project", op: "eq", value: world.project.slug },
        },
      })
      .returning();
    if (!saved) throw new Error("view missing");
    mockAuthenticatedSession(caller.user);
    const original = viewRepository.findSavedViewById;
    for (const method of ["GET", "PATCH"] as const) {
      await grantProjectRole(caller.user.id, world.project.id, [
        "project:read",
        "work_item:read",
      ]);
      let calls = 0;
      const spy = vi
        .spyOn(viewRepository, "findSavedViewById")
        .mockImplementation(async (id) => {
          const row = await original(id);
          if (id === saved.id && ++calls === 2)
            await db
              .delete(schema.membershipTable)
              .where(
                and(
                  eq(schema.membershipTable.personId, caller.personId),
                  eq(schema.membershipTable.scope, "project"),
                  eq(schema.membershipTable.scopeId, world.project.id),
                ),
              );
          return row;
        });
      const response = await json(
        app,
        method,
        `/api/views/${saved.id}`,
        method === "PATCH" ? { name: "Forbidden change" } : undefined,
      );
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(world.project.slug);
      spy.mockRestore();
      const [current] = await db
        .select()
        .from(schema.savedViewTable)
        .where(eq(schema.savedViewTable.id, saved.id));
      expect(current?.name).toBe("Membership race");
    }
  });

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
