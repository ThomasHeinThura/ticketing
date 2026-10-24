/**
 * RP-9: closed periods are read from `metric_snapshot` (written by the `metrics-snapshot` job), the
 * current partial day is computed live, and the boundary is stated. A snapshot-backed report must
 * equal the live one over the same data, never read across tenants and keep the caller's reach.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  metricSnapshotDayTable,
  metricSnapshotTable,
  reportExportTable,
} from "../../apps/api/src/database/schema-p5-reports";
import { resolveRequestIdentity } from "../../apps/api/src/permissions/resolve-request-identity";
import { resolveWindow } from "../../apps/api/src/report/logic";
import { reportByKey } from "../../apps/api/src/report/registry";
import { runReport } from "../../apps/api/src/report/run";
import { runMetricsSnapshot } from "../../apps/api/src/scheduler/report-jobs";
import { resetTestDatabase } from "./helpers/database";
import { workItemWorld } from "./helpers/p4-closeout";
import {
  type ReportsWorld,
  reportsWorld,
  setFeature,
} from "./helpers/p5-reports";

let w: ReportsWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await reportsWorld();
});

type User = Parameters<ReportsWorld["get"]>[0];

async function run(
  user: User,
  key: string,
  input: {
    window?: string;
    from?: string;
    to?: string;
    filters?: Record<string, string>;
    options?: Record<string, string>;
    snapshots: boolean;
    now: Date;
    readAll?: boolean;
    workspaceId?: string;
  },
) {
  const identity = await resolveRequestIdentity({ userId: user.id });
  if (!identity) throw new Error("identity");
  const resolved = resolveWindow(
    { window: input.window, from: input.from, to: input.to },
    input.now,
  );
  if (!resolved.ok) throw new Error(resolved.reason);
  return runReport({
    def: reportByKey(key) as NonNullable<ReturnType<typeof reportByKey>>,
    workspaceId: input.workspaceId ?? w.workspaceId,
    identity,
    caps: {
      readAll: input.readAll ?? true,
      showRates: false,
      readAnyTime: true,
    },
    window: resolved.window,
    filters: input.filters ?? {},
    options: input.options ?? {},
    now: input.now,
    snapshots: input.snapshots,
  });
}

/** Everything a report says except where it read from. */
function numbers(envelope: Awaited<ReturnType<typeof run>>) {
  return {
    metrics: envelope.metrics,
    rows: envelope.rows,
    chart: envelope.chart,
    population: envelope.empty,
  };
}

async function seed() {
  // Resolved on closed days 1..20 days ago, in both projects' priorities, plus items today.
  for (let day = 1; day <= 20; day += 1) {
    await w.addItem({
      createdDaysAgo: day + 3,
      resolvedDaysAgo: day,
      priority: day % 2 === 0 ? "high" : "low",
      sla: { state: day % 3 === 0 ? "missed" : "met" },
    });
    await w.addItem({
      createdDaysAgo: day + 2,
      resolvedDaysAgo: day,
      priority: "urgent",
      sla: { state: "met" },
    });
  }
  await w.addItem({
    createdDaysAgo: 1,
    resolvedDaysAgo: 0,
    priority: "high",
    sla: { state: "met" },
  });
}

/** A completed item of the other workspace, so the snapshots have something foreign to leak. */
async function strangerCompletedItem(daysAgo: number) {
  const world = await workItemWorld(
    w.stranger.workspace.id,
    w.strangerProject.id,
  );
  const item = await world.makeItem("Foreign completed item");
  const [template] = await db
    .insert(schema.stateTemplateTable)
    .values({
      workspaceId: w.stranger.workspace.id,
      key: `st-${randomUUID()}`,
      name: "Done",
      group: "completed",
    })
    .returning();
  const [state] = await db
    .insert(schema.stateTable)
    .values({
      projectId: w.strangerProject.id,
      stateTemplateId: (template as NonNullable<typeof template>).id,
    })
    .returning();
  await db
    .update(schema.workItemTable)
    .set({
      stateId: (state as NonNullable<typeof state>).id,
      resolvedAt: new Date(Date.now() - daysAgo * 86_400_000),
    })
    .where(eq(schema.workItemTable.id, item.id));
}

const KEYS = ["sla_attainment", "sla_trend", "throughput"] as const;

describe("the metrics-snapshot job", () => {
  it("writes closed days only, with a marker per day, and is idempotent", async () => {
    await seed();
    const now = new Date();
    const first = await runMetricsSnapshot(now);
    expect(first.degraded).toBe(false);
    expect(first.days).toBeGreaterThanOrEqual(3);
    const days = await db
      .select()
      .from(metricSnapshotDayTable)
      .where(eq(metricSnapshotDayTable.workspaceId, w.workspaceId));
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    expect(days.length).toBeGreaterThan(0);
    // Today is never stored: it is not a closed period.
    expect(days.every((day) => day.periodStart < today)).toBe(true);
    const dump = async () =>
      (
        await db.execute<
          Record<string, unknown>
        >(sql`SELECT workspace_id, metric_key, project_id,
          to_char(period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, dimensions::text AS dimensions,
          measures::text AS measures
        FROM metric_snapshot WHERE workspace_id = ${w.workspaceId}
        ORDER BY metric_key, day, project_id, dimensions::text`)
      ).rows;
    const before = await dump();
    expect(before.length).toBeGreaterThan(0);
    await runMetricsSnapshot(now);
    await runMetricsSnapshot(now);
    expect(await dump()).toEqual(before);
  });

  it("stores nothing for a workspace with reports switched off, and none of another tenant's data in this one", async () => {
    await seed();
    await strangerCompletedItem(3);
    await setFeature(w.stranger.workspace.id, "feature.reports", false);
    await runMetricsSnapshot(new Date());
    const strangerRows = await db
      .select()
      .from(metricSnapshotTable)
      .where(eq(metricSnapshotTable.workspaceId, w.stranger.workspace.id));
    expect(strangerRows).toHaveLength(0);
    const mine = await db
      .select()
      .from(metricSnapshotTable)
      .where(eq(metricSnapshotTable.workspaceId, w.workspaceId));
    expect(mine.length).toBeGreaterThan(0);
    // Every stored row points at a project of its own workspace.
    const crossed = await db.execute<{
      n: number;
    }>(sql`SELECT count(*)::int AS n
      FROM metric_snapshot ms JOIN project p ON p.id = ms.project_id
      WHERE p.workspace_id <> ms.workspace_id`);
    expect(crossed.rows[0]?.n).toBe(0);
  });

  it("removes a project's snapshot rows with the project", async () => {
    await seed();
    await runMetricsSnapshot(new Date());
    const rows = () =>
      db
        .select()
        .from(metricSnapshotTable)
        .where(
          and(
            eq(metricSnapshotTable.workspaceId, w.workspaceId),
            eq(metricSnapshotTable.projectId, w.projectA.id),
          ),
        );
    expect((await rows()).length).toBeGreaterThan(0);
    await db.execute(sql`DELETE FROM project WHERE id = ${w.projectA.id}`);
    expect(await rows()).toHaveLength(0);
  });
});

describe("deleting what snapshots and exports hang from", () => {
  it("removes the snapshots, their day markers and the exports of a deleted workspace without a foreign key error", async () => {
    await strangerCompletedItem(3);
    await runMetricsSnapshot(new Date());
    const strangerId = w.stranger.workspace.id;
    const count = async (table: string) =>
      (
        await db.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE workspace_id = ${strangerId}`,
        )
      ).rows[0]?.n;
    expect(await count("metric_snapshot")).toBeGreaterThan(0);
    expect(await count("metric_snapshot_day")).toBeGreaterThan(0);
    const [person] = (
      await db.execute<{ id: string }>(
        sql`SELECT id FROM person WHERE user_id = ${w.stranger.user.id} LIMIT 1`,
      )
    ).rows;
    await db.insert(reportExportTable).values({
      workspaceId: strangerId,
      personId: person?.id ?? "",
      userId: w.stranger.user.id,
      kind: "report",
      reportKey: "throughput",
      title: "Throughput",
      spec: {},
      caps: {},
    });
    expect(await count("report_export")).toBe(1);
    await db.execute(sql`DELETE FROM workspace WHERE id = ${strangerId}`);
    expect(await count("metric_snapshot")).toBe(0);
    expect(await count("metric_snapshot_day")).toBe(0);
    expect(await count("report_export")).toBe(0);
  });
});

describe("closed periods read from snapshots (RP-9)", () => {
  it("is the same as a live run for the SLA and throughput reports, over every window and filter", async () => {
    await seed();
    const now = new Date();
    await runMetricsSnapshot(now);
    const cases = [
      { window: "7" },
      { window: "30" },
      { window: "90" },
      { window: "30", filters: { priority: "high" } },
      { window: "30", filters: { projectId: w.projectA.id } },
      { window: "30", filters: { typeId: w.itemA.typeId } },
      { window: "30", filters: { organisationId: w.customer.orgId } },
      {
        window: "60",
        filters: { priority: "urgent", projectId: w.projectA.id },
      },
      { window: "30", options: { metric: "first_response" } },
    ];
    for (const key of KEYS) {
      for (const input of cases) {
        const stored = await run(w.owner.user, key, {
          ...input,
          snapshots: true,
          now,
        });
        const live = await run(w.owner.user, key, {
          ...input,
          snapshots: false,
          now,
        });
        expect(numbers(stored), `${key} ${JSON.stringify(input)}`).toEqual(
          numbers(live),
        );
      }
    }
  });

  it("states the boundary: mixed with the current day, snapshot for a closed custom window, live without snapshots or with a team filter", async () => {
    await seed();
    const now = new Date();
    const before = await run(w.owner.user, "sla_attainment", {
      window: "30",
      snapshots: true,
      now,
    });
    // No job has run: every period is live, and it says so.
    expect(before.boundary).toBe("live");
    expect(before.snapshot).toBeNull();
    await runMetricsSnapshot(now);
    const mixed = await run(w.owner.user, "sla_attainment", {
      window: "30",
      snapshots: true,
      now,
    });
    expect(mixed.boundary).toBe("mixed");
    expect(mixed.snapshot?.closedDays).toBeGreaterThan(0);
    // The count is about the window shown (29 whole closed days before today), never its comparison period.
    expect(
      (mixed.snapshot?.closedDays ?? 0) + (mixed.snapshot?.uncoveredDays ?? 0),
    ).toBe(mixed.window.days - 1);
    expect(mixed.snapshot?.computedAt).not.toBeNull();
    expect(mixed.snapshot?.through).not.toBeNull();
    const day = (n: number) =>
      new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
    const closed = await run(w.owner.user, "throughput", {
      window: "custom",
      from: day(15),
      to: day(5),
      snapshots: true,
      now,
    });
    // Every day of a custom window that ended before today is closed: stored, with no live part.
    expect(closed.snapshot?.closedDays).toBe(11);
    expect(closed.snapshot?.uncoveredDays).toBe(0);
    expect(closed.boundary).toBe("snapshot");
    const off = await run(w.owner.user, "sla_attainment", {
      window: "30",
      snapshots: false,
      now,
    });
    expect(off.boundary).toBe("live");
    const team = await run(w.owner.user, "sla_attainment", {
      window: "30",
      filters: { teamId: "no-such-team" },
      snapshots: true,
      now,
    });
    expect(team.boundary).toBe("live");
  });

  it("reads the stored day until the job runs again, then follows the data", async () => {
    await seed();
    const now = new Date();
    await runMetricsSnapshot(now);
    const read = (snapshots: boolean) =>
      run(w.owner.user, "throughput", {
        window: "30",
        snapshots,
        now,
      }).then((envelope) => envelope.metrics[0]?.value);
    const baseline = await read(true);
    // A day older than the three-day lookback: stored, so a late change does not show...
    await w.addItem({
      createdDaysAgo: 12,
      resolvedDaysAgo: 8,
      sla: { state: "met" },
    });
    expect(await read(true)).toBe(baseline);
    expect(await read(false)).toBe((baseline ?? 0) + 1);
    // ...while a day inside the lookback is refreshed by the next run.
    await w.addItem({
      createdDaysAgo: 5,
      resolvedDaysAgo: 2,
      sla: { state: "met" },
    });
    await runMetricsSnapshot(now);
    expect(await read(true)).toBe((baseline ?? 0) + 1);
  });

  it("keeps the caller's reach on stored days (a member who reaches no project sees none of it)", async () => {
    await seed();
    const now = new Date();
    await runMetricsSnapshot(now);
    const outsider = await run(w.outsider.user, "throughput", {
      window: "30",
      readAll: false,
      snapshots: true,
      now,
    });
    const outsiderLive = await run(w.outsider.user, "throughput", {
      window: "30",
      readAll: false,
      snapshots: false,
      now,
    });
    expect(outsider.metrics[0]?.value).toBe(0);
    expect(numbers(outsider)).toEqual(numbers(outsiderLive));
    const member = await run(w.member.user, "throughput", {
      window: "30",
      readAll: false,
      snapshots: true,
      now,
    });
    const memberLive = await run(w.member.user, "throughput", {
      window: "30",
      readAll: false,
      snapshots: false,
      now,
    });
    expect(Number(member.metrics[0]?.value)).toBeGreaterThan(0);
    expect(numbers(member)).toEqual(numbers(memberLive));
  });

  it("does not count another workspace's items from the snapshots", async () => {
    await seed();
    await strangerCompletedItem(4);
    const now = new Date();
    await runMetricsSnapshot(now);
    const stranger = await run(w.stranger.user, "throughput", {
      window: "30",
      snapshots: true,
      now,
      workspaceId: w.stranger.workspace.id,
    });
    // The stranger's own item is theirs alone; this workspace's twenty-one are not in their number.
    expect(stranger.metrics[0]?.value).toBe(1);
    const mine = await run(w.owner.user, "throughput", {
      window: "30",
      snapshots: true,
      now,
    });
    expect(mine.metrics[0]?.value).toBe(41);
  });

  it("serves the stored boundary over HTTP", async () => {
    await seed();
    await runMetricsSnapshot(new Date());
    const { body } = await w.report(w.owner.user, "throughput", "&window=30");
    expect(body).toMatchObject({ key: "throughput" });
    expect((body as unknown as { boundary: string }).boundary).toBe("mixed");
    const snapshot = (
      body as unknown as { snapshot: { closedDays: number } | null }
    ).snapshot;
    expect(snapshot?.closedDays).toBeGreaterThan(0);
  });
});
