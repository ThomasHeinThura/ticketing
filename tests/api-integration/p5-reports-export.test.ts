/**
 * RP-10: a small export is the CSV; a large one (a screen run that hit its row cap or is above the
 * synchronous limit) is queued for the `report-export` job, polled and downloaded from an
 * authenticated route. Custom reports and dashboard widgets export through the same path. Reach,
 * rate stripping (TC-11), the per-person limit, expiry and tenant isolation hold on every surface.
 */
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import { reportExportTable } from "../../apps/api/src/database/schema-p5-reports";
import { runReportExport } from "../../apps/api/src/scheduler/report-jobs";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { type ReportsWorld, reportsWorld } from "./helpers/p5-reports";
import { auditActionsOf, personIdOf } from "./helpers/p5-time";

let w: ReportsWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await reportsWorld();
});

type User = Parameters<ReportsWorld["get"]>[0];
type ExportDto = {
  id: string;
  status: string;
  rowCount: number | null;
  truncated: boolean;
  error: string | null;
  downloadCount: number;
};

const post = (user: User, path: string, body: Record<string, unknown>) =>
  w.get(user, path, {
    method: "POST",
    body: { workspaceId: w.workspaceId, ...body },
  });

/** More at-risk items than the screen's 200-row cap, so the screen run is truncated. */
async function seedAtRisk(count: number) {
  for (let i = 0; i < count; i += 1)
    await w.addItem({
      open: true,
      createdDaysAgo: 5,
      priority: "high",
      sla: { state: "at_risk" },
      title: `At risk ${i}`,
    });
}

async function settle(user: User, id: string): Promise<ExportDto> {
  await runReportExport();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await w.get(user, `/api/report-exports/${id}`);
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as { data: ExportDto };
    if (data.status === "ready" || data.status === "failed") return data;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await runReportExport();
  }
  throw new Error("the export never finished");
}

const dataLines = (csv: string) =>
  csv.split("\r\n").filter((line) => line.length > 0 && !line.startsWith("#"));

describe("synchronous and queued exports (RP-10)", () => {
  it("answers a small export with the CSV and audits it as it leaves", async () => {
    await w.addItem({ createdDaysAgo: 3, resolvedDaysAgo: 1 });
    const response = await post(
      w.owner.user,
      "/api/reports/throughput/export",
      {
        window: "30",
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(await response.text()).toContain("# Throughput");
    expect(await auditActionsOf(w.workspaceId)).toContain("report.exported");
    const rows = await db.select().from(reportExportTable);
    expect(rows).toHaveLength(0);
  });

  it("queues an export above the screen cap, then renders every row, once", async () => {
    await seedAtRisk(210);
    const screen = await w.report(w.owner.user, "at_risk_now");
    expect(screen.body.rows).toHaveLength(200);
    const queued = await post(
      w.owner.user,
      "/api/reports/at_risk_now/export",
      {},
    );
    expect(queued.status, await queued.clone().text()).toBe(202);
    const { data } = (await queued.json()) as { data: ExportDto };
    expect(data.status).toBe("queued");
    expect(await auditActionsOf(w.workspaceId)).toContain(
      "report.export_requested",
    );
    const done = await settle(w.owner.user, data.id);
    expect(done.status).toBe("ready");
    expect(done.rowCount).toBe(210);
    const download = await w.get(
      w.owner.user,
      `/api/report-exports/${data.id}/download`,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain(".csv");
    const csv = await download.text();
    // The header line plus 210 rows: the background export is not cut at the screen's 200.
    expect(dataLines(csv)).toHaveLength(211);
    expect(csv).not.toContain("# Truncated");
    const actions = await auditActionsOf(w.workspaceId);
    expect(
      actions.filter((action) => action === "report.exported"),
    ).toHaveLength(1);
    const status = await w.get(w.owner.user, `/api/report-exports/${data.id}`);
    expect(
      ((await status.json()) as { data: ExportDto }).data.downloadCount,
    ).toBe(1);
    const mine = await w.get(
      w.owner.user,
      `/api/report-exports?workspaceId=${w.workspaceId}`,
    );
    expect(((await mine.json()) as { data: ExportDto[] }).data).toHaveLength(1);
  });

  it("never lets another person, another workspace or a customer reach someone's export", async () => {
    await seedAtRisk(160);
    const queued = await post(
      w.lead.user,
      "/api/reports/at_risk_now/export",
      {},
    );
    expect(queued.status).toBe(202);
    const { data } = (await queued.json()) as { data: ExportDto };
    await settle(w.lead.user, data.id);
    for (const path of [
      `/api/report-exports/${data.id}`,
      `/api/report-exports/${data.id}/download`,
    ]) {
      for (const user of [
        w.owner.user,
        w.member.user,
        w.outsider.user,
        w.stranger.user,
      ]) {
        const response = await w.get(user, path);
        expect(response.status, `${path}`).toBe(404);
      }
      const customer = await w.get(w.customer.user, path);
      expect(customer.status).toBe(403);
    }
    // Their own list shows none of it either.
    const list = await w.get(
      w.owner.user,
      `/api/report-exports?workspaceId=${w.workspaceId}`,
    );
    expect(((await list.json()) as { data: unknown[] }).data).toHaveLength(0);
    const own = await w.get(
      w.lead.user,
      `/api/report-exports/${data.id}/download`,
    );
    expect(own.status).toBe(200);
  });

  it("refuses a reach-scoped file once the requester has lost a project it covered (R7-05)", async () => {
    await seedAtRisk(210);
    const queued = await post(
      w.lead.user,
      "/api/reports/at_risk_now/export",
      {},
    );
    expect(queued.status, await queued.clone().text()).toBe(202);
    const { data } = (await queued.json()) as { data: ExportDto };
    expect((await settle(w.lead.user, data.id)).status).toBe("ready");
    const [row] = await db
      .select()
      .from(reportExportTable)
      .where(eq(reportExportTable.id, data.id));
    const recorded = (row?.caps as { projectIds?: string[] } | undefined)
      ?.projectIds;
    expect(recorded).toContain(w.projectA.id);
    const path = `/api/report-exports/${data.id}/download`;
    expect((await w.get(w.lead.user, path)).status).toBe(200);
    const personId = await personIdOf(w.lead.user.id);
    await db.execute(
      sql`DELETE FROM membership WHERE person_id = ${personId} AND scope = 'project' AND scope_id = ${w.projectA.id}`,
    );
    const refused = await w.get(w.lead.user, path);
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain("reach_revoked");
  });

  it("limits a person to three exports in flight", async () => {
    await seedAtRisk(160);
    const personId = await personIdOf(w.lead.user.id);
    for (let i = 0; i < 3; i += 1)
      await db.insert(reportExportTable).values({
        workspaceId: w.workspaceId,
        personId,
        userId: w.lead.user.id,
        kind: "report",
        reportKey: "at_risk_now",
        title: "At-risk now",
        spec: {
          kind: "report",
          key: "at_risk_now",
          window: {},
          filters: {},
          options: {},
        },
        caps: { readAll: false, showRates: false, readAnyTime: true },
        status: i === 0 ? "running" : "queued",
      });
    const denied = await post(
      w.lead.user,
      "/api/reports/at_risk_now/export",
      {},
    );
    expect(denied.status).toBe(429);
    // Someone else is not held back by it.
    const other = await post(
      w.owner.user,
      "/api/reports/at_risk_now/export",
      {},
    );
    expect(other.status).toBe(202);
  });

  it("expires a finished export, drops its content and answers 410", async () => {
    await seedAtRisk(160);
    const queued = await post(
      w.owner.user,
      "/api/reports/at_risk_now/export",
      {},
    );
    const { data } = (await queued.json()) as { data: ExportDto };
    await settle(w.owner.user, data.id);
    await db
      .update(reportExportTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(reportExportTable.id, data.id));
    await runReportExport();
    const [row] = await db
      .select()
      .from(reportExportTable)
      .where(eq(reportExportTable.id, data.id));
    expect(row?.status).toBe("expired");
    expect(row?.content).toBeNull();
    const gone = await w.get(
      w.owner.user,
      `/api/report-exports/${data.id}/download`,
    );
    expect(gone.status).toBe(410);
  });

  it("answers 409 for a download that is not ready", async () => {
    const personId = await personIdOf(w.owner.user.id);
    const [row] = await db
      .insert(reportExportTable)
      .values({
        workspaceId: w.workspaceId,
        personId,
        userId: w.owner.user.id,
        kind: "report",
        reportKey: "throughput",
        title: "Throughput",
        spec: {},
        caps: {},
        status: "queued",
      })
      .returning();
    const response = await w.get(
      w.owner.user,
      `/api/report-exports/${row?.id}/download`,
    );
    expect(response.status).toBe(409);
  });

  it("fails an export whose requester has since left the workspace, rather than rendering it", async () => {
    await seedAtRisk(160);
    const personId = await personIdOf(w.lead.user.id);
    const [row] = await db
      .insert(reportExportTable)
      .values({
        workspaceId: w.workspaceId,
        personId,
        userId: w.lead.user.id,
        kind: "report",
        reportKey: "at_risk_now",
        title: "At-risk now",
        spec: {
          kind: "report",
          key: "at_risk_now",
          window: {},
          filters: {},
          options: {},
        },
        caps: { readAll: false, showRates: false, readAnyTime: true },
        status: "queued",
      })
      .returning();
    await db.execute(
      sql`DELETE FROM workspace_member WHERE user_id = ${w.lead.user.id} AND workspace_id = ${w.workspaceId}`,
    );
    await runReportExport();
    const [after] = await db
      .select()
      .from(reportExportTable)
      .where(eq(reportExportTable.id, row?.id ?? ""));
    expect(after?.status).toBe("failed");
    expect(after?.error).toBe("forbidden");
    expect(after?.content).toBeNull();
  });
});

describe("rate data in an export (TC-11)", () => {
  it("carries no cost column for a requester without time_entry:manage_rates, on the queue path too", async () => {
    const personId = await personIdOf(w.lead.user.id);
    // The lead claimed rate visibility when asking; the job ANDs it with what they hold now.
    const [row] = await db
      .insert(reportExportTable)
      .values({
        workspaceId: w.workspaceId,
        personId,
        userId: w.lead.user.id,
        kind: "report",
        reportKey: "time_logged",
        title: "Time logged",
        spec: {
          kind: "report",
          key: "time_logged",
          window: { window: "30" },
          filters: {},
          options: {},
        },
        caps: { readAll: true, showRates: true, readAnyTime: true },
        status: "queued",
      })
      .returning();
    const done = await settle(w.lead.user, row?.id ?? "");
    expect(done.status).toBe("ready");
    const csv = await (
      await w.get(w.lead.user, `/api/report-exports/${row?.id}/download`)
    ).text();
    expect(csv).not.toContain("Cost");
    expect(csv).not.toContain("Unpriced");
    expect(csv).toContain("Hours");
    const stored = await db
      .select()
      .from(reportExportTable)
      .where(eq(reportExportTable.id, row?.id ?? ""));
    expect(stored[0]?.ratesIncluded).toBe(false);
  });

  it("includes it for a holder, and refuses the file to a caller who lost the right since", async () => {
    const personId = await personIdOf(w.owner.user.id);
    const [row] = await db
      .insert(reportExportTable)
      .values({
        workspaceId: w.workspaceId,
        personId,
        userId: w.owner.user.id,
        kind: "report",
        reportKey: "time_logged",
        title: "Time logged",
        spec: {
          kind: "report",
          key: "time_logged",
          window: { window: "30" },
          filters: {},
          options: {},
        },
        caps: { readAll: true, showRates: true, readAnyTime: true },
        status: "queued",
      })
      .returning();
    await settle(w.owner.user, row?.id ?? "");
    const csv = await (
      await w.get(w.owner.user, `/api/report-exports/${row?.id}/download`)
    ).text();
    expect(csv).toContain("Cost");
    // A file that carries rates is held back once its owner may no longer see them.
    const leadId = await personIdOf(w.lead.user.id);
    const [lead] = await db
      .insert(reportExportTable)
      .values({
        workspaceId: w.workspaceId,
        personId: leadId,
        userId: w.lead.user.id,
        kind: "report",
        reportKey: "time_logged",
        title: "Time logged",
        spec: {},
        caps: {},
        status: "ready",
        ratesIncluded: true,
        content: "Cost\r\n10\r\n",
        filename: "time_logged.csv",
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning();
    const refused = await w.get(
      w.lead.user,
      `/api/report-exports/${lead?.id}/download`,
    );
    expect(refused.status).toBe(403);
  });

  it("refuses a file rendered under workspace-wide reach its owner no longer holds, and serves one within their rights", async () => {
    const personId = await personIdOf(w.lead.user.id);
    const stored = async (caps: Record<string, boolean | string[]>) => {
      const [row] = await db
        .insert(reportExportTable)
        .values({
          workspaceId: w.workspaceId,
          personId,
          userId: w.lead.user.id,
          kind: "report",
          reportKey: "throughput",
          title: "Throughput",
          spec: {},
          caps,
          status: "ready",
          content: "Week\r\n",
          filename: "throughput.csv",
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning();
      return w.get(w.lead.user, `/api/report-exports/${row?.id}/download`);
    };
    // The lead holds report:export and time_entry:read_any, not report:read_all.
    const wide = await stored({
      readAll: true,
      showRates: false,
      readAnyTime: true,
    });
    expect(wide.status).toBe(403);
    expect(await wide.text()).toContain("reach_revoked");
    const own = await stored({
      readAll: false,
      showRates: false,
      readAnyTime: true,
      projectIds: [w.projectA.id],
    });
    expect(own.status).toBe(200);
    // A reach-scoped file with no recorded coverage is not served (fail closed).
    const unrecorded = await stored({
      readAll: false,
      showRates: false,
      readAnyTime: true,
    });
    expect(unrecorded.status).toBe(403);
  });

  it("answers an impersonated export request with the platform's refusal and queues nothing", async () => {
    await seedAtRisk(210);
    mockAuthenticatedSession(w.owner.user, { impersonatedBy: w.lead.user.id });
    const response = await w.app.request("/api/reports/at_risk_now/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: w.workspaceId }),
    });
    expect(response.status).toBe(403);
    expect(await db.select().from(reportExportTable)).toHaveLength(0);
  });
});

describe("custom reports and widgets export (RP-10)", () => {
  const query = {
    entity: "work_item",
    filter: { window: "30" },
    groupBy: "priority",
    aggregate: { fn: "count" },
  };

  it("exports a tier 3 report as a CSV, audited, for a staff caller only", async () => {
    await w.addItem({ createdDaysAgo: 2, priority: "urgent" });
    const response = await post(w.lead.user, "/api/reports/custom/export", {
      name: "By priority",
      query,
      chartType: "bar",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const csv = await response.text();
    expect(csv).toContain("# By priority");
    expect(csv).toContain("urgent");
    expect(await auditActionsOf(w.workspaceId)).toContain("report.exported");
    const customer = await post(w.customer.user, "/api/reports/custom/export", {
      query,
    });
    expect(customer.status).toBe(403);
    const bad = await post(w.lead.user, "/api/reports/custom/export", {
      query: { ...query, groupBy: "nonsense" },
    });
    expect(bad.status).toBe(422);
  });

  it("exports a dashboard widget, and only the widgets of a dashboard the caller can open", async () => {
    await w.addItem({ createdDaysAgo: 3, resolvedDaysAgo: 1 });
    const created = await post(w.lead.user, "/api/dashboards", {
      name: "Mine",
      widgets: [
        {
          reportKey: "throughput",
          chartType: "bar",
          filters: { window: "30" },
          x: 0,
          y: 0,
          w: 6,
          h: 4,
        },
      ],
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const dashboard = (await created.json()) as {
      id: string;
      widgets: Array<{ id: string }>;
    };
    const wid = dashboard.widgets[0]?.id;
    const path = `/api/dashboards/${dashboard.id}/widgets/${wid}/export`;
    const exported = await post(w.lead.user, path, {});
    expect(exported.status, await exported.clone().text()).toBe(200);
    expect(await exported.text()).toContain("# Throughput");
    // Someone else's personal dashboard is a 404, not a CSV.
    expect((await post(w.owner.user, path, {})).status).toBe(404);
    // A member without report:export is refused before the dashboard is even looked at.
    expect((await post(w.member.user, path, {})).status).toBe(403);
    expect((await post(w.customer.user, path, {})).status).toBe(403);
  });

  it("exports a saved chart view widget as the viewer, never past their view access", async () => {
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
        query,
      },
    });
    const saved = (await view.json()) as { id: string };
    const created = await post(w.lead.user, "/api/dashboards", {
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
    const dashboard = (await created.json()) as {
      id: string;
      widgets: Array<{ id: string }>;
    };
    const response = await post(
      w.lead.user,
      `/api/dashboards/${dashboard.id}/widgets/${dashboard.widgets[0]?.id}/export`,
      {},
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.text()).toContain("# By priority");
  });
});
