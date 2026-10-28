/**
 * P5 round-2 review, exports and rate visibility:
 *  - P5-R2-02 / P5-R2-04: a queued export is written as appended chunks (never by rewriting one
 *    growing value), its ceilings let a 500,000-row export complete, the requester is emailed a
 *    link to the authenticated download route exactly once, and the ceiling failure stays clean.
 *  - P5-R2-03: reports resolve `time_entry:manage_rates` at the report's project, and a workspace
 *    report hides rates while any project role override removes the capability.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  EXPORT_CSV_PAGE_SIZE,
  exportLimits,
} from "../../apps/api/src/report/export.service";
import { exportReadyMailer } from "../../apps/api/src/report/export-notify";
import { runReportExport } from "../../apps/api/src/scheduler/report-jobs";
import { resetTestDatabase } from "./helpers/database";
import { type ReportsWorld, reportsWorld } from "./helpers/p5-reports";

let w: ReportsWorld;
type Sent = { to: string; subject: string; data: Record<string, unknown> };
let sent: Sent[] = [];
let failNext = false;
const realSend = exportReadyMailer.send;
const limitsBefore = { ...exportLimits };

beforeEach(async () => {
  await resetTestDatabase();
  w = await reportsWorld();
  sent = [];
  failNext = false;
  exportReadyMailer.send = async (to, subject, data) => {
    if (failNext) {
      failNext = false;
      throw new Error("transport failure");
    }
    sent.push({ to, subject, data: data as Record<string, unknown> });
    return { success: true };
  };
  await db.insert(schema.instancePluginConfigTable).values({
    id: `plugin-${randomUUID()}`,
    pluginId: "notify.email",
    instanceKey: "default",
    displayName: "Email",
    enabled: true,
    config: {},
    secrets: null,
    scope: "instance",
    workspaceId: null,
    portalScope: null,
    configVersion: 1,
  });
});

afterEach(() => {
  exportReadyMailer.send = realSend;
  Object.assign(exportLimits, limitsBefore);
});

type User = Parameters<ReportsWorld["get"]>[0];
type ExportDto = {
  id: string;
  status: string;
  rowCount: number | null;
  error: string | null;
};

async function settle(user: User, id: string): Promise<ExportDto> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await runReportExport();
    const response = await w.get(user, `/api/report-exports/${id}`);
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as { data: ExportDto };
    if (data.status === "ready" || data.status === "failed") return data;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the export never finished");
}

async function queue(path: string) {
  const queued = await w.get(w.owner.user, path, {
    method: "POST",
    body: { workspaceId: w.workspaceId, window: "30" },
  });
  expect(queued.status, await queued.clone().text()).toBe(202);
  const { data } = (await queued.json()) as { data: { id: string } };
  return data.id;
}

const dataLines = (csv: string) =>
  csv.split("\r\n").filter((line) => line.length > 0 && !/^"?#/.test(line));

/** `count` customers, each with a project, one work item in the window and one rating. */
async function seedCustomers(count: number) {
  await w.addItem({ createdDaysAgo: 4, title: "Seed item" });
  await db.execute(sql`INSERT INTO organisation (id, key, name)
    SELECT 'bulk-org-' || g, 'bulk-org-' || g, 'Bulk customer ' || lpad(g::text, 6, '0')
    FROM generate_series(1, ${count}) g`);
  await db.execute(sql`INSERT INTO project
    SELECT (jsonb_populate_record(NULL::project, to_jsonb(p) || jsonb_build_object(
      'id', 'bulk-project-' || g, 'slug', 'BULK' || g, 'name', 'Bulk project ' || g,
      'organisation_id', 'bulk-org-' || g))).*
    FROM project p CROSS JOIN generate_series(1, ${count}) g WHERE p.id = ${w.projectA.id}`);
  await db.execute(sql`INSERT INTO state
    SELECT (jsonb_populate_record(NULL::state, to_jsonb(s) || jsonb_build_object(
      'id', 'bulk-state-' || g || '-' || s.id, 'project_id', 'bulk-project-' || g))).*
    FROM state s CROSS JOIN generate_series(1, ${count}) g WHERE s.project_id = ${w.projectA.id}`);
  await db.execute(sql`INSERT INTO work_item
    SELECT (jsonb_populate_record(NULL::work_item, to_jsonb(wi) || jsonb_build_object(
      'id', 'bulk-item-' || g, 'project_id', 'bulk-project-' || g, 'key', 'BULK' || g || '-1',
      'state_id', 'bulk-state-' || g || '-' || wi.state_id,
      'number', 1, 'title', 'Bulk item ' || g, 'created_at', (now() - interval '3 days')::text,
      'updated_at', (now() - interval '3 days')::text))).*
    FROM work_item wi CROSS JOIN generate_series(1, ${count}) g WHERE wi.id = ${w.itemA.id}`);
  await db.execute(sql`INSERT INTO satisfaction_rating (id, work_item_id, person_id, score, created_at, updated_at)
    SELECT 'bulk-rating-' || g, 'bulk-item-' || g, ${w.customer.person.id}, 5, now() - interval '2 days', now()
    FROM generate_series(1, ${count}) g`);
}

async function chunksOf(id: string) {
  return (
    await db.execute<{
      seq: number;
      bytes: number;
    }>(sql`SELECT seq, octet_length(content) AS bytes
      FROM report_export_chunk WHERE export_id = ${id} ORDER BY seq`)
  ).rows;
}

describe("queued exports are appended in chunks and the requester is emailed once (P5-R2-02, P5-R2-04)", () => {
  it("the ceilings admit the contract's 500,000-row export", () => {
    expect(exportLimits.maxRows).toBeGreaterThanOrEqual(500_000);
    expect(exportLimits.maxPages * EXPORT_CSV_PAGE_SIZE).toBeGreaterThanOrEqual(
      500_000,
    );
    expect(exportLimits.pageSize).toBe(EXPORT_CSV_PAGE_SIZE);
  });

  it("a multi-page export is stored as one appended chunk per page, downloads whole, and is announced once", async () => {
    const COUNT = 2_400;
    await seedCustomers(COUNT);
    exportLimits.pageSize = 500;
    const startedAt = Date.now();
    const id = await queue("/api/reports/customer_performance/export");
    const done = await settle(w.owner.user, id);
    const elapsed = Date.now() - startedAt;
    expect(done.status, done.error ?? "").toBe("ready");

    // One chunk per page, in order; the parent row holds no copy of the file.
    const chunks = await chunksOf(id);
    expect(chunks.length).toBe(Math.floor((done.rowCount ?? 0) / 500) + 1);
    expect(chunks.map((chunk) => Number(chunk.seq))).toEqual(
      chunks.map((_, index) => index),
    );
    const [parent] = await db
      .execute<{ content: string | null }>(
        sql`SELECT content FROM report_export WHERE id = ${id}`,
      )
      .then((result) => result.rows);
    expect(parent?.content).toBeNull();

    // The authenticated route streams the chunks back as one CSV.
    const response = await w.get(
      w.owner.user,
      `/api/report-exports/${id}/download`,
    );
    expect(response.status).toBe(200);
    const rows = dataLines(await response.text()).slice(1);
    expect(rows.length).toBe(done.rowCount);
    expect(rows.length).toBeGreaterThanOrEqual(COUNT);
    const customers = rows.map((line) => line.split(",")[0]);
    expect(new Set(customers).size).toBe(customers.length);

    // Emailed once, to the requester, with the agent export page (P5-R3-01) and no token in the link.
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect(mail?.to).toBe(w.owner.user.email);
    const actionUrl = new URL(String(mail?.data.actionUrl));
    expect(actionUrl.pathname).toBe(`/agent/reports/exports/${id}`);
    expect(actionUrl.search).toBe("");
    expect(actionUrl.hash).toBe("");
    await runReportExport();
    await runReportExport();
    expect(sent).toHaveLength(1);
    console.info(
      `[p5-r2] ${done.rowCount} rows in ${chunks.length} chunks, queued to ready in ${elapsed} ms`,
    );
  });

  it("a transport failure releases the claim and the next run sends exactly once", async () => {
    await seedCustomers(200);
    failNext = true;
    const id = await queue("/api/reports/customer_performance/export");
    expect((await settle(w.owner.user, id)).status).toBe("ready");
    // The first run's send threw; the following runs retried it once.
    await runReportExport();
    await runReportExport();
    expect(sent).toHaveLength(1);
  });

  it("a requester who switched the email off is not emailed, and the file is still ready", async () => {
    await seedCustomers(200);
    await db.execute(sql`INSERT INTO notification_preference
      (person_id, scope, scope_id, channel, event_kind, enabled, digest)
      VALUES (${w.ownerPersonId}, 'global', NULL, 'notify.email',
        'report.export_ready', false, 'off')`);
    const id = await queue("/api/reports/customer_performance/export");
    expect((await settle(w.owner.user, id)).status).toBe("ready");
    await runReportExport();
    expect(sent).toHaveLength(0);
  });

  it("an export above the row ceiling fails cleanly: no chunks, no email, the download refuses", async () => {
    await seedCustomers(300);
    // The 500,000-row ceiling scaled down: 100 rows a page, at most 250 rows.
    exportLimits.pageSize = 100;
    exportLimits.maxRows = 250;
    const id = await queue("/api/reports/customer_performance/export");
    const done = await settle(w.owner.user, id);
    expect(done.status).toBe("failed");
    expect(done.error).toBe("export_too_large");
    expect(await chunksOf(id)).toHaveLength(0);
    await runReportExport();
    expect(sent).toHaveLength(0);
    const response = await w.get(
      w.owner.user,
      `/api/report-exports/${id}/download`,
    );
    expect(response.status).toBe(409);
  });

  it("an expired export loses its chunks", async () => {
    await seedCustomers(200);
    const id = await queue("/api/reports/customer_performance/export");
    expect((await settle(w.owner.user, id)).status).toBe("ready");
    expect((await chunksOf(id)).length).toBeGreaterThan(0);
    await db.execute(
      sql`UPDATE report_export SET expires_at = now() - interval '1 minute' WHERE id = ${id}`,
    );
    await runReportExport();
    expect(await chunksOf(id)).toHaveLength(0);
    const response = await w.get(
      w.owner.user,
      `/api/report-exports/${id}/download`,
    );
    expect(response.status).toBe(410);
  });
});

describe("report rate visibility follows project role overrides (P5-R2-03)", () => {
  async function removeRatesAt(projectId: string) {
    await db.execute(sql`UPDATE role SET capabilities = capabilities - 'time_entry:manage_rates'
      WHERE id IN (SELECT m.role_id FROM membership m
        WHERE m.person_id = ${w.ownerPersonId} AND m.scope = 'project' AND m.scope_id = ${projectId})`);
  }

  it("a project-filtered report resolves rates at that project; a workspace report fails closed", async () => {
    const costVisible = async (query = "") => {
      const { response, body } = await w.report(
        w.owner.user,
        "time_logged",
        query,
      );
      expect(response.status).toBe(200);
      return body.costVisible;
    };
    expect(await costVisible()).toBe(true);
    expect(await costVisible(`&projectId=${w.projectB.id}`)).toBe(true);

    await removeRatesAt(w.projectB.id);
    expect(await costVisible(`&projectId=${w.projectB.id}`)).toBe(false);
    expect(await costVisible(`&projectId=${w.projectA.id}`)).toBe(true);
    // Across the workspace project B's cost would be mixed in: no rates at all.
    expect(await costVisible()).toBe(false);
  });

  it("a synchronous CSV export carries no cost columns once a project override removes rates", async () => {
    const exported = async (filters: Record<string, string> = {}) => {
      const response = await w.get(
        w.owner.user,
        "/api/reports/cost_to_deliver/export",
        {
          method: "POST",
          body: { workspaceId: w.workspaceId, window: "30", ...filters },
        },
      );
      expect(response.status, await response.clone().text()).toBe(200);
      return await response.text();
    };
    const header = (csv: string) => dataLines(csv)[0] ?? "";
    const before = header(await exported());
    await removeRatesAt(w.projectB.id);
    const after = header(await exported());
    // The rate-derived columns are removed, not blanked.
    expect(after.split(",").length).toBeLessThan(before.split(",").length);
    expect(header(await exported({ projectId: w.projectA.id }))).toEqual(
      before,
    );
    expect(header(await exported({ projectId: w.projectB.id }))).toEqual(after);
  });
});
