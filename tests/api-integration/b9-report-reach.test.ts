import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  dashboardTable,
  dashboardWidgetTable,
  reportExportChunkTable,
  reportExportTable,
} from "../../apps/api/src/database/schema-p5-reports";
import {
  timeActivityTable,
  timeEntryTable,
} from "../../apps/api/src/database/schema-p5-time";
import { createApp } from "../../apps/api/src/index";
import { resolveRequestIdentity } from "../../apps/api/src/permissions/resolve-request-identity";
import { reachPredicate, selectRows } from "../../apps/api/src/report/context";
import { processExport } from "../../apps/api/src/report/export.service";
import { writeWorkspaceDays } from "../../apps/api/src/report/snapshot.repository";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, grantProjectRole } from "./helpers/fixtures";
import { makeTeam } from "./helpers/p4-closeout";
import { setFeature } from "./helpers/p5-reports";
import { setTimeFlags } from "./helpers/p5-time";
import {
  addCanonicalMember,
  addMember,
  createItem,
  json,
  makeState,
  setAmbientHeaders,
  setupWorld,
} from "./helpers/reach-world";

/** Decode CSV including quoted commas, quotes and embedded newlines. */
function csvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\r" || char === "\n") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (quoted) throw new Error("unterminated CSV field");
  return rows;
}

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
      if (role === "member" || role === "viewer" || role === "admin")
        await grantProjectRole(caller.user.id, projectA.project.id, [
          "project:read",
          "work_item:read",
        ]);
      if (role === "admin")
        await grantProjectRole(caller.user.id, world.project.id, [
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
      if (role === "admin")
        expect(allowed).toEqual(
          new Set([projectA.project.id, world.project.id]),
        );
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
      const widgetCsvText = await widgetExport.text();
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
        rows: Array<Record<string, string | number | null>>;
        columns: Array<{ key: string; label: string }>;
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
      const fixedCsvText = await csv.text();
      for (const text of [fixedCsvText, widgetCsvText]) {
        const records = csvRecords(text).filter(
          (record) => !record[0]?.startsWith("#"),
        );
        expect(records[0]).toEqual(
          parsed.columns.map((column) => column.label),
        );
        expect(records.slice(1)).toEqual(
          parsed.rows.map((row) =>
            parsed.columns.map((column) => String(row[column.key] ?? "")),
          ),
        );
        expect(
          records.slice(1).reduce((sum, row) => sum + Number(row[1]), 0),
        ).toBe(allowed.size);
        if (!allowed.has(world.project.id)) {
          for (const secret of [
            world.project.id,
            world.project.name,
            hidden.key,
            "B9 Secret B",
          ])
            expect(text).not.toContain(secret);
        }
      }
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
  for (const role of ["member", "lead", "viewer", "admin"] as const) {
    it(`${role} shared saved charts and people reports follow project reach`, async () => {
      const world = await setupWorld();
      const { app } = createApp();
      const visibleProject = await createProjectFixture({
        workspaceId: world.workspaceId,
        name: "B9 Alpha project",
      });
      await db
        .update(schema.projectTable)
        .set({ name: "B9 Secret project" })
        .where(eq(schema.projectTable.id, world.project.id));
      const hiddenItem = await createItem(app, world, "B9 Secret item");
      const state = await makeState(
        world.workspaceId,
        visibleProject.project.id,
        "backlog",
        true,
      );
      const alice = await addMember(world.workspaceId, "member");
      const bob = await addMember(world.workspaceId, "member");
      for (const [person, label] of [
        [alice, "B9 Alice visible"],
        [bob, "B9 Bob secret"],
      ] as const) {
        await db
          .update(schema.userTable)
          .set({ name: label })
          .where(eq(schema.userTable.id, person.user.id));
        await db
          .update(schema.personTable)
          .set({ displayName: label })
          .where(eq(schema.personTable.id, person.personId));
      }
      const [visibleItem] = await db
        .insert(schema.workItemTable)
        .values({
          workspaceId: world.workspaceId,
          projectId: visibleProject.project.id,
          stateId: state.state.id,
          typeId: world.type.id,
          title: "B9 Alpha item",
          number: 33,
          key: "B9-ALPHA-33",
          assigneeId: alice.personId,
        })
        .returning();
      if (!visibleItem) throw new Error("visible item missing");
      await db
        .update(schema.workItemTable)
        .set({ assigneeId: bob.personId })
        .where(eq(schema.workItemTable.id, hiddenItem.id));
      const teamA = await makeTeam(world.workspaceId, [alice.user.id]);
      const teamB = await makeTeam(world.workspaceId, [
        alice.user.id,
        bob.user.id,
      ]);
      await db
        .update(schema.teamTable)
        .set({ name: "B9 Alpha team", capacityDaysPerWeek: "1" })
        .where(eq(schema.teamTable.id, teamA.id));
      await db
        .update(schema.teamTable)
        .set({ name: "B9 Secret team", capacityDaysPerWeek: "5" })
        .where(eq(schema.teamTable.id, teamB.id));
      await db
        .update(schema.projectTable)
        .set({ ownerTeamId: teamA.id })
        .where(eq(schema.projectTable.id, visibleProject.project.id));
      await db
        .update(schema.projectTable)
        .set({ ownerTeamId: teamB.id })
        .where(eq(schema.projectTable.id, world.project.id));
      await setFeature(world.workspaceId, "feature.reports", true);
      await setTimeFlags(world.workspaceId);
      const [activity] = await db
        .insert(timeActivityTable)
        .values({ workspaceId: world.workspaceId, name: "B9 activity" })
        .returning();
      if (!activity) throw new Error("activity missing");
      await db.insert(timeEntryTable).values([
        {
          workspaceId: world.workspaceId,
          projectId: visibleProject.project.id,
          workItemId: visibleItem.id,
          personId: alice.personId,
          date: "2026-01-06",
          minutes: 60,
          activityId: activity.id,
          billable: false,
        },
        {
          workspaceId: world.workspaceId,
          projectId: world.project.id,
          workItemId: hiddenItem.id,
          personId: bob.personId,
          date: "2026-01-06",
          minutes: 420,
          activityId: activity.id,
          billable: false,
        },
      ]);
      const caller =
        role === "lead"
          ? await addCanonicalMember(world.workspaceId, role)
          : await addMember(world.workspaceId, role);
      if (role !== "lead")
        await grantProjectRole(caller.user.id, visibleProject.project.id, [
          "project:read",
          "work_item:read",
        ]);
      if (role === "admin")
        await grantProjectRole(caller.user.id, world.project.id, [
          "project:read",
          "work_item:read",
        ]);
      await db
        .update(schema.roleTable)
        .set({
          capabilities: sql`${schema.roleTable.capabilities} || '["report:read_all", "report:export", "time_entry:read_any"]'::jsonb`,
        })
        .where(
          and(
            eq(schema.roleTable.workspaceId, world.workspaceId),
            eq(schema.roleTable.scope, "workspace"),
            eq(schema.roleTable.key, role),
          ),
        );
      const [dashboard] = await db
        .insert(dashboardTable)
        .values({
          workspaceId: world.workspaceId,
          name: "B9 shared views",
          scope: "workspace",
        })
        .returning();
      if (!dashboard) throw new Error("dashboard missing");
      const widgets = [];
      for (const filter of [
        undefined,
        world.project.id,
        "b9-unknown-project",
      ]) {
        const [view] = await db
          .insert(schema.savedViewTable)
          .values({
            workspaceId: world.workspaceId,
            createdBy: world.projectMember.personId,
            name: "B9 shared chart",
            scope: "workspace",
            scopeId: world.workspaceId,
            visibility: "workspace",
            layout: "chart",
            query: {
              entity: "work_item",
              groupBy: "project",
              ...(filter ? { filter: { projectId: filter } } : {}),
            },
          })
          .returning();
        if (!view) throw new Error("view missing");
        const [widget] = await db
          .insert(dashboardWidgetTable)
          .values({
            dashboardId: dashboard.id,
            savedViewId: view.id,
            chartType: "table",
          })
          .returning();
        if (!widget) throw new Error("widget missing");
        widgets.push(widget);
      }
      const [shared, hiddenView, unknownView] = widgets;
      if (!shared || !hiddenView || !unknownView)
        throw new Error("widgets missing");
      mockAuthenticatedSession(caller.user);
      const seesA = role !== "lead";
      const seesB = role === "admin";
      const dashboardResult = await json(
        app,
        "GET",
        `/api/dashboards/${dashboard.id}`,
      );
      expect(dashboardResult.status).toBe(200);
      const dashboardBody = await dashboardResult.text();
      expect(dashboardBody.includes(hiddenView.id)).toBe(seesB);
      expect(dashboardBody).not.toContain(unknownView.id);
      for (const suffix of ["data", "items", "export"] as const) {
        const method = suffix === "export" ? "POST" : "GET";
        const result = await json(
          app,
          method,
          `/api/dashboards/${dashboard.id}/widgets/${shared.id}/${suffix}`,
          method === "POST" ? {} : undefined,
        );
        expect(result.status, await result.clone().text()).toBe(200);
        const content = await result.text();
        const expectedRows = [
          ...(seesA ? [["B9 Alpha project", "1"]] : []),
          ...(seesB ? [["B9 Secret project", "1"]] : []),
        ];
        if (suffix === "items") {
          expect(content.includes(visibleItem.key)).toBe(seesA);
          expect(content.includes(hiddenItem.key)).toBe(seesB);
          expect(
            (JSON.parse(content) as { data: unknown[] }).data,
          ).toHaveLength(expectedRows.length);
        } else if (suffix === "data") {
          const data = JSON.parse(content) as {
            rows: Array<{ group: string; value: number }>;
            metrics: Array<{ key: string; value: number | null }>;
          };
          expect(
            data.rows.map((row) => [row.group, String(row.value)]),
          ).toEqual(expectedRows);
          expect(
            data.metrics.find((metric) => metric.key === "total")?.value ?? 0,
          ).toBe(expectedRows.length);
        } else {
          const records = csvRecords(content).filter(
            (row) => !row[0]?.startsWith("#"),
          );
          expect(records[0]).toEqual(["Group", "Count"]);
          expect(records.slice(1)).toEqual(expectedRows);
        }
        if (!seesB)
          for (const secret of [
            world.project.id,
            world.project.slug,
            "B9 Secret project",
            hiddenItem.key,
            "B9 Secret item",
          ])
            expect(content).not.toContain(secret);
        const missing = await json(
          app,
          method,
          `/api/dashboards/${dashboard.id}/widgets/${unknownView.id}/${suffix}`,
          method === "POST" ? {} : undefined,
        );
        expect(missing.status).toBe(404);
        const hidden = await json(
          app,
          method,
          `/api/dashboards/${dashboard.id}/widgets/${hiddenView.id}/${suffix}`,
          method === "POST" ? {} : undefined,
        );
        expect(hidden.status).toBe(seesB ? 200 : 404);
        if (!seesB) expect(await hidden.text()).toBe(await missing.text());
        else {
          const hiddenContent = await hidden.text();
          expect(hiddenContent).toContain(
            suffix === "items" ? hiddenItem.key : "B9 Secret project",
          );
          expect(hiddenContent).not.toContain("B9 Alpha project");
        }
      }
      const period = "window=custom&from=2026-01-05&to=2026-01-11";
      const capacityResponse = await json(
        app,
        "GET",
        `/api/reports/capacity?workspaceId=${world.workspaceId}&${period}`,
      );
      expect(
        capacityResponse.status,
        await capacityResponse.clone().text(),
      ).toBe(200);
      const capacityText = await capacityResponse.text();
      const capacity = JSON.parse(capacityText) as {
        rows: Array<{
          team: string;
          members: number;
          capacity: number;
          logged: number;
          open: number;
        }>;
        metrics: Array<{ key: string; value: number }>;
      };
      expect(capacity.rows.map((row) => row.team)).toEqual([
        ...(seesA ? ["B9 Alpha team"] : []),
        ...(seesB ? ["B9 Secret team"] : []),
      ]);
      expect(
        capacity.metrics.find((metric) => metric.key === "teams")?.value ?? 0,
      ).toBe(Number(seesA) + Number(seesB));
      if (seesA)
        expect(capacity.rows[0]).toMatchObject({
          team: "B9 Alpha team",
          members: 1,
          capacity: 8,
          logged: 1,
          open: 1,
        });
      if (seesB)
        expect(capacity.rows[1]).toMatchObject({
          team: "B9 Secret team",
          members: 2,
          capacity: 80,
          logged: 8,
          open: 2,
        });
      const utilisationResponse = await json(
        app,
        "GET",
        `/api/reports/utilisation?workspaceId=${world.workspaceId}&${period}`,
      );
      expect(
        utilisationResponse.status,
        await utilisationResponse.clone().text(),
      ).toBe(200);
      const utilisationText = await utilisationResponse.text();
      const utilisation = JSON.parse(utilisationText) as {
        rows: Array<{ person: string; available: number; logged: number }>;
        metrics: Array<{ key: string; value: number }>;
      };
      expect(utilisation.rows.map((row) => row.person).sort()).toEqual(
        [
          ...(seesA ? ["B9 Alice visible"] : []),
          ...(seesB ? ["B9 Bob secret"] : []),
        ].sort(),
      );
      expect(
        utilisation.metrics.find((metric) => metric.key === "logged")?.value ??
          0,
      ).toBe((seesA ? 1 : 0) + (seesB ? 7 : 0));
      if (seesA)
        expect(
          utilisation.rows.find((row) => row.person === "B9 Alice visible"),
        ).toMatchObject({ available: seesB ? 40 : 8, logged: 1 });
      if (seesB)
        expect(
          utilisation.rows.find((row) => row.person === "B9 Bob secret"),
        ).toMatchObject({ available: 40, logged: 7 });
      if (!seesB)
        for (const text of [capacityText, utilisationText])
          for (const secret of [
            world.project.id,
            world.project.slug,
            "B9 Secret project",
            teamB.id,
            "B9 Secret team",
            bob.personId,
            "B9 Bob secret",
          ])
            expect(text).not.toContain(secret);
    });
  }
});
