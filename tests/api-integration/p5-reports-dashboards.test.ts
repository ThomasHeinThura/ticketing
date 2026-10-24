/**
 * P5 dashboards (RP-13..RP-16) and tier 2/3 reports: the default dashboard, personal versus
 * workspace dashboards, layout saves with a version, deletion through approval, widget data per
 * caller, saved views as widgets and the small tier 3 builder.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import {
  customFieldSectionTable,
  customFieldTable,
  customFieldValueTable,
} from "../../apps/api/src/database/migration-schema";
import {
  dashboardTable,
  dashboardWidgetTable,
} from "../../apps/api/src/database/schema-p5-reports";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { type ReportsWorld, reportsWorld } from "./helpers/p5-reports";
import { auditActionsOf, isoDaysAgo } from "./helpers/p5-time";
import {
  deleteThroughApproval,
  ensureAgentSession,
} from "./helpers/pending-deletion";

let w: ReportsWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await reportsWorld();
});

type User = Parameters<ReportsWorld["get"]>[0];
type Dashboard = {
  id: string;
  name: string;
  scope: string;
  version: number;
  canEdit: boolean;
  isDefault: boolean;
  widgets: Array<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    reportKey: string | null;
  }>;
};

const list = async (user: User) => {
  const response = await w.get(
    user,
    `/api/dashboards?workspaceId=${w.workspaceId}`,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    data: Dashboard[];
    meta: { canManageWorkspaceDashboards: boolean };
  };
};
const widget = (
  reportKey: string,
  x: number,
  y: number,
  extra: Record<string, unknown> = {},
) => ({
  reportKey,
  chartType: "bar",
  filters: { window: "30" },
  x,
  y,
  w: 6,
  h: 4,
  ...extra,
});
const create = (user: User, body: Record<string, unknown>) =>
  w.get(user, "/api/dashboards", {
    method: "POST",
    body: { workspaceId: w.workspaceId, ...body },
  });
const get = async (user: User, id: string) => {
  const response = await w.get(
    user,
    `/api/dashboards/${id}?workspaceId=${w.workspaceId}`,
  );
  return {
    response,
    body: (await response.json().catch(() => ({}))) as Dashboard,
  };
};
const patch = (user: User, id: string, body: Record<string, unknown>) =>
  w.get(user, `/api/dashboards/${id}`, { method: "PATCH", body });

describe("the default dashboard (RP-16)", () => {
  it("gives a new person a useful dashboard on first use, once", async () => {
    const first = await list(w.member.user);
    expect(first.data).toHaveLength(1);
    expect(first.data[0]).toMatchObject({
      name: "Overview",
      scope: "personal",
      canEdit: true,
    });
    const second = await list(w.member.user);
    expect(second.data.map((d) => d.id)).toEqual(first.data.map((d) => d.id));
    const detail = await get(w.member.user, first.data[0]?.id ?? "");
    expect(detail.body.widgets.length).toBe(6);
    expect(detail.body.widgets.map((x) => x.reportKey)).toContain(
      "sla_attainment",
    );
    expect(await auditActionsOf(w.workspaceId)).toContain("dashboard.created");
    // Someone else's default is not mine.
    const other = await list(w.lead.user);
    expect(other.data[0]?.id).not.toBe(first.data[0]?.id);
  });

  it("does not create a personal default when the workspace already has a dashboard", async () => {
    const workspace = await create(w.owner.user, {
      name: "Company",
      scope: "workspace",
      isDefault: true,
      widgets: [widget("throughput", 0, 0)],
    });
    expect(workspace.status, await workspace.clone().text()).toBe(201);
    const result = await list(w.member.user);
    expect(result.data.map((d) => d.name)).toEqual(["Company"]);
    expect(result.data[0]?.canEdit).toBe(false);
  });
});

describe("personal and workspace dashboards (RP-14)", () => {
  it("keeps a personal dashboard to its owner", async () => {
    const created = await create(w.member.user, {
      name: "Mine",
      widgets: [widget("workload", 0, 0)],
    });
    expect(created.status).toBe(201);
    const dashboard = (await created.json()) as Dashboard;
    expect((await get(w.lead.user, dashboard.id)).response.status).toBe(404);
    expect(
      (await patch(w.lead.user, dashboard.id, { version: 1, name: "Taken" }))
        .status,
    ).toBe(404);
    expect((await list(w.lead.user)).data.map((d) => d.name)).not.toContain(
      "Mine",
    );
  });

  it("lets only workspace:manage_settings create and change a workspace dashboard", async () => {
    const refused = await create(w.member.user, {
      name: "Shared",
      scope: "workspace",
    });
    expect(refused.status).toBe(403);
    const created = await create(w.owner.user, {
      name: "Shared",
      scope: "workspace",
    });
    expect(created.status).toBe(201);
    const dashboard = (await created.json()) as Dashboard;
    const seen = await get(w.member.user, dashboard.id);
    expect(seen.response.status).toBe(200);
    expect(seen.body.canEdit).toBe(false);
    expect(
      (
        await patch(w.member.user, dashboard.id, {
          version: 1,
          name: "Mine now",
        })
      ).status,
    ).toBe(403);
    expect(
      (await patch(w.owner.user, dashboard.id, { version: 1, name: "Renamed" }))
        .status,
    ).toBe(200);
  });

  it("keeps one workspace default and a name unique per owner", async () => {
    const one = await create(w.owner.user, {
      name: "A",
      scope: "workspace",
      isDefault: true,
    });
    const two = await create(w.owner.user, {
      name: "B",
      scope: "workspace",
      isDefault: true,
    });
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    const defaults = await db
      .select()
      .from(dashboardTable)
      .where(eq(dashboardTable.isDefault, true));
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.name).toBe("B");
    expect(
      (await create(w.owner.user, { name: "b", scope: "workspace" })).status,
    ).toBe(409);
  });

  it("answers another workspace as not found", async () => {
    const created = await create(w.member.user, { name: "Mine" });
    const dashboard = (await created.json()) as Dashboard;
    const response = await w.get(
      w.stranger.user,
      `/api/dashboards/${dashboard.id}?workspaceId=${w.stranger.workspace.id}`,
    );
    expect([403, 404]).toContain(response.status);
  });
});

describe("layout (RP-15)", () => {
  it("saves a drag and a resize atomically, keeps widget ids and bumps the version", async () => {
    const created = await create(w.member.user, {
      name: "Layout",
      widgets: [widget("throughput", 0, 0), widget("ageing", 6, 0)],
    });
    const dashboard = (await created.json()) as Dashboard;
    const [first, second] = dashboard.widgets;
    const moved = await patch(w.member.user, dashboard.id, {
      version: dashboard.version,
      widgets: [
        { ...first, chartType: "bar", filters: {}, x: 0, y: 4, w: 12, h: 3 },
        { ...second, chartType: "bar", filters: {}, x: 0, y: 0, w: 4, h: 4 },
      ],
    });
    expect(moved.status, await moved.clone().text()).toBe(200);
    const body = (await moved.json()) as Dashboard;
    expect(body.version).toBe(dashboard.version + 1);
    expect(body.widgets.map((x) => x.id).sort()).toEqual(
      [first?.id, second?.id].sort(),
    );
    const reread = await get(w.member.user, dashboard.id);
    expect(reread.body.widgets.find((x) => x.id === first?.id)).toMatchObject({
      x: 0,
      y: 4,
      w: 12,
      h: 3,
    });
    expect(await auditActionsOf(w.workspaceId)).toContain("dashboard.updated");
  });

  it("refuses a stale version, overlapping widgets, an unknown report and too many widgets", async () => {
    const created = await create(w.member.user, {
      name: "Rules",
      widgets: [widget("throughput", 0, 0)],
    });
    const dashboard = (await created.json()) as Dashboard;
    const keep = dashboard.widgets[0];
    expect(
      (await patch(w.member.user, dashboard.id, { version: 1, name: "One" }))
        .status,
    ).toBe(200);
    expect(
      (await patch(w.member.user, dashboard.id, { version: 1, name: "Two" }))
        .status,
    ).toBe(409);
    const overlap = await patch(w.member.user, dashboard.id, {
      version: 2,
      widgets: [
        { ...keep, filters: {}, x: 0, y: 0, w: 6, h: 4 },
        widget("ageing", 3, 2),
      ],
    });
    expect(overlap.status).toBe(422);
    const unknown = await patch(w.member.user, dashboard.id, {
      version: 2,
      widgets: [widget("no_such_report", 0, 0)],
    });
    expect(unknown.status).toBe(422);
    const many = await patch(w.member.user, dashboard.id, {
      version: 2,
      widgets: Array.from({ length: 21 }, (_, i) => widget("ageing", 0, i)),
    });
    expect(many.status).toBe(400);
    const stored = await db
      .select()
      .from(dashboardWidgetTable)
      .where(eq(dashboardWidgetTable.dashboardId, dashboard.id));
    expect(stored).toHaveLength(1);
  });

  it("deletes only after approval and takes the widgets with it", async () => {
    await ensureAgentSession(w.member.user.id);
    const created = await create(w.member.user, {
      name: "Doomed",
      widgets: [widget("throughput", 0, 0)],
    });
    const dashboard = (await created.json()) as Dashboard;
    mockAuthenticatedSession(w.member.user);
    await deleteThroughApproval(
      w.app,
      w.member.user,
      `/api/dashboards/${dashboard.id}`,
      {
        afterRequest: async () => {
          expect(
            await db
              .select()
              .from(dashboardTable)
              .where(eq(dashboardTable.id, dashboard.id)),
          ).toHaveLength(1);
        },
      },
    );
    expect(
      await db
        .select()
        .from(dashboardTable)
        .where(eq(dashboardTable.id, dashboard.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(dashboardWidgetTable)
        .where(eq(dashboardWidgetTable.dashboardId, dashboard.id)),
    ).toHaveLength(0);
    expect(await auditActionsOf(w.workspaceId)).toContain("dashboard.deleted");
  });

  it("refuses to delete someone else's dashboard", async () => {
    const created = await create(w.owner.user, {
      name: "Shared",
      scope: "workspace",
    });
    const dashboard = (await created.json()) as Dashboard;
    const response = await w.get(
      w.member.user,
      `/api/dashboards/${dashboard.id}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(403);
  });
});

describe("widget data", () => {
  it("runs the widget's report for the caller: two people, two answers", async () => {
    await w.addItem({
      createdDaysAgo: 3,
      resolvedDaysAgo: 1,
      projectId: w.projectA.id,
    });
    await w.addItem({
      createdDaysAgo: 3,
      resolvedDaysAgo: 1,
      projectId: w.projectB.id,
    });
    const created = await create(w.owner.user, {
      name: "Company",
      scope: "workspace",
      widgets: [widget("throughput", 0, 0, { filters: { window: "7" } })],
    });
    const dashboard = (await created.json()) as Dashboard;
    const url = `/api/dashboards/${dashboard.id}/widgets/${dashboard.widgets[0]?.id}/data?workspaceId=${w.workspaceId}`;
    const read = async (user: User) =>
      (await (await w.get(user, url)).json()) as {
        metrics: Array<{ value: number }>;
      };
    expect((await read(w.owner.user)).metrics[0]?.value).toBe(2);
    expect((await read(w.member.user)).metrics[0]?.value).toBe(1);
    expect((await read(w.outsider.user)).metrics[0]?.value).toBe(0);
    const missing = await w.get(
      w.owner.user,
      `/api/dashboards/${dashboard.id}/widgets/nope/data?workspaceId=${w.workspaceId}`,
    );
    expect(missing.status).toBe(404);
  });
});

describe("tier 3 custom reports and saved views as widgets", () => {
  const preview = (user: User, body: Record<string, unknown>) =>
    w.get(user, "/api/reports/custom/preview", {
      method: "POST",
      body: { workspaceId: w.workspaceId, ...body },
    });

  it("groups work items by priority and by week", async () => {
    await w.addItem({ createdDaysAgo: 2, priority: "urgent" });
    await w.addItem({ createdDaysAgo: 2, priority: "urgent" });
    await w.addItem({ createdDaysAgo: 2, priority: "low" });
    const response = await preview(w.owner.user, {
      query: {
        entity: "work_item",
        filter: { window: "30" },
        groupBy: "priority",
        aggregate: { fn: "count" },
      },
      chartType: "bar",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      rows: Array<{ group: string; value: number }>;
      chart: unknown;
    };
    expect(body.rows.find((row) => row.group === "urgent")?.value).toBe(2);
    expect(body.rows.find((row) => row.group === "low")?.value).toBe(1);
    expect(body.chart).not.toBeNull();
    const weekly = await preview(w.owner.user, {
      query: { entity: "work_item", groupBy: "week" },
      chartType: "line",
    });
    expect(weekly.status).toBe(200);
  });

  it("sums time by person, with no cost field at all", async () => {
    await w.addRate(w.member.personId, isoDaysAgo(20), 6000, "EUR");
    await w.logTime(w.member.user, { date: isoDaysAgo(1), minutes: 90 });
    const response = await preview(w.owner.user, {
      query: {
        entity: "time_entry",
        groupBy: "person",
        aggregate: { fn: "sum", field: "minutes" },
      },
      chartType: "table",
    });
    const text = await response.text();
    expect(JSON.parse(text).rows[0].value).toBe(1.5);
    expect(text).not.toMatch(/9000|90\.00|"cost"|rateMinor|unpriced/i);
  });

  it("refuses what the small grammar does not cover", async () => {
    for (const query of [
      { entity: "work_item", filter: { status: "open" } },
      { entity: "work_item", groupBy: "reporter" },
      { entity: "work_item", aggregate: { fn: "sum", field: "minutes" } },
      { entity: "time_entry", groupBy: "priority" },
    ]) {
      const response = await preview(w.owner.user, { query });
      expect(response.status, JSON.stringify(query)).toBe(422);
    }
  });

  it("keeps the group of a custom field that was deleted, labelled as such", async () => {
    const [section] = await db
      .insert(customFieldSectionTable)
      .values({ id: randomUUID(), workspaceId: w.workspaceId, name: "Facts" })
      .returning();
    const [field] = await db
      .insert(customFieldTable)
      .values({
        id: randomUUID(),
        workspaceId: w.workspaceId,
        sectionId: section?.id ?? "",
        key: `cf-${randomUUID().slice(0, 6)}`,
        name: "Region",
        format: "text",
      })
      .returning();
    const item = await w.addItem({ createdDaysAgo: 1 });
    await db.insert(customFieldValueTable).values({
      id: randomUUID(),
      workspaceId: w.workspaceId,
      customFieldId: field?.id ?? "",
      entityId: item.id,
      value: "EMEA",
      projectId: item.projectId,
    });
    const query = { entity: "work_item", groupBy: `field:${field?.id}` };
    const live = (await (await preview(w.owner.user, { query })).json()) as {
      rows: Array<{ group: string }>;
    };
    expect(live.rows.map((row) => row.group)).toContain("EMEA");
    await db
      .update(customFieldTable)
      .set({ deletedAt: new Date() })
      .where(eq(customFieldTable.id, field?.id ?? ""));
    const gone = await preview(w.owner.user, { query });
    expect(gone.status).toBe(200);
    expect(
      ((await gone.json()) as { rows: Array<{ group: string }> }).rows.map(
        (row) => row.group,
      ),
    ).toEqual(["(deleted field)"]);
  });

  it("runs a saved chart view as a widget, and hides a private view from others", async () => {
    await w.addItem({ createdDaysAgo: 2, priority: "urgent" });
    const view = await w.get(w.lead.user, "/api/views", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "By priority",
        scope: "workspace",
        scopeId: w.workspaceId,
        visibility: "private",
        layout: "chart",
        query: {
          entity: "work_item",
          filter: { window: "30" },
          groupBy: "priority",
          aggregate: { fn: "count" },
        },
      },
    });
    expect(view.status, await view.clone().text()).toBeLessThan(300);
    const saved = (await view.json()) as { id: string };
    const created = await create(w.lead.user, {
      name: "Views",
      widgets: [
        {
          savedViewId: saved.id,
          chartType: "bar",
          filters: {},
          x: 0,
          y: 0,
          w: 6,
          h: 4,
        },
      ],
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const dashboard = (await created.json()) as Dashboard;
    const data = await w.get(
      w.lead.user,
      `/api/dashboards/${dashboard.id}/widgets/${dashboard.widgets[0]?.id}/data?workspaceId=${w.workspaceId}`,
    );
    expect(data.status).toBe(200);
    expect(((await data.json()) as { title: string }).title).toBe(
      "By priority",
    );
    // Someone who cannot see the view cannot put it on a dashboard.
    const denied = await create(w.member.user, {
      name: "Peek",
      widgets: [
        {
          savedViewId: saved.id,
          chartType: "bar",
          filters: {},
          x: 0,
          y: 0,
          w: 6,
          h: 4,
        },
      ],
    });
    expect(denied.status).toBe(404);
  });
});
