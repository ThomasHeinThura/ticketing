/**
 * RP-9: closed periods are read from `metric_snapshot` (written by the `metrics-snapshot` job), the
 * current partial day is computed live, and the boundary is stated. A snapshot-backed report must
 * equal the live one over the same data, never read across tenants and keep the caller's reach.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { slaEscalationTable } from "../../apps/api/src/database/schema";
import {
  cycleSnapshotTable,
  cycleTable,
} from "../../apps/api/src/database/schema-p5-agile";
import { deflectionEventTable } from "../../apps/api/src/database/schema-p5-kb";
import {
  metricSnapshotDayTable,
  metricSnapshotTable,
  reportExportTable,
} from "../../apps/api/src/database/schema-p5-reports";
import {
  budgetTable,
  costEntryTable,
  costTypeTable,
  timeEntryTable,
} from "../../apps/api/src/database/schema-p5-time";
import { resolveRequestIdentity } from "../../apps/api/src/permissions/resolve-request-identity";
import { resolveWindow } from "../../apps/api/src/report/logic";
import { reportByKey } from "../../apps/api/src/report/registry";
import { runReport } from "../../apps/api/src/report/run";
import {
  addDays,
  dayKey,
  SNAPSHOT_FAMILY_VERSION,
  SNAPSHOT_METRICS,
  utcDayStart,
} from "../../apps/api/src/report/snapshot.logic";
import {
  pruneSnapshots,
  writeWorkspaceDays,
} from "../../apps/api/src/report/snapshot.repository";
import { runMetricsSnapshot } from "../../apps/api/src/scheduler/report-jobs";
import { resetTestDatabase } from "./helpers/database";
import { makeTeam, workItemWorld } from "./helpers/p4-closeout";
import { insertArticle } from "./helpers/p5-kb";
import {
  daysAgo,
  type ReportsWorld,
  reportsWorld,
  setFeature,
} from "./helpers/p5-reports";
import { isoDaysAgo, personIdOf } from "./helpers/p5-time";

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
    showRates?: boolean;
    readAnyTime?: boolean;
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
      showRates: input.showRates ?? false,
      readAnyTime: input.readAnyTime ?? true,
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
    expect(
      days.every((day) => day.snapshotVersion === SNAPSHOT_FAMILY_VERSION),
    ).toBe(true);
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
    const cases: Array<
      Pick<Parameters<typeof run>[2], "window" | "filters" | "options">
    > = [
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

  it("covers every v2 fact family and preserves report parity across filters and privacy scopes", async () => {
    const now = new Date();
    const ownerPersonId = w.ownerPersonId;
    const memberPersonId = await personIdOf(w.member.user.id);
    const team = await makeTeam(w.workspaceId, [
      w.owner.user.id,
      w.member.user.id,
    ]);
    const item = await w.addItem({
      createdDaysAgo: 8,
      resolvedDaysAgo: 4,
      priority: "high",
      assigneeId: ownerPersonId,
      sla: { state: "missed", dueDaysAhead: -5 },
    });
    await db
      .update(schema.workItemTable)
      .set({ firstResponseAt: daysAgo(4, now) })
      .where(eq(schema.workItemTable.id, item.id));
    await db.insert(schema.workItemSlaCacheTable).values({
      workItemId: item.id,
      metric: "first_response",
      state: "met",
      dueAt: daysAgo(4, now),
      computedAt: now,
    });
    const [rating] = await db
      .insert(schema.satisfactionRatingTable)
      .values({
        workItemId: item.id,
        personId: w.customer.person.id,
        score: 4,
        createdAt: daysAgo(3, now),
      })
      .returning();

    const entryDate = isoDaysAgo(3, now);
    await db.insert(timeEntryTable).values([
      {
        workspaceId: w.workspaceId,
        projectId: w.projectA.id,
        workItemId: item.id,
        personId: ownerPersonId,
        date: entryDate,
        minutes: 120,
        activityId: w.dev.id,
        billable: true,
        rateMinor: 6000,
        currency: "USD",
      },
      {
        workspaceId: w.workspaceId,
        projectId: w.projectA.id,
        workItemId: item.id,
        personId: memberPersonId,
        date: entryDate,
        minutes: 45,
        activityId: w.dev.id,
        billable: false,
        rateMinor: 3000,
        currency: "USD",
      },
    ]);
    const [costType] = await db
      .insert(costTypeTable)
      .values({
        workspaceId: w.workspaceId,
        name: "Snapshot materials",
        currency: "USD",
      })
      .returning();
    await db.insert(costEntryTable).values({
      workspaceId: w.workspaceId,
      projectId: w.projectA.id,
      workItemId: item.id,
      costTypeId: costType?.id ?? "",
      personId: ownerPersonId,
      date: entryDate,
      units: 2,
      rateMinor: 1250,
      amountMinor: 2500,
      currency: "USD",
      billable: true,
      createdBy: w.owner.user.id,
    });
    await db.insert(budgetTable).values({
      workspaceId: w.workspaceId,
      projectId: w.projectA.id,
      name: "Snapshot budget",
      plannedAmountMinor: 50_000,
      currency: "USD",
      periodStart: isoDaysAgo(20, now),
      periodEnd: isoDaysAgo(0, now),
      createdBy: w.owner.user.id,
    });
    await db.insert(slaEscalationTable).values({
      workspaceId: w.workspaceId,
      projectId: w.projectA.id,
      workItemId: item.id,
      metric: "resolution",
      triggerEventId: `snapshot-${randomUUID()}`,
      stateIdAtStart: item.stateId,
      assigneeIdAtStart: ownerPersonId,
      lastOrder: 1,
      state: "stopped",
      stopReason: "resolved",
      startedAt: daysAgo(3, now),
      updatedAt: daysAgo(3, now),
    });

    const globalArticle = await insertArticle(w.workspaceId, {
      title: "Workspace-wide snapshot article",
      state: "published",
      projectId: null,
      createdAt: daysAgo(3, now),
    });
    await db.insert(deflectionEventTable).values({
      workspaceId: w.workspaceId,
      personId: w.customer.person.id,
      kbArticleId: globalArticle.id,
      requestTypeId: null,
      query: "",
      createdAt: daysAgo(3, now),
      abandonedAt: daysAgo(3, now),
    });

    const completedAt = daysAgo(3, now);
    const [cycle] = await db
      .insert(cycleTable)
      .values({
        workspaceId: w.workspaceId,
        projectId: w.projectA.id,
        name: "Snapshot cycle",
        startDate: isoDaysAgo(10, now),
        endDate: isoDaysAgo(3, now),
        completedAt,
        completedBy: w.owner.user.id,
      })
      .returning();
    await db.insert(cycleSnapshotTable).values({
      cycleId: cycle?.id ?? "",
      date: isoDaysAgo(3, now),
      unit: "points",
      scopePoints: "5",
      completedPoints: "4",
      itemCount: 2,
      completedCount: 1,
      unestimatedCount: 1,
      summary: { privateNote: "must not be stored in report facts" },
    });

    await runMetricsSnapshot(now);
    const marker = await db
      .select()
      .from(metricSnapshotDayTable)
      .where(eq(metricSnapshotDayTable.workspaceId, w.workspaceId));
    expect(marker.length).toBeGreaterThan(0);
    expect(
      marker.every((day) => day.snapshotVersion === SNAPSHOT_FAMILY_VERSION),
    ).toBe(true);
    const familyRows = await db.execute<{ metric_key: string }>(sql`
      SELECT DISTINCT metric_key FROM metric_snapshot WHERE workspace_id = ${w.workspaceId}
    `);
    expect(familyRows.rows.map((row) => row.metric_key).sort()).toEqual(
      [...SNAPSHOT_METRICS].sort(),
    );
    const rawFacts = await db.execute<{
      dimensions: string;
      measures: string;
    }>(sql`
      SELECT dimensions::text AS dimensions, measures::text AS measures
      FROM metric_snapshot WHERE workspace_id = ${w.workspaceId}
    `);
    const rawPayload = JSON.stringify(rawFacts.rows);
    expect(rawPayload).not.toContain("Workspace-wide snapshot article");
    expect(rawPayload).not.toContain("privateNote");
    expect(rawPayload).not.toContain(w.owner.user.name);

    const parityReports = [
      "sla_attainment",
      "sla_trend",
      "throughput",
      "work_mix",
      "cycle_time",
      "customer_performance",
      "customer_volume_trend",
      "satisfaction",
      "breach_analysis",
      "time_logged",
      "utilisation",
      "cost_to_deliver",
      "escalations",
      "kb_deflection",
      "predictability",
    ];
    for (const key of parityReports) {
      const rates = key === "time_logged" || key === "cost_to_deliver";
      const stored = await run(w.owner.user, key, {
        window: "30",
        snapshots: true,
        now,
        showRates: rates,
      });
      const live = await run(w.owner.user, key, {
        window: "30",
        snapshots: false,
        now,
        showRates: rates,
      });
      expect(numbers(stored), key).toEqual(numbers(live));
    }

    const ownStored = await run(w.member.user, "time_logged", {
      window: "30",
      snapshots: true,
      now,
      readAll: false,
      readAnyTime: false,
      filters: { teamId: team.id },
    });
    const ownLive = await run(w.member.user, "time_logged", {
      window: "30",
      snapshots: false,
      now,
      readAll: false,
      readAnyTime: false,
      filters: { teamId: team.id },
    });
    expect(numbers(ownStored)).toEqual(numbers(ownLive));
    expect(
      ownStored.metrics.find((entry) => entry.key === "hours")?.value,
    ).toBe(0.75);

    const noProjectReach = await run(w.outsider.user, "kb_deflection", {
      window: "30",
      snapshots: true,
      now,
      readAll: false,
    });
    const noProjectReachLive = await run(w.outsider.user, "kb_deflection", {
      window: "30",
      snapshots: false,
      now,
      readAll: false,
    });
    expect(numbers(noProjectReach)).toEqual(numbers(noProjectReachLive));
    expect(noProjectReach.rows.map((row) => row.article)).toContain(
      "Workspace-wide snapshot article",
    );

    if (!rating) throw new Error("rating fixture missing");
    await db
      .update(schema.satisfactionRatingTable)
      .set({ score: 1 })
      .where(eq(schema.satisfactionRatingTable.id, rating.id));
    // The update invalidates all day coverage before the report falls back to live source facts.
    const invalidated = await db
      .select()
      .from(metricSnapshotDayTable)
      .where(eq(metricSnapshotDayTable.workspaceId, w.workspaceId));
    expect(invalidated).toHaveLength(0);
    const afterUpdate = await run(w.owner.user, "satisfaction", {
      window: "30",
      snapshots: true,
      now,
    });
    expect(numbers(afterUpdate)).toEqual(
      numbers(
        await run(w.owner.user, "satisfaction", {
          window: "30",
          snapshots: false,
          now,
        }),
      ),
    );
    await runMetricsSnapshot(now);
    expect(
      (
        await db
          .select()
          .from(metricSnapshotDayTable)
          .where(eq(metricSnapshotDayTable.workspaceId, w.workspaceId))
      ).length,
    ).toBeGreaterThan(0);
  });

  it("states the boundary: mixed with the current day, snapshot for a closed custom window, and supports team-filtered snapshots", async () => {
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
    expect(team.boundary).toBe("mixed");
    expect(numbers(team)).toEqual(
      numbers(
        await run(w.owner.user, "sla_attainment", {
          window: "30",
          filters: { teamId: "no-such-team" },
          snapshots: false,
          now,
        }),
      ),
    );
  });

  it("invalidates older days immediately, then restores their marker on the hourly recompute", async () => {
    await seed();
    const now = new Date();
    await runMetricsSnapshot(now);
    const read = (snapshots: boolean) =>
      run(w.owner.user, "throughput", {
        window: "30",
        snapshots,
        now,
      });
    const baseline = await read(true);
    const baselineValue = baseline.metrics[0]?.value ?? 0;
    // A day older than the three-day lookback: source insert clears that day's marker, so the
    // snapshot-enabled read immediately falls back to the shared live definition.
    await w.addItem({
      createdDaysAgo: 12,
      resolvedDaysAgo: 8,
      sla: { state: "met" },
    });
    const invalidated = await read(true);
    const live = await read(false);
    expect(invalidated.metrics[0]?.value).toBe(baselineValue + 1);
    expect(numbers(invalidated)).toEqual(numbers(live));
    expect(invalidated.sources.liveComponents).toContain("uncovered_days");

    // A day inside the lookback is also invalidated, then the hourly run restores its marker.
    await w.addItem({
      createdDaysAgo: 5,
      resolvedDaysAgo: 2,
      sla: { state: "met" },
    });
    await runMetricsSnapshot(now);
    const refreshed = await read(true);
    expect(refreshed.metrics[0]?.value).toBe(baselineValue + 2);
    expect(numbers(refreshed)).toEqual(numbers(await read(false)));
  });

  it("invalidates workspace coverage on a source change and the next run catches up both older source days", async () => {
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
    const before = await db
      .select()
      .from(metricSnapshotDayTable)
      .where(eq(metricSnapshotDayTable.workspaceId, w.workspaceId));
    expect(before.length).toBeGreaterThan(2);

    await db
      .update(schema.workItemTable)
      .set({ priority: "urgent" })
      .where(eq(schema.workItemTable.id, older.id));
    const afterMutation = await db
      .select()
      .from(metricSnapshotDayTable)
      .where(eq(metricSnapshotDayTable.workspaceId, w.workspaceId));
    expect(afterMutation).toHaveLength(0);

    await runMetricsSnapshot(now);
    const rebuilt = await db.execute<{ day: string }>(sql`
      SELECT to_char(period_start AT TIME ZONE 'UTC','YYYY-MM-DD') AS day
      FROM metric_snapshot_day WHERE workspace_id=${w.workspaceId}
    `);
    const dayOf = (date: Date) => date.toISOString().slice(0, 10);
    expect(rebuilt.rows.map((row) => row.day)).toContain(
      dayOf(older.resolvedAt as Date),
    );
    expect(rebuilt.rows.map((row) => row.day)).toContain(
      dayOf(newer.resolvedAt as Date),
    );
    expect(rebuilt.rows.length).toBe(before.length);
  });

  it("does not let a legacy writer certify a partial day as a v2 snapshot", async () => {
    const now = new Date();
    const item = await w.addItem({ createdDaysAgo: 12, resolvedDaysAgo: 10 });
    const periodStart = utcDayStart(item.resolvedAt as Date);
    const siblingStart = addDays(periodStart, -1);
    const period = dayKey(periodStart);
    const sibling = dayKey(siblingStart);
    await writeWorkspaceDays(w.workspaceId, [period, sibling], now);

    const initial = await db
      .select()
      .from(metricSnapshotDayTable)
      .where(eq(metricSnapshotDayTable.workspaceId, w.workspaceId));
    expect(
      initial.filter((row) =>
        [period, sibling].includes(dayKey(row.periodStart)),
      ),
    ).toHaveLength(2);
    expect(
      initial.every((row) => row.snapshotVersion === SNAPSHOT_FAMILY_VERSION),
    ).toBe(true);

    // Simulate a rolling old writer replacing only the original throughput family. Fact DML
    // invalidates that day's v2 marker; the old schema-compatible marker insert defaults to v1.
    await db
      .delete(metricSnapshotTable)
      .where(
        and(
          eq(metricSnapshotTable.workspaceId, w.workspaceId),
          eq(metricSnapshotTable.periodStart, periodStart),
        ),
      );
    await db.insert(metricSnapshotTable).values({
      workspaceId: w.workspaceId,
      periodStart,
      periodEnd: addDays(periodStart, 1),
      grain: "day",
      metricKey: "throughput",
      projectId: w.projectA.id,
      organisationId: w.owner.workspace.organisationId,
      dimensions: { priority: "high" },
      measures: { completed: 999 },
    });
    await db.execute(sql`INSERT INTO metric_snapshot_day (workspace_id, period_start, computed_at)
      VALUES (${w.workspaceId}, ${periodStart.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)`);

    const markers = await db
      .select()
      .from(metricSnapshotDayTable)
      .where(eq(metricSnapshotDayTable.workspaceId, w.workspaceId));
    expect(
      markers.find((row) => dayKey(row.periodStart) === period)
        ?.snapshotVersion,
    ).toBe(1);
    expect(
      markers.find((row) => dayKey(row.periodStart) === sibling)
        ?.snapshotVersion,
    ).toBe(SNAPSHOT_FAMILY_VERSION);

    const snapshotRead = await run(w.owner.user, "throughput", {
      window: "custom",
      from: period,
      to: period,
      snapshots: true,
      now,
    });
    const liveRead = await run(w.owner.user, "throughput", {
      window: "custom",
      from: period,
      to: period,
      snapshots: false,
      now,
    });
    expect(numbers(snapshotRead)).toEqual(numbers(liveRead));
    expect(snapshotRead.snapshot?.closedDays ?? 0).toBe(0);
    expect(snapshotRead.boundary).toBe("live");
  });

  it("erases opaque person IDs from every snapshot dimension before the person row is deleted", async () => {
    const now = new Date();
    const periodStart = addDays(utcDayStart(now), -2);
    const periodEnd = addDays(periodStart, 1);
    const [person] = await db
      .insert(schema.personTable)
      .values({
        organisationId: w.owner.workspace.organisationId,
        side: "staff",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    expect(person).toBeTruthy();
    const dimensions: Array<Record<string, string | null>> = [
      { personId: person?.id ?? "" },
      { assigneeId: person?.id ?? "" },
      { requesterId: person?.id ?? "" },
      { creatorId: person?.id ?? "" },
      { escalationPersonId: person?.id ?? "" },
    ];
    for (const [index, dimension] of dimensions.entries()) {
      await db.insert(metricSnapshotTable).values({
        workspaceId: w.workspaceId,
        periodStart,
        periodEnd,
        metricKey: `erase-person-${index}`,
        projectId: null,
        organisationId: null,
        dimensions: dimension,
        measures: { count: 1 },
      });
    }
    await db.insert(metricSnapshotDayTable).values({
      workspaceId: w.workspaceId,
      periodStart,
      computedAt: now,
      snapshotVersion: SNAPSHOT_FAMILY_VERSION,
    });

    await db
      .delete(schema.personTable)
      .where(eq(schema.personTable.id, person?.id ?? ""));

    const remaining = await db.execute<{
      n: number;
    }>(sql`SELECT count(*)::int AS n
      FROM metric_snapshot WHERE workspace_id=${w.workspaceId}
        AND dimensions ?| ARRAY['personId','assigneeId','requesterId','creatorId','escalationPersonId']
        AND (dimensions->>'personId'=${person?.id ?? ""}
          OR dimensions->>'assigneeId'=${person?.id ?? ""}
          OR dimensions->>'requesterId'=${person?.id ?? ""}
          OR dimensions->>'creatorId'=${person?.id ?? ""}
          OR dimensions->>'escalationPersonId'=${person?.id ?? ""})`);
    expect(remaining.rows[0]?.n).toBe(0);
    expect(
      await db
        .select()
        .from(metricSnapshotDayTable)
        .where(
          and(
            eq(metricSnapshotDayTable.workspaceId, w.workspaceId),
            eq(metricSnapshotDayTable.periodStart, periodStart),
          ),
        ),
    ).toHaveLength(0);
  });

  it("rolls back marker invalidation when the source mutation rolls back", async () => {
    await seed();
    const now = new Date();
    await runMetricsSnapshot(now);
    const target = (
      await db
        .select({
          id: schema.workItemTable.id,
          priority: schema.workItemTable.priority,
        })
        .from(schema.workItemTable)
        .where(
          and(
            eq(schema.workItemTable.workspaceId, w.workspaceId),
            isNotNull(schema.workItemTable.resolvedAt),
          ),
        )
        .limit(1)
    )[0];
    const day = (
      await db.execute<{
        day: string;
      }>(sql`SELECT to_char(resolved_at, 'YYYY-MM-DD') AS day
        FROM work_item WHERE id = ${target?.id ?? ""}`)
    ).rows[0]?.day;
    expect(day).toBeTruthy();
    const changedPriority = target?.priority === "urgent" ? "low" : "urgent";
    const markerCount = async () =>
      (
        await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n
        FROM metric_snapshot_day
        WHERE workspace_id = ${w.workspaceId}
          AND to_char(period_start AT TIME ZONE 'UTC','YYYY-MM-DD') = ${day}`)
      ).rows[0]?.n;
    expect(await markerCount()).toBe(1);

    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(schema.workItemTable)
          .set({ priority: target?.priority === "urgent" ? "low" : "urgent" })
          .where(eq(schema.workItemTable.id, target?.id ?? ""));
        throw new Error("rollback snapshot source mutation");
      }),
    ).rejects.toThrow("rollback snapshot source mutation");

    expect(await markerCount()).toBe(1);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL TIME ZONE 'Asia/Yangon'`);
      await tx
        .update(schema.workItemTable)
        .set({ priority: changedPriority })
        .where(eq(schema.workItemTable.id, target?.id ?? ""));
    });
    expect(await markerCount()).toBe(0);
    const after = await run(w.owner.user, "throughput", {
      window: "30",
      snapshots: true,
      now,
    });
    expect(numbers(after)).toEqual(
      numbers(
        await run(w.owner.user, "throughput", {
          window: "30",
          snapshots: false,
          now,
        }),
      ),
    );
  });

  it("invalidates a historical SLA day when a settled outcome flips", async () => {
    await seed();
    const now = new Date();
    await runMetricsSnapshot(now);
    const item = (
      await db.execute<{ id: string }>(sql`SELECT w.id
        FROM work_item w
        JOIN work_item_sla_cache c ON c.work_item_id = w.id AND c.metric = 'resolution'
        WHERE w.workspace_id = ${w.workspaceId} AND w.resolved_at IS NOT NULL
          AND c.state = 'met'
        ORDER BY w.resolved_at ASC, w.id LIMIT 1`)
    ).rows[0];
    expect(item?.id).toBeTruthy();

    await db
      .update(schema.workItemSlaCacheTable)
      .set({ state: "missed" })
      .where(
        and(
          eq(schema.workItemSlaCacheTable.workItemId, item?.id ?? ""),
          eq(schema.workItemSlaCacheTable.metric, "resolution"),
        ),
      );

    const snapshotRead = await run(w.owner.user, "sla_attainment", {
      window: "30",
      snapshots: true,
      now,
    });
    const liveRead = await run(w.owner.user, "sla_attainment", {
      window: "30",
      snapshots: false,
      now,
    });
    expect(snapshotRead.sources.liveComponents).toContain("uncovered_days");
    expect(numbers(snapshotRead)).toEqual(numbers(liveRead));
  });

  it("invalidates covered days when a project is rebound or soft-deleted", async () => {
    await seed();
    const now = new Date();
    await runMetricsSnapshot(now);
    const countMarkers = async () =>
      (
        await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n
        FROM metric_snapshot_day WHERE workspace_id = ${w.workspaceId}`)
      ).rows[0]?.n ?? 0;
    const before = await countMarkers();
    expect(before).toBeGreaterThan(0);

    await db
      .update(schema.projectTable)
      .set({ organisationId: null })
      .where(eq(schema.projectTable.id, w.projectA.id));
    const afterRebind = await countMarkers();
    expect(afterRebind).toBeLessThan(before);

    await runMetricsSnapshot(now);
    const beforeDelete = await countMarkers();
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, w.projectA.id));
    expect(await countMarkers()).toBeLessThan(beforeDelete);

    const snapshotRead = await run(w.owner.user, "throughput", {
      window: "30",
      snapshots: true,
      now,
    });
    const liveRead = await run(w.owner.user, "throughput", {
      window: "30",
      snapshots: false,
      now,
    });
    expect(numbers(snapshotRead)).toEqual(numbers(liveRead));
  });

  it("serializes a late source mutation with an in-flight day writer", async () => {
    await seed();
    const now = new Date();
    await runMetricsSnapshot(now);
    const target = (
      await db
        .select({
          id: schema.workItemTable.id,
          priority: schema.workItemTable.priority,
        })
        .from(schema.workItemTable)
        .where(
          and(
            eq(schema.workItemTable.workspaceId, w.workspaceId),
            isNotNull(schema.workItemTable.resolvedAt),
          ),
        )
        .limit(1)
    )[0];
    const day = (
      await db.execute<{
        day: string;
      }>(sql`SELECT to_char(resolved_at, 'YYYY-MM-DD') AS day
        FROM work_item WHERE id = ${target?.id ?? ""}`)
    ).rows[0]?.day;
    expect(day).toBeTruthy();
    const changedPriority = target?.priority === "urgent" ? "low" : "urgent";

    let releaseFence!: () => void;
    let fenceAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => (fenceAcquired = resolve));
    const held = new Promise<void>((resolve) => (releaseFence = resolve));
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(
        hashtext(${`metric_snapshot_workspace:${w.workspaceId}`}))`);
      fenceAcquired();
      await held;
    });
    await acquired;

    const writer = writeWorkspaceDays(w.workspaceId, [day as string], now);
    const mutation = (async () => {
      await db
        .update(schema.workItemTable)
        .set({ priority: changedPriority })
        .where(eq(schema.workItemTable.id, target?.id ?? ""));
    })();

    // Both operations are queued behind the held fence. Regardless of which waiter receives it
    // first, the writer sees the committed mutation or the mutation invalidates its marker.
    const waitsForFence = async () => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const row = (
          await db.execute<{
            n: number;
          }>(sql`SELECT count(*)::int AS n FROM pg_locks
            WHERE locktype = 'advisory' AND granted = false`)
        ).rows[0];
        if ((row?.n ?? 0) >= 2) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(
        "snapshot writer and source mutation did not wait on the workspace fence",
      );
    };
    let waitError: Error | null = null;
    try {
      await waitsForFence();
    } catch (error) {
      waitError =
        error instanceof Error ? error : new Error("fence wait failed");
    } finally {
      releaseFence();
    }
    await Promise.all([holder, writer, mutation]);
    if (waitError) throw waitError;

    const after = await run(w.owner.user, "throughput", {
      window: "30",
      filters: { priority: changedPriority },
      snapshots: true,
      now,
    });
    const live = await run(w.owner.user, "throughput", {
      window: "30",
      filters: { priority: changedPriority },
      snapshots: false,
      now,
    });
    expect(numbers(after)).toEqual(numbers(live));
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

describe("snapshot retention and legal holds", () => {
  it("retains every fact and the marker for a held day, and prunes an unheld day whole", async () => {
    const now = new Date();
    const heldStart = addDays(utcDayStart(now), -810);
    const unheldStart = addDays(utcDayStart(now), -811);
    const heldDay = dayKey(heldStart);
    const unheldDay = dayKey(unheldStart);
    const heldInstant = new Date(heldStart.getTime() + 12 * 60 * 60 * 1000);
    const unheldInstant = new Date(unheldStart.getTime() + 12 * 60 * 60 * 1000);

    const heldHigh = await w.addItem({ createdDaysAgo: 810, priority: "high" });
    const heldLow = await w.addItem({ createdDaysAgo: 810, priority: "low" });
    await db
      .update(schema.workItemTable)
      .set({
        createdAt: heldInstant,
        requesterId: w.customer.person.id,
      })
      .where(eq(schema.workItemTable.id, heldHigh.id));
    await db
      .update(schema.workItemTable)
      .set({ createdAt: heldInstant })
      .where(eq(schema.workItemTable.id, heldLow.id));
    const unheld = await w.addItem({ createdDaysAgo: 811, priority: "urgent" });
    await db
      .update(schema.workItemTable)
      .set({ createdAt: unheldInstant })
      .where(eq(schema.workItemTable.id, unheld.id));

    await writeWorkspaceDays(w.workspaceId, [heldDay, unheldDay], now);
    await db.insert(schema.legalHoldTable).values({
      scope: "person",
      scopeId: w.customer.person.id,
      placedBy: w.owner.user.id,
      reason: "snapshot retention test",
    });
    await pruneSnapshots(now);

    const markers = await db.execute<{ day: string }>(sql`
      SELECT to_char(period_start AT TIME ZONE 'UTC','YYYY-MM-DD') AS day
      FROM metric_snapshot_day WHERE workspace_id=${w.workspaceId}
    `);
    expect(markers.rows.map((row) => row.day)).toContain(heldDay);
    expect(markers.rows.map((row) => row.day)).not.toContain(unheldDay);
    const heldFacts = await db.execute<{ priority: string | null }>(sql`
      SELECT dimensions->>'priority' AS priority FROM metric_snapshot
      WHERE workspace_id=${w.workspaceId} AND metric_key='item_created'
        AND period_start=${heldStart.toISOString()}::timestamptz
      ORDER BY dimensions->>'priority'
    `);
    expect(heldFacts.rows.map((row) => row.priority)).toEqual(["high", "low"]);
  });
});
