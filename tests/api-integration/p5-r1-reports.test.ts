/**
 * P5 round-1 review fixes for reports: paged exports of in-memory reports (P5-R1-01), live facts
 * that include today (P5-R1-02), per-day snapshot invalidation without a workspace lock
 * (P5-R1-03), the cost-to-deliver drill without a currency for a caller who may not see rates
 * (P5-R1-05) and the workspace-dashboard delete that re-checks the approver's right (P5-R1-09).
 */
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  dashboardTable,
  metricSnapshotDayTable,
} from "../../apps/api/src/database/schema-p5-reports";
import {
  costEntryTable,
  costTypeTable,
  timeEntryTable,
} from "../../apps/api/src/database/schema-p5-time";
import { resolveRequestIdentity } from "../../apps/api/src/permissions/resolve-request-identity";
import { dashboardDeletionTarget } from "../../apps/api/src/report/deletion-target";
import { exportLimits } from "../../apps/api/src/report/export.service";
import { dayKey, utcDayStart } from "../../apps/api/src/report/snapshot.logic";
import { writeWorkspaceDays } from "../../apps/api/src/report/snapshot.repository";
import { liveFactRows } from "../../apps/api/src/report/snapshot-facts";
import {
  runMetricsSnapshot,
  runReportExport,
} from "../../apps/api/src/scheduler/report-jobs";
import { resetTestDatabase } from "./helpers/database";
import { insertArticle } from "./helpers/p5-kb";
import { type ReportsWorld, reportsWorld } from "./helpers/p5-reports";
import { isoDaysAgo, personIdOf } from "./helpers/p5-time";

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
  error: string | null;
};

const post = (user: User, path: string, body: Record<string, unknown>) =>
  w.get(user, path, {
    method: "POST",
    body: { workspaceId: w.workspaceId, ...body },
  });

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

async function download(user: User, id: string): Promise<string> {
  const response = await w.get(user, `/api/report-exports/${id}/download`);
  expect(response.status).toBe(200);
  return await response.text();
}

const dataLines = (csv: string) =>
  csv.split("\r\n").filter((line) => line.length > 0 && !/^"?#/.test(line));

/** `count` customers, each with a project, one work item created in the window and one rating. */
async function seedCustomers(count: number) {
  // The report fixture creates its project states on demand.
  await w.addItem({ createdDaysAgo: 4, title: "Seed item" });
  await db.execute(sql`INSERT INTO organisation (id, key, name)
    SELECT 'bulk-org-' || g, 'bulk-org-' || g, 'Bulk customer ' || lpad(g::text, 4, '0')
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

async function seedArticles(count: number) {
  const base = await insertArticle(w.workspaceId, {
    authorId: w.ownerPersonId,
    title: "Base article",
  });
  await db.execute(sql`INSERT INTO kb_article
    SELECT (jsonb_populate_record(NULL::kb_article, to_jsonb(a) || jsonb_build_object(
      'id', 'bulk-article-' || g, 'title', 'Bulk article ' || lpad(g::text, 4, '0')))).*
    FROM kb_article a CROSS JOIN generate_series(1, ${count}) g WHERE a.id = ${base.id}`);
  await db.execute(sql`INSERT INTO deflection_event (id, workspace_id, person_id, kb_article_id, created_at)
    SELECT 'bulk-deflection-' || g, ${w.workspaceId}, ${w.customer.person.id}, 'bulk-article-' || g, now() - interval '2 days'
    FROM generate_series(1, ${count}) g`);
}

describe("paged exports of reports built in memory (P5-R1-01)", () => {
  const COUNT = 270;
  // The page size is 5,000 since P5-R2-02; 250-row pages keep these exports multi-page.
  const limitsBefore = { ...exportLimits };
  beforeEach(() => {
    exportLimits.pageSize = 250;
  });
  afterEach(() => {
    Object.assign(exportLimits, limitsBefore);
  });

  const exported = async (path: string, body: Record<string, unknown> = {}) => {
    const queued = await post(w.owner.user, path, { window: "30", ...body });
    expect(queued.status, await queued.clone().text()).toBe(202);
    const { data } = (await queued.json()) as { data: { id: string } };
    return { id: data.id, done: await settle(w.owner.user, data.id) };
  };

  for (const key of [
    "customer_performance",
    "customer_volume_trend",
    "satisfaction",
  ]) {
    it(`${key}: every customer exactly once across more than one page`, async () => {
      await seedCustomers(COUNT);
      const { id, done } = await exported(`/api/reports/${key}/export`);
      expect(done.status, done.error ?? "").toBe("ready");
      const lines = dataLines(await download(w.owner.user, id));
      // The header line, then one row per customer: at least the bulk customers, none twice.
      const rows = lines.slice(1);
      expect(rows.length).toBe(done.rowCount);
      expect(rows.length).toBeGreaterThanOrEqual(COUNT);
      const customers = rows.map((line) => line.split(",")[0]);
      expect(new Set(customers).size).toBe(customers.length);
      for (const n of [1, 137, COUNT])
        expect(customers).toContain(
          `Bulk customer ${String(n).padStart(4, "0")}`,
        );
    });
  }

  it("kb_deflection: every article exactly once across more than one page", async () => {
    await seedArticles(COUNT);
    const { id, done } = await exported("/api/reports/kb_deflection/export");
    expect(done.status, done.error ?? "").toBe("ready");
    const rows = dataLines(await download(w.owner.user, id)).slice(1);
    expect(rows.length).toBe(done.rowCount);
    expect(rows.length).toBeGreaterThanOrEqual(COUNT);
    const titles = rows.map((line) => line.split(",")[0]);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("fails an export that outruns the page ceiling with export_too_large, not a loop", async () => {
    await seedCustomers(COUNT);
    const before = { ...exportLimits };
    exportLimits.maxPages = 1;
    try {
      const { done } = await exported(
        "/api/reports/customer_performance/export",
      );
      expect(done.status).toBe("failed");
      expect(done.error).toBe("export_too_large");
    } finally {
      Object.assign(exportLimits, before);
    }
  });

  it("fails an export that outruns the byte ceiling with export_too_large", async () => {
    await seedCustomers(COUNT);
    const before = { ...exportLimits };
    exportLimits.maxBytes = 1_000;
    try {
      const { done } = await exported(
        "/api/reports/customer_performance/export",
      );
      expect(done.status).toBe("failed");
      expect(done.error).toBe("export_too_large");
    } finally {
      Object.assign(exportLimits, before);
    }
  });
});

describe("live time and cost facts include today (P5-R1-02)", () => {
  it("counts time and cost logged today in the report, in the live facts and in the drill", async () => {
    const now = new Date();
    const today = isoDaysAgo(0, now);
    const personId = await personIdOf(w.owner.user.id);
    await db.insert(timeEntryTable).values({
      workspaceId: w.workspaceId,
      projectId: w.projectA.id,
      personId,
      date: today,
      minutes: 90,
      activityId: w.dev.id,
      billable: true,
      rateMinor: 6000,
      currency: "USD",
    });
    const [costType] = await db
      .insert(costTypeTable)
      .values({
        workspaceId: w.workspaceId,
        name: "Today materials",
        currency: "USD",
      })
      .returning();
    await db.insert(costEntryTable).values({
      workspaceId: w.workspaceId,
      projectId: w.projectA.id,
      costTypeId: costType?.id ?? "",
      personId,
      date: today,
      units: 2,
      rateMinor: 1250,
      amountMinor: 2500,
      currency: "USD",
      billable: true,
      createdBy: w.owner.user.id,
    });
    const from = utcDayStart(new Date(now.getTime() - 3 * 86_400_000));
    const time = await liveFactRows("time_logged", w.workspaceId, from, now);
    expect(time.filter((row) => row.day === today)).toHaveLength(1);
    expect(time.find((row) => row.day === today)?.measures.minutes).toBe(90);
    const cost = await liveFactRows("cost_entry", w.workspaceId, from, now);
    expect(cost.find((row) => row.day === today)?.measures.amountMinor).toBe(
      2500,
    );

    // The same hours through the report and through its drill.
    const { body } = await w.report(w.owner.user, "time_logged", "&window=7");
    expect(body.metrics.find((m) => m.key === "hours")?.value).toBe(1.5);
    const drill = await w.get(
      w.owner.user,
      `/api/reports/time_logged/items?workspaceId=${w.workspaceId}&window=7&limit=100`,
    );
    expect(drill.status, await drill.clone().text()).toBe(200);
    const items = ((await drill.json()) as { data: Array<{ hours?: number }> })
      .data;
    expect(items.reduce((sum, item) => sum + (item.hours ?? 0), 0)).toBe(1.5);
  });
});

describe("snapshot invalidation is per day and takes no workspace lock (P5-R1-03)", () => {
  async function markers() {
    const rows = await db
      .select()
      .from(metricSnapshotDayTable)
      .where(eq(metricSnapshotDayTable.workspaceId, w.workspaceId));
    return new Set(rows.map((row) => dayKey(row.periodStart)));
  }

  async function seedTwo() {
    const now = new Date();
    const older = await w.addItem({
      createdDaysAgo: 21,
      resolvedDaysAgo: 18,
      priority: "high",
    });
    const newer = await w.addItem({
      createdDaysAgo: 11,
      resolvedDaysAgo: 9,
      priority: "low",
    });
    await runMetricsSnapshot(now);
    return { now, older, newer };
  }

  it("a state change invalidates only the days of that item", async () => {
    const { older, newer } = await seedTwo();
    const before = await markers();
    expect(before.size).toBeGreaterThan(10);
    await db
      .update(schema.workItemTable)
      .set({ priority: "urgent" })
      .where(eq(schema.workItemTable.id, older.id));
    const after = await markers();
    const dayOf = (date: Date | null) => dayKey(utcDayStart(date as Date));
    const dropped = [...before].filter((day) => !after.has(day));
    expect(dropped.sort()).toEqual(
      [...new Set([dayOf(older.createdAt), dayOf(older.resolvedAt)])].sort(),
    );
    expect(after.has(dayOf(newer.createdAt))).toBe(true);
    expect(after.has(dayOf(newer.resolvedAt))).toBe(true);
  });

  it("unrelated writes leave every closed day served from its snapshot", async () => {
    const { older } = await seedTwo();
    const before = await markers();
    // A title is not part of any fact; a project rename is not either.
    await db
      .update(schema.workItemTable)
      .set({ title: "Renamed" })
      .where(eq(schema.workItemTable.id, older.id));
    await db
      .update(schema.projectTable)
      .set({ name: "Renamed project" })
      .where(eq(schema.projectTable.id, w.projectA.id));
    // A new item today feeds only today, which is never stored.
    await w.addItem({ createdDaysAgo: 0 });
    expect(await markers()).toEqual(before);
  });

  it("a change that can reach any day invalidates by epoch, and the next run restores coverage", async () => {
    const { now } = await seedTwo();
    const covered = async () =>
      (
        await db.execute<{ n: string }>(sql`SELECT count(*) AS n
          FROM metric_snapshot_day d
          WHERE d.workspace_id = ${w.workspaceId}
            AND d.epoch = COALESCE((SELECT e.epoch FROM metric_snapshot_epoch e
              WHERE e.workspace_id = d.workspace_id), 0)`)
      ).rows[0]?.n;
    expect(Number(await covered())).toBeGreaterThan(10);
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, w.projectB.id));
    expect(Number(await covered())).toBe(0);
    await runMetricsSnapshot(now);
    expect(Number(await covered())).toBeGreaterThan(10);
  });

  it("a source write does not wait for the writer of another day, and the writer does not wait for a busy day", async () => {
    const { older, newer } = await seedTwo();
    const busyDay = dayKey(utcDayStart(older.resolvedAt as Date));
    const otherDay = dayKey(utcDayStart(newer.resolvedAt as Date));
    const lockOf = (day: string) =>
      sql`SELECT pg_advisory_xact_lock(hashtext(${`metric_snapshot_day:${w.workspaceId}:${day}`}))`;

    // 1. A writer holds the exclusive lock of one day: a write feeding another day goes through.
    let releaseWriter: () => void = () => {};
    const writerHolds = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    let writerLocked: () => void = () => {};
    const locked = new Promise<void>((resolve) => {
      writerLocked = resolve;
    });
    const writer = db.transaction(async (tx) => {
      await tx.execute(lockOf(busyDay));
      writerLocked();
      await writerHolds;
    });
    await locked;
    const update = db
      .update(schema.workItemTable)
      .set({ priority: "urgent" })
      .where(eq(schema.workItemTable.id, newer.id));
    const outcome = await Promise.race([
      update.then(() => "done"),
      new Promise((resolve) => setTimeout(() => resolve("waited"), 3_000)),
    ]);
    expect(outcome).toBe("done");
    releaseWriter();
    await writer;

    // 2. A source write holds the shared lock of a day: the writer skips that day, never waits.
    let releaseSource: () => void = () => {};
    const sourceHolds = new Promise<void>((resolve) => {
      releaseSource = resolve;
    });
    let sourceLocked: () => void = () => {};
    const sourceTouched = new Promise<void>((resolve) => {
      sourceLocked = resolve;
    });
    const source = db.transaction(async (tx) => {
      await tx
        .update(schema.workItemTable)
        .set({ priority: "low" })
        .where(eq(schema.workItemTable.id, older.id));
      sourceLocked();
      await sourceHolds;
    });
    await sourceTouched;
    const skipped = await Promise.race([
      writeWorkspaceDays(w.workspaceId, [busyDay], new Date()),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
    ]);
    expect(skipped).toEqual({ days: 0, rows: 0 });
    releaseSource();
    await source;
    const written = await writeWorkspaceDays(w.workspaceId, [
      busyDay,
      otherDay,
    ]);
    expect(written.days).toBe(2);
    expect((await markers()).has(busyDay)).toBe(true);
  });
});

describe("the cost-to-deliver drill carries no currency without rates (P5-R1-05)", () => {
  it("strips currency for a caller who may not see rates and keeps it for one who may", async () => {
    const personId = await personIdOf(w.owner.user.id);
    await db.insert(timeEntryTable).values({
      workspaceId: w.workspaceId,
      projectId: w.projectA.id,
      personId,
      date: isoDaysAgo(1),
      minutes: 60,
      activityId: w.dev.id,
      billable: true,
      rateMinor: 6000,
      currency: "USD",
    });
    const path = `/api/reports/cost_to_deliver/items?workspaceId=${w.workspaceId}&window=30&limit=100`;
    const without = await w.get(w.lead.user, path);
    expect(without.status, await without.clone().text()).toBe(200);
    const hidden = (
      (await without.json()) as { data: Array<Record<string, unknown>> }
    ).data;
    expect(hidden.length).toBeGreaterThan(0);
    for (const item of hidden) expect(item).not.toHaveProperty("currency");
    const shown = await w.get(w.owner.user, path);
    expect(shown.status).toBe(200);
    const own = (
      (await shown.json()) as { data: Array<Record<string, unknown>> }
    ).data;
    expect(own.map((item) => item.currency)).toContain("USD");
  });
});

describe("a workspace dashboard is deleted only by someone who holds manage_settings now (P5-R1-09)", () => {
  it("refuses at execution an approver who lost the right, and deletes for one who holds it", async () => {
    const [dashboard] = await db
      .insert(dashboardTable)
      .values({
        workspaceId: w.workspaceId,
        ownerId: null,
        name: "Shared board",
        scope: "workspace",
      })
      .returning();
    if (!dashboard) throw new Error("dashboard missing");
    const identityOf = async (userId: string) => {
      const identity = await resolveRequestIdentity({ userId });
      if (!identity) throw new Error("identity");
      return identity;
    };
    const attempt = (userId: string) =>
      db.transaction(async (tx) =>
        dashboardDeletionTarget.execute(
          tx as never,
          {
            loaded: { id: dashboard.id },
            identity: await identityOf(userId),
          } as never,
        ),
      );
    await expect(attempt(w.member.user.id)).rejects.toMatchObject({
      status: 403,
    });
    expect(
      await db
        .select()
        .from(dashboardTable)
        .where(and(eq(dashboardTable.id, dashboard.id))),
    ).toHaveLength(1);
    await attempt(w.owner.user.id);
    expect(
      await db
        .select()
        .from(dashboardTable)
        .where(eq(dashboardTable.id, dashboard.id)),
    ).toHaveLength(0);
  });
});
