/**
 * P5 round-3 review, the "export ready" email (RP-10):
 *  - P5-R3-01: the email links to the agent page `/agent/reports/exports/{id}` (which signs a
 *    signed-out recipient in and returns there), not to the JSON download route. Reading the
 *    export's status, as that page does, audits nothing; the download is audited once.
 *  - P5-R3-02: `report.export_ready` is a staff email preference the preferences API accepts
 *    (immediate only, no digest), an opt-out saved through that API suppresses the email, and the
 *    email carries the signed NO-2 link to exactly that preference.
 *  - P5-R3-04: a claim whose worker crashed before sending expires and the next run sends the email
 *    once; a live claim is left alone.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { verifyNotificationPreferenceLink } from "../../apps/api/src/notification/preference-link";
import {
  exportNotifyLease,
  exportReadyMailer,
  notifyExportReady,
} from "../../apps/api/src/report/export-notify";
import { runReportExport } from "../../apps/api/src/scheduler/report-jobs";
import { resetTestDatabase } from "./helpers/database";
import { type ReportsWorld, reportsWorld } from "./helpers/p5-reports";

let w: ReportsWorld;
type Sent = { to: string; subject: string; data: Record<string, unknown> };
let sent: Sent[] = [];
const realSend = exportReadyMailer.send;
const leaseBefore = exportNotifyLease.ms;

beforeEach(async () => {
  await resetTestDatabase();
  w = await reportsWorld();
  sent = [];
  exportReadyMailer.send = async (to, subject, data) => {
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
  exportNotifyLease.ms = leaseBefore;
});

type User = Parameters<ReportsWorld["get"]>[0];

async function settle(user: User, id: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await runReportExport();
    const response = await w.get(user, `/api/report-exports/${id}`);
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as { data: { status: string } };
    if (data.status === "ready" || data.status === "failed") return data.status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the export never finished");
}

/** `count` customers with one rated work item each: enough rows to be queued. */
async function seedCustomers(count: number) {
  await w.addItem({ createdDaysAgo: 4, title: "Seed item" });
  await db.execute(sql`INSERT INTO organisation (id, key, name)
    SELECT 'r3-org-' || g, 'r3-org-' || g, 'R3 customer ' || lpad(g::text, 6, '0')
    FROM generate_series(1, ${count}) g`);
  await db.execute(sql`INSERT INTO project
    SELECT (jsonb_populate_record(NULL::project, to_jsonb(p) || jsonb_build_object(
      'id', 'r3-project-' || g, 'slug', 'RTHREE' || g, 'name', 'R3 project ' || g,
      'organisation_id', 'r3-org-' || g))).*
    FROM project p CROSS JOIN generate_series(1, ${count}) g WHERE p.id = ${w.projectA.id}`);
  await db.execute(sql`INSERT INTO state
    SELECT (jsonb_populate_record(NULL::state, to_jsonb(s) || jsonb_build_object(
      'id', 'r3-state-' || g || '-' || s.id, 'project_id', 'r3-project-' || g))).*
    FROM state s CROSS JOIN generate_series(1, ${count}) g WHERE s.project_id = ${w.projectA.id}`);
  await db.execute(sql`INSERT INTO work_item
    SELECT (jsonb_populate_record(NULL::work_item, to_jsonb(wi) || jsonb_build_object(
      'id', 'r3-item-' || g, 'project_id', 'r3-project-' || g, 'key', 'RTHREE' || g || '-1',
      'state_id', 'r3-state-' || g || '-' || wi.state_id,
      'number', 1, 'title', 'R3 item ' || g, 'created_at', (now() - interval '3 days')::text,
      'updated_at', (now() - interval '3 days')::text))).*
    FROM work_item wi CROSS JOIN generate_series(1, ${count}) g WHERE wi.id = ${w.itemA.id}`);
  await db.execute(sql`INSERT INTO satisfaction_rating (id, work_item_id, person_id, score, created_at, updated_at)
    SELECT 'r3-rating-' || g, 'r3-item-' || g, ${w.customer.person.id}, 5, now() - interval '2 days', now()
    FROM generate_series(1, ${count}) g`);
}

async function queueExport(): Promise<string> {
  await seedCustomers(200);
  const queued = await w.get(
    w.owner.user,
    "/api/reports/customer_performance/export",
    { method: "POST", body: { workspaceId: w.workspaceId, window: "30" } },
  );
  expect(queued.status, await queued.clone().text()).toBe(202);
  const { data } = (await queued.json()) as { data: { id: string } };
  return data.id;
}

async function downloadAudits(id: string): Promise<number> {
  const rows = await db
    .select({ after: schema.auditLogTable.after })
    .from(schema.auditLogTable)
    .where(
      and(
        eq(schema.auditLogTable.action, "report.exported"),
        eq(schema.auditLogTable.workspaceId, w.workspaceId),
      ),
    );
  return rows.filter(
    (row) => (row.after as Record<string, unknown> | null)?.exportId === id,
  ).length;
}

async function putPreference(body: Record<string, unknown>) {
  return w.get(w.owner.user, "/api/notification-preferences", {
    method: "PUT",
    body: {
      canonicalPreference: {
        eventKind: "report.export_ready",
        channel: "notify.email",
        scope: "global",
        scopeId: null,
        ...body,
      },
    },
  });
}

describe("the export-ready email opens the agent export page (P5-R3-01)", () => {
  it("links to /agent/reports/exports/{id}; the page's status reads audit nothing and the download audits once", async () => {
    const id = await queueExport();
    expect(await settle(w.owner.user, id)).toBe("ready");
    expect(sent).toHaveLength(1);
    const actionUrl = new URL(String(sent[0]?.data.actionUrl));
    expect(actionUrl.pathname).toBe(`/agent/reports/exports/${id}`);
    expect(actionUrl.pathname.startsWith("/api/")).toBe(false);
    expect(actionUrl.search).toBe("");
    expect(actionUrl.hash).toBe("");
    expect(String(sent[0]?.data.message)).toContain("sign in");

    // The page polls the status: never audited as a download.
    const before = await downloadAudits(id);
    for (let i = 0; i < 3; i += 1) {
      const status = await w.get(w.owner.user, `/api/report-exports/${id}`);
      expect(status.status).toBe(200);
    }
    expect(await downloadAudits(id)).toBe(before);

    // The page's Download button: one authenticated download, one audit row.
    const file = await w.get(
      w.owner.user,
      `/api/report-exports/${id}/download`,
    );
    expect(file.status).toBe(200);
    await file.text();
    expect(await downloadAudits(id)).toBe(before + 1);
  });

  it("another person following the link gets a 404 from the status the page reads", async () => {
    const id = await queueExport();
    expect(await settle(w.owner.user, id)).toBe("ready");
    const status = await w.get(w.lead.user, `/api/report-exports/${id}`);
    expect(status.status).toBe(404);
  });
});

describe("report.export_ready is a settable email preference (P5-R3-02)", () => {
  it("the preferences API lists it (on by default), accepts it, and refuses a digest", async () => {
    const initial = await w.get(w.owner.user, "/api/notification-preferences");
    expect(initial.status).toBe(200);
    const listed = (
      (await initial.json()) as {
        canonicalPreferences: Array<{
          eventKind: string;
          enabled: boolean;
          source: string;
        }>;
      }
    ).canonicalPreferences.find(
      (row) => row.eventKind === "report.export_ready",
    );
    expect(listed).toMatchObject({ enabled: true, source: "default" });

    const digest = await putPreference({ enabled: true, digest: "daily" });
    expect(digest.status).toBeGreaterThanOrEqual(400);
    expect(digest.status).toBeLessThan(500);

    const saved = await putPreference({ enabled: false, digest: "off" });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const after = (
      (await saved.json()) as {
        canonicalPreferences: Array<{
          eventKind: string;
          enabled: boolean;
          source: string;
        }>;
      }
    ).canonicalPreferences.find(
      (row) => row.eventKind === "report.export_ready",
    );
    expect(after).toMatchObject({ enabled: false, source: "global" });
  });

  it("an opt-out saved through the API suppresses the email; the file is still ready", async () => {
    expect(
      (await putPreference({ enabled: false, digest: "off" })).status,
    ).toBe(200);
    const id = await queueExport();
    expect(await settle(w.owner.user, id)).toBe("ready");
    await runReportExport();
    expect(sent).toHaveLength(0);
    // A decided outcome: the email is not owed any more.
    const [row] = (
      await db.execute<{
        notified: boolean;
      }>(
        sql`SELECT notified_at IS NOT NULL AS notified FROM report_export WHERE id = ${id}`,
      )
    ).rows;
    expect(row?.notified).toBe(true);
  });

  it("the email carries the signed NO-2 link to exactly this preference", async () => {
    const id = await queueExport();
    expect(await settle(w.owner.user, id)).toBe("ready");
    expect(sent).toHaveLength(1);
    const preferenceUrl = new URL(String(sent[0]?.data.preferenceUrl));
    expect(preferenceUrl.pathname).toBe(
      "/dashboard/settings/account/notifications",
    );
    const token = preferenceUrl.hash.replace(/^#preference_token=/, "");
    const claims = verifyNotificationPreferenceLink(token, "agent");
    expect(claims?.recipientPersonId).toBe(w.ownerPersonId);
    expect(claims?.selector).toEqual({
      eventKind: "report.export_ready",
      channel: "notify.email",
      scope: "global",
      scopeId: null,
    });
  });
});

describe("a crashed claim is retried (P5-R3-04)", () => {
  it("a claim older than the lease is taken over and sent once; a live claim is left alone", async () => {
    const id = await queueExport();
    expect(await settle(w.owner.user, id)).toBe("ready");
    expect(sent).toHaveLength(1);

    // A worker claimed the email and crashed before sending: the claim is still live.
    sent = [];
    await db.execute(sql`UPDATE report_export
      SET notified_at = NULL, notify_claimed_at = now() WHERE id = ${id}`);
    await runReportExport();
    expect(await notifyExportReady(id)).toBe("already_notified");
    expect(sent).toHaveLength(0);

    // Its lease runs out: the next run sends it, once.
    await db.execute(sql`UPDATE report_export
      SET notify_claimed_at = now() - make_interval(secs => ${exportNotifyLease.ms / 1000 + 60})
      WHERE id = ${id}`);
    await runReportExport();
    await runReportExport();
    expect(sent).toHaveLength(1);
    const [row] = (
      await db.execute<{
        notified: boolean;
        claimed: boolean;
      }>(sql`SELECT notified_at IS NOT NULL AS notified, notify_claimed_at IS NOT NULL AS claimed
        FROM report_export WHERE id = ${id}`)
    ).rows;
    expect(row).toEqual({ notified: true, claimed: false });
  });
});
