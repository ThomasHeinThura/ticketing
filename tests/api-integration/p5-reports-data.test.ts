/**
 * P5 reports against fixtures with known answers: customers, delivery, people, leadership, cycles,
 * time and cost (rates stripped on every surface, TC-11), knowledge base deflection, CSV export
 * (RP-10) and tenant isolation.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { slaEscalationTable } from "../../apps/api/src/database/schema";
import {
  cycleSnapshotTable,
  cycleTable,
} from "../../apps/api/src/database/schema-p5-agile";
import { deflectionEventTable } from "../../apps/api/src/database/schema-p5-kb";
import { resetTestDatabase } from "./helpers/database";
import { makeTeam, workItemWorld } from "./helpers/p4-closeout";
import { insertArticle } from "./helpers/p5-kb";
import { daysAgo, type ReportsWorld, reportsWorld } from "./helpers/p5-reports";
import { auditActionsOf, isoDaysAgo } from "./helpers/p5-time";

let w: ReportsWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await reportsWorld();
});

const metric = (
  body: { metrics: Array<{ key: string; value: number | null }> },
  key: string,
) => body.metrics.find((entry) => entry.key === key);

describe("customers", () => {
  it("ranks customers worst first with attainment per customer", async () => {
    for (let i = 0; i < 10; i += 1)
      await w.addItem({
        createdDaysAgo: 4,
        resolvedDaysAgo: 2,
        sla: { state: "met" },
      });
    const { body } = await w.report(
      w.owner.user,
      "customer_performance",
      "&window=30",
    );
    const row = body.rows.find(
      (entry) => entry.customer === "Customer principal org",
    );
    expect(row?.resolved).toBe(10);
    expect(row?.attainment).toBe(100);
    expect(row?.fast).toBe(10);
  });

  it("gives CSAT by customer with the sample rule", async () => {
    const scores = [5, 5, 5, 4, 4, 3, 2, 1, 5, 4];
    for (const score of scores) {
      const item = await w.addItem({ createdDaysAgo: 5, resolvedDaysAgo: 1 });
      await db.insert(schema.satisfactionRatingTable).values({
        workItemId: item.id,
        personId: w.customer.person.id,
        score,
      });
    }
    const { body } = await w.report(w.owner.user, "satisfaction", "&window=30");
    expect(metric(body, "csat")?.value).toBe(70);
    expect(metric(body, "ratings")?.value).toBe(10);
    // A member who does not reach project A sees none of it.
    const outsider = await w.report(
      w.outsider.user,
      "satisfaction",
      "&window=30",
    );
    expect(outsider.body.empty).not.toBeNull();
  });

  it("shows volume change only against a previous period large enough to compare (RP-6)", async () => {
    await w.addItem({ createdDaysAgo: 2 });
    await w.addItem({ createdDaysAgo: 40 });
    const { body } = await w.report(
      w.owner.user,
      "customer_volume_trend",
      "&window=30",
    );
    const row = body.rows.find(
      (entry) => entry.customer === "Customer principal org",
    );
    expect(row?.change).toEqual({ n: 1, needed: 10 });
  });
});

describe("delivery", () => {
  it("counts completions per week and their total", async () => {
    for (const days of [2, 2, 2, 9, 9])
      await w.addItem({ createdDaysAgo: 20, resolvedDaysAgo: days });
    const { body } = await w.report(w.owner.user, "throughput", "&window=30");
    expect(metric(body, "completed")?.value).toBe(5);
    expect(body.rows.reduce((sum, row) => sum + Number(row.completed), 0)).toBe(
      5,
    );
    expect(
      body.chart?.series[0]?.values.reduce((a, b) => (a ?? 0) + (b ?? 0), 0),
    ).toBe(5);
  });

  it("clamps a partial week's drill to the window so every row's count equals its drill (R5-08)", async () => {
    // Items resolved inside the first (partial) Monday-based week but before window.from, and
    // inside the window. Whatever weekday the 30-day window starts on, rows match drills.
    const fromDay = new Date(Date.now() - 30 * 86_400_000);
    const sinceMonday = (fromDay.getUTCDay() + 6) % 7;
    if (sinceMonday > 0)
      await w.addItem({
        createdDaysAgo: 40,
        resolvedDaysAgo: 30 + sinceMonday,
      });
    await w.addItem({ createdDaysAgo: 40, resolvedDaysAgo: 29 });
    await w.addItem({ createdDaysAgo: 40, resolvedDaysAgo: 2 });
    const { body } = await w.report(w.owner.user, "throughput", "&window=30");
    expect(body.rows.length).toBeGreaterThan(0);
    for (const row of body.rows) {
      const response = await w.get(
        w.owner.user,
        `/api/reports/throughput/items?workspaceId=${w.workspaceId}&window=30&handle=${row._drill}&limit=100`,
      );
      const drill = (await response.json()) as { data: unknown[] };
      expect(drill.data.length).toBe(Number(row.completed));
    }
  });

  it("buckets created-to-resolved durations", async () => {
    await w.addItem({ createdDaysAgo: 1, resolvedDaysAgo: 0 });
    await w.addItem({ createdDaysAgo: 40, resolvedDaysAgo: 2 });
    const { body } = await w.report(w.owner.user, "cycle_time", "&window=30");
    const counts = Object.fromEntries(
      body.rows.map((row) => [row.bucket, row.items]),
    );
    expect(counts["> 30 days"]).toBe(1);
    expect(
      Object.values(counts).reduce((a, b) => Number(a) + Number(b), 0),
    ).toBe(2);
  });

  it("mixes work by type and priority", async () => {
    await w.addItem({ createdDaysAgo: 2, priority: "urgent" });
    await w.addItem({ createdDaysAgo: 2, priority: "urgent" });
    await w.addItem({ createdDaysAgo: 2, priority: "low" });
    const { body } = await w.report(w.owner.user, "work_mix", "&window=30");
    const task = body.rows.find((row) => row.type === "Task");
    expect(task?.urgent).toBe(2);
    expect(task?.low).toBe(1);
  });

  it("shows where items sit longest in the flow", async () => {
    await w.addItem({ createdDaysAgo: 45 });
    const { body } = await w.report(w.owner.user, "flow");
    const row = body.rows.find((entry) => entry.state === "In progress");
    expect(row?.oldest).toBe(45);
    expect(row?.over).toBe(1);
  });

  it("lists breached and at-risk items first", async () => {
    await w.addItem({
      createdDaysAgo: 4,
      sla: { state: "at_risk", dueDaysAhead: 1 },
      title: "At risk one",
    });
    await w.addItem({
      createdDaysAgo: 8,
      sla: { state: "breached", dueDaysAhead: -1 },
      title: "Breached one",
    });
    const { body } = await w.report(w.owner.user, "at_risk_now");
    expect(body.rows.map((row) => row.title)).toEqual([
      "Breached one",
      "At risk one",
    ]);
  });
});

describe("people", () => {
  it("counts open work per person and finds the stale items", async () => {
    for (let i = 0; i < 3; i += 1)
      await w.addItem({
        createdDaysAgo: 5,
        assigneeId: w.ownerPersonId,
        priority: "high",
      });
    const stale = await w.addItem({
      createdDaysAgo: 80,
      assigneeId: w.member.personId,
    });
    await db
      .update(schema.workItemTable)
      .set({ updatedAt: daysAgo(40) })
      .where(eq(schema.workItemTable.id, stale.id));
    const workload = await w.report(w.owner.user, "workload");
    expect(
      workload.body.rows.find((row) => row.assignee === "(unassigned)")?.open,
    ).toBeGreaterThanOrEqual(3);
    const owner = workload.body.rows.find((row) => Number(row.urgent) === 3);
    expect(owner?.open).toBe(3);
    const thirty = await w.report(w.owner.user, "stale_work", "&days=30");
    expect(metric(thirty.body, "stale")?.value).toBeGreaterThanOrEqual(1);
    const sixty = await w.report(w.owner.user, "stale_work", "&days=60");
    expect(
      sixty.body.rows.find(
        (row) => row.assignee !== "(unassigned)" && Number(row.stale) > 0,
      ),
    ).toBeUndefined();
  });

  it("measures utilisation against team capacity and says when none is set", async () => {
    const team = await makeTeam(w.workspaceId, [w.member.user.id]);
    await db
      .update(schema.teamTable)
      .set({ capacityDaysPerWeek: "5" })
      .where(eq(schema.teamTable.id, team.id));
    expect(
      (await w.logTime(w.member.user, { date: isoDaysAgo(1), minutes: 120 }))
        .status,
    ).toBe(201);
    const { body } = await w.report(w.owner.user, "utilisation", "&window=7");
    const row = body.rows.find((entry) => entry.available === 40);
    expect(row?.logged).toBe(2);
    expect(row?.utilisation).toBe(5);
    expect(body.notes).toContain("assumes_eight_hour_day");
    const capacity = await w.report(w.owner.user, "capacity", "&window=7");
    expect(
      capacity.body.rows.find((entry) => entry.capacity === 40)?.logged,
    ).toBe(2);
  });

  it("limits a caller without time_entry:read_any to their own time", async () => {
    await w.logTime(w.lead.user, { date: isoDaysAgo(1), minutes: 60 });
    await w.logTime(w.member.user, { date: isoDaysAgo(1), minutes: 30 });
    const member = await w.report(
      w.member.user,
      "time_logged",
      "&window=7&by=person",
    );
    expect(member.body.rows).toHaveLength(1);
    expect(member.body.rows[0]?.hours).toBe(0.5);
    expect(member.body.notes).toContain("own_time_only");
    const lead = await w.report(
      w.lead.user,
      "time_logged",
      "&window=7&by=person",
    );
    expect(lead.body.rows).toHaveLength(2);
  });
});

describe("leadership and cycles", () => {
  it("reports portfolio health, escalations and predictability", async () => {
    await db
      .update(schema.projectTable)
      .set({ health: "red" })
      .where(eq(schema.projectTable.id, w.projectA.id));
    const health = await w.report(w.owner.user, "portfolio_health");
    expect(health.body.rows[0]?.rag).toBe("red");
    expect(metric(health.body, "red")?.value).toBe(1);

    const item = await w.addItem({
      createdDaysAgo: 4,
      sla: { state: "breached" },
    });
    await db.insert(slaEscalationTable).values([
      {
        workspaceId: w.workspaceId,
        projectId: w.projectA.id,
        workItemId: item.id,
        metric: "resolution",
        triggerEventId: "evt-1",
        stateIdAtStart: item.stateId,
        lastOrder: 1,
        nextDueAt: new Date(Date.now() + 3_600_000),
        state: "active",
      },
      {
        workspaceId: w.workspaceId,
        projectId: w.projectA.id,
        workItemId: item.id,
        metric: "first_response",
        triggerEventId: "evt-2",
        stateIdAtStart: item.stateId,
        lastOrder: 1,
        state: "stopped",
        stopReason: "resolved",
      },
    ]);
    const escalations = await w.report(
      w.owner.user,
      "escalations",
      "&window=7",
    );
    expect(metric(escalations.body, "started")?.value).toBe(2);
    expect(metric(escalations.body, "active")?.value).toBe(1);
    expect(metric(escalations.body, "stopped")?.value).toBe(1);

    const [cycle] = await db
      .insert(cycleTable)
      .values({
        workspaceId: w.workspaceId,
        projectId: w.projectA.id,
        name: "Sprint 1",
        startDate: isoDaysAgo(14),
        endDate: isoDaysAgo(1),
        completedAt: daysAgo(1),
      })
      .returning();
    await db.insert(cycleSnapshotTable).values({
      cycleId: cycle?.id ?? "",
      date: isoDaysAgo(1),
      unit: "count",
      scopePoints: "10",
      completedPoints: "8",
      itemCount: 10,
      completedCount: 8,
      unestimatedCount: 2,
    });
    const predictability = await w.report(
      w.owner.user,
      "predictability",
      "&window=30",
    );
    expect(predictability.body.rows[0]).toMatchObject({
      committed: 10,
      delivered: 8,
      delivery: 80,
      unestimated: 2,
    });
    const velocity = await w.report(w.owner.user, "cycle_velocity");
    expect(velocity.body.rows[0]?.velocity).toEqual({ n: 1, needed: 3 });
    const burndown = await w.report(w.owner.user, "cycle_burndown");
    expect(burndown.response.status).toBe(200);
    expect(burndown.body.choices[0]?.selected).toBe(cycle?.id);
  });
});

describe("knowledge base deflection", () => {
  it("counts opened and abandoned, and hides a project-scoped article from a caller without reach", async () => {
    const open = await insertArticle(w.workspaceId, {
      title: "Reset your password",
      state: "published",
    });
    const hidden = await insertArticle(w.workspaceId, {
      title: "Project B runbook",
      state: "published",
      projectId: w.projectB.id,
    });
    await db.insert(deflectionEventTable).values([
      ...Array.from({ length: 12 }, (_, i) => ({
        workspaceId: w.workspaceId,
        personId: w.customer.person.id,
        kbArticleId: open.id,
        abandonedAt: i < 10 ? new Date() : null,
      })),
      {
        workspaceId: w.workspaceId,
        personId: w.customer.person.id,
        kbArticleId: hidden.id,
        abandonedAt: new Date(),
      },
    ]);
    const owner = await w.report(w.owner.user, "kb_deflection", "&window=30");
    expect(metric(owner.body, "opened")?.value).toBe(13);
    expect(metric(owner.body, "deflected")?.value).toBe(11);
    const member = await w.report(w.member.user, "kb_deflection", "&window=30");
    expect(metric(member.body, "opened")?.value).toBe(12);
    expect(metric(member.body, "rate")?.value).toBe(83.3);
    expect(member.body.rows.map((row) => row.article)).toEqual([
      "Reset your password",
    ]);
  });
});

describe("time and cost: rates never leak (TC-11)", () => {
  async function seed() {
    await w.addRate(w.member.personId, isoDaysAgo(20), 6000, "EUR");
    await w.logTime(w.member.user, { date: isoDaysAgo(1), minutes: 90 });
    await w.logTime(w.lead.user, { date: isoDaysAgo(1), minutes: 30 });
    const budget = await w.agent(
      w.owner.user,
      `/api/projects/${w.projectA.id}/budgets`,
      {
        method: "POST",
        body: {
          name: "Q4",
          plannedAmountMinor: 10000,
          currency: "EUR",
          periodStart: isoDaysAgo(10),
          periodEnd: isoDaysAgo(-20),
        },
      },
    );
    expect(budget.status).toBe(201);
  }

  it("shows cost to a rate manager and removes every rate-derived field for everyone else", async () => {
    await seed();
    const owner = await w.report(
      w.owner.user,
      "time_logged",
      "&window=30&by=person",
    );
    expect(owner.body.costVisible).toBe(true);
    expect(owner.body.columns.map((c) => c.key)).toContain("cost");
    expect(JSON.stringify(owner.body)).toContain("90.00");
    const costOwner = await w.report(
      w.owner.user,
      "cost_to_deliver",
      "&window=30",
    );
    expect(
      costOwner.body.rows.find((row) => row.budget === "Q4"),
    ).toMatchObject({ planned: 10000, actual: 9000, currency: "EUR" });

    for (const user of [w.lead.user, w.member.user]) {
      for (const [key, query] of [
        ["time_logged", "&window=30&by=person"],
        ["time_logged", "&window=30&by=project"],
        ["cost_to_deliver", "&window=30"],
        ["utilisation", "&window=30"],
        ["capacity", "&window=30"],
      ] as const) {
        const { response, body } = await w.report(user, key, query);
        expect(response.status).toBe(200);
        expect(body.costVisible).toBe(false);
        const json = JSON.stringify(body);
        for (const needle of [
          "9000",
          "90.00",
          '"cost"',
          "unpriced",
          "planned",
          "actual",
          "rate",
        ])
          expect(json, `${key} leaked ${needle}`).not.toContain(needle);
        expect(body.columns.map((c) => c.key)).not.toContain("cost");
      }
    }
  });

  it("hides cost when feature.cost_tracking is off, even from a rate manager", async () => {
    await seed();
    const { setTimeFlags } = await import("./helpers/p5-time");
    await setTimeFlags(w.workspaceId, { time: true, cost: false });
    const { body } = await w.report(w.owner.user, "time_logged", "&window=30");
    expect(body.costVisible).toBe(false);
    expect(JSON.stringify(body)).not.toContain("90.00");
  });

  it("keeps cost out of the CSV, the export audit row and the widget data of a caller without rates", async () => {
    await seed();
    const exportAs = (user: typeof w.owner.user) =>
      w.get(user, "/api/reports/time_logged/export", {
        method: "POST",
        body: { workspaceId: w.workspaceId, window: "30", by: "person" },
      });
    const ownerCsv = await (await exportAs(w.owner.user)).text();
    expect(ownerCsv).toContain("Cost");
    expect(ownerCsv).toContain("90.00");
    const leadResponse = await exportAs(w.lead.user);
    expect(leadResponse.headers.get("content-type")).toContain("text/csv");
    const leadCsv = await leadResponse.text();
    expect(leadCsv).not.toContain("Cost");
    expect(leadCsv).not.toContain("90.00");
    expect(leadCsv).not.toContain("EUR");
    const rows = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "report.exported"));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const json = JSON.stringify(row.after);
      expect(json).not.toMatch(/9000|90\.00|rate|cost/i);
    }

    // The same report as a dashboard widget.
    const created = await w.get(w.lead.user, "/api/dashboards", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "Time",
        widgets: [
          {
            reportKey: "time_logged",
            chartType: "table",
            filters: { by: "person", window: "30" },
            x: 0,
            y: 0,
            w: 6,
            h: 4,
          },
        ],
      },
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const dashboard = (await created.json()) as {
      id: string;
      widgets: Array<{ id: string }>;
    };
    const widget = await w.get(
      w.lead.user,
      `/api/dashboards/${dashboard.id}/widgets/${dashboard.widgets[0]?.id}/data?workspaceId=${w.workspaceId}`,
    );
    expect(widget.status).toBe(200);
    const json = await widget.text();
    expect(json).not.toContain("90.00");
    expect(json).not.toContain('"cost"');
  });
});

describe("export (RP-10)", () => {
  it("writes the report as CSV, neutralises formulas, states scope and window, and audits it", async () => {
    await w.addItem({
      createdDaysAgo: 4,
      sla: { state: "breached" },
      title: '=HYPERLINK("http://x")',
    });
    const response = await w.get(
      w.lead.user,
      "/api/reports/at_risk_now/export",
      {
        method: "POST",
        body: { workspaceId: w.workspaceId },
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      "at_risk_now",
    );
    const csv = await response.text();
    expect(csv).toContain("# Scope: your projects");
    expect(csv).toContain("# Window: live");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(await auditActionsOf(w.workspaceId)).toContain("report.exported");
  });

  it("exports only what the caller reaches", async () => {
    await w.addItem({
      createdDaysAgo: 4,
      sla: { state: "breached" },
      title: "Visible in A",
    });
    await w.addItem({
      createdDaysAgo: 4,
      sla: { state: "breached" },
      title: "Hidden in B",
      projectId: w.projectB.id,
    });
    const response = await w.get(
      w.lead.user,
      "/api/reports/at_risk_now/export",
      {
        method: "POST",
        body: { workspaceId: w.workspaceId },
      },
    );
    const csv = await response.text();
    expect(csv).toContain("Visible in A");
    expect(csv).not.toContain("Hidden in B");
  });
});

describe("tenant isolation", () => {
  it("never counts another workspace's items", async () => {
    const world = await workItemWorld(
      w.stranger.workspace.id,
      w.strangerProject.id,
    );
    const foreign = await world.makeItem("Foreign item");
    await db
      .update(schema.workItemTable)
      .set({ resolvedAt: new Date() })
      .where(eq(schema.workItemTable.id, foreign.id));
    const before = await w.report(w.owner.user, "workload");
    expect(JSON.stringify(before.body)).not.toContain("Foreign item");
    const drill = await w.get(
      w.owner.user,
      `/api/reports/workload/items?workspaceId=${w.workspaceId}`,
    );
    expect(JSON.stringify(await drill.json())).not.toContain("Foreign item");
  });
});
