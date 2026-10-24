/**
 * RP-12: every report number can be interrogated. The reports that had no drill-down (breach
 * analysis, satisfaction, utilisation, capacity, time, cost, portfolio health, predictability,
 * escalations, the knowledge base, the two cycle reports) and the tier 3 / widget paths list what
 * the clicked row counted, under the same window, filters and reach, and never carry a rate (TC-11).
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
import { makeTeam } from "./helpers/p4-closeout";
import { insertArticle } from "./helpers/p5-kb";
import { daysAgo, type ReportsWorld, reportsWorld } from "./helpers/p5-reports";
import { isoDaysAgo } from "./helpers/p5-time";

let w: ReportsWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await reportsWorld();
});

type Item = {
  kind: string;
  key: string;
  title: string;
  projectKey: string | null;
  state: string | null;
  priority: string | null;
  hours?: number | null;
  person?: string | null;
  date?: string | null;
  workItemKey?: string | null;
};
type User = Parameters<ReportsWorld["get"]>[0];

/** The report, then the drill of each of its rows: every row's handle must list something. */
async function drill(
  user: User,
  key: string,
  query = "",
  handle?: string | null,
) {
  const { response, body } = await w.report(user, key, query);
  expect(response.status).toBe(200);
  expect((body as unknown as { drill: boolean }).drill, `${key} drills`).toBe(
    true,
  );
  const handles = body.rows
    .map((row) => (row as { _drill?: string })._drill)
    .filter((value): value is string => typeof value === "string");
  const target = handle === undefined ? handles[0] : handle;
  const url = `/api/reports/${key}/items?workspaceId=${w.workspaceId}${query}${
    target ? `&handle=${encodeURIComponent(target)}` : ""
  }&limit=100`;
  const items = await w.get(user, url);
  expect(items.status, await items.clone().text()).toBe(200);
  return {
    body,
    handles,
    items: ((await items.json()) as { data: Item[] }).data,
  };
}

const noRates = (json: string) => {
  for (const needle of ["9000", "90.00", '"cost"', "rateMinor", "unpriced"])
    expect(json, `leaked ${needle}`).not.toContain(needle);
};

describe("work item reports", () => {
  it("lists the items behind a breach analysis row, breached first", async () => {
    for (const state of ["missed", "breached", "met"] as const)
      await w.addItem({
        createdDaysAgo: 6,
        resolvedDaysAgo: state === "met" ? 3 : undefined,
        priority: "high",
        sla: { state, dueDaysAhead: -2 },
        title: `Breach ${state}`,
      });
    const { body, items } = await drill(
      w.owner.user,
      "breach_analysis",
      "&window=30&by=priority",
      "high",
    );
    const row = body.rows.find((entry) => entry.priority === "high");
    expect(items).toHaveLength(Number(row?.total));
    expect(items.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        "Breach missed",
        "Breach breached",
        "Breach met",
      ]),
    );
    expect(items[2]?.title).toBe("Breach met");
    expect(items.every((item) => item.kind === "work_item")).toBe(true);
  });

  it("lists the rated items behind a satisfaction row", async () => {
    for (let i = 0; i < 2; i += 1) {
      const item = await w.addItem({
        createdDaysAgo: 5,
        resolvedDaysAgo: 1,
        title: `Rated ${i}`,
      });
      await db.insert(schema.satisfactionRatingTable).values({
        workItemId: item.id,
        personId: w.customer.person.id,
        score: 5,
      });
    }
    await w.addItem({
      createdDaysAgo: 5,
      resolvedDaysAgo: 1,
      title: "Unrated",
    });
    const { items } = await drill(w.owner.user, "satisfaction", "&window=30");
    expect(items.map((item) => item.title).sort()).toEqual([
      "Rated 0",
      "Rated 1",
    ]);
    // A member who reaches no project is shown nothing.
    const outsider = await w.get(
      w.outsider.user,
      `/api/reports/satisfaction/items?workspaceId=${w.workspaceId}&window=30&handle=${encodeURIComponent("Customer principal org")}`,
    );
    expect(((await outsider.json()) as { data: unknown[] }).data).toEqual([]);
  });

  it("lists the open items of a portfolio row and the items of an escalation outcome", async () => {
    await db
      .update(schema.projectTable)
      .set({ health: "red" })
      .where(eq(schema.projectTable.id, w.projectA.id));
    const open = await w.addItem({ createdDaysAgo: 3, title: "Open in A" });
    await w.addItem({
      createdDaysAgo: 3,
      resolvedDaysAgo: 1,
      title: "Done in A",
    });
    const portfolio = await drill(w.owner.user, "portfolio_health");
    expect(portfolio.items.map((item) => item.title)).toContain("Open in A");
    expect(portfolio.items.map((item) => item.title)).not.toContain(
      "Done in A",
    );
    await db.insert(slaEscalationTable).values({
      workspaceId: w.workspaceId,
      projectId: w.projectA.id,
      workItemId: open.id,
      metric: "resolution",
      triggerEventId: "evt-drill",
      stateIdAtStart: open.stateId,
      lastOrder: 1,
      state: "stopped",
      stopReason: "resolved",
    });
    const escalations = await drill(
      w.owner.user,
      "escalations",
      "&window=7",
      "stopped: resolved",
    );
    expect(escalations.items.map((item) => item.key)).toEqual([open.key]);
    const none = await drill(
      w.owner.user,
      "escalations",
      "&window=7",
      "active",
    );
    expect(none.items).toEqual([]);
  });
});

describe("time reports (hours only, never a rate)", () => {
  async function seed() {
    const team = await makeTeam(w.workspaceId, [w.member.user.id]);
    await db
      .update(schema.teamTable)
      .set({ capacityDaysPerWeek: "5", name: "Support team" })
      .where(eq(schema.teamTable.id, team.id));
    await w.addRate(w.member.personId, isoDaysAgo(20), 6000, "EUR");
    expect(
      (await w.logTime(w.member.user, { date: isoDaysAgo(1), minutes: 90 }))
        .status,
    ).toBe(201);
    expect(
      (await w.logTime(w.lead.user, { date: isoDaysAgo(1), minutes: 30 }))
        .status,
    ).toBe(201);
  }

  it("lists the time entries behind utilisation, capacity, time logged and cost", async () => {
    await seed();
    for (const [key, query, handle, hours] of [
      ["utilisation", "&window=7", undefined, undefined],
      ["capacity", "&window=7", "Support team", 1.5],
      ["time_logged", "&window=7&by=person", undefined, undefined],
      ["time_logged", "&window=7&by=project", undefined, undefined],
      ["time_logged", "&window=7&by=activity", undefined, undefined],
      ["cost_to_deliver", "&window=7", undefined, undefined],
    ] as const) {
      const { items } = await drill(w.owner.user, key, query, handle);
      expect(items.length, `${key} ${query}`).toBeGreaterThan(0);
      expect(items.every((item) => item.kind === "time_entry")).toBe(true);
      expect(
        items.every((item) => typeof item.hours === "number" && item.date),
      ).toBe(true);
      if (hours !== undefined)
        expect(items.reduce((sum, item) => sum + (item.hours ?? 0), 0)).toBe(
          hours,
        );
      noRates(JSON.stringify(items));
    }
  });

  it("limits a caller without time_entry:read_any to their own entries, in every time drill", async () => {
    await seed();
    const mine = await drill(
      w.member.user,
      "time_logged",
      "&window=7&by=project",
    );
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]?.hours).toBe(1.5);
    const lead = await drill(
      w.lead.user,
      "time_logged",
      "&window=7&by=project",
    );
    expect(lead.items).toHaveLength(2);
    // The lead holds no rates either, and the drill carries none.
    noRates(JSON.stringify(lead.items));
  });
});

describe("cycle and knowledge base reports", () => {
  async function cycle(completed: boolean) {
    const [row] = await db
      .insert(cycleTable)
      .values({
        workspaceId: w.workspaceId,
        projectId: w.projectA.id,
        name: "Sprint 1",
        startDate: isoDaysAgo(14),
        endDate: isoDaysAgo(1),
        ...(completed ? { completedAt: daysAgo(1) } : {}),
      })
      .returning();
    await db.insert(cycleSnapshotTable).values({
      cycleId: row?.id ?? "",
      date: isoDaysAgo(1),
      unit: "count",
      scopePoints: "3",
      completedPoints: "2",
      itemCount: 3,
      completedCount: 2,
      unestimatedCount: 0,
    });
    return row;
  }
  async function itemIn(cycleId: string, title: string, done: boolean) {
    const item = await w.addItem({
      createdDaysAgo: 10,
      ...(done ? { resolvedDaysAgo: 2 } : {}),
      title,
    });
    await db
      .update(schema.workItemTable)
      .set({ cycleId })
      .where(eq(schema.workItemTable.id, item.id));
  }

  it("lists the items of a completed cycle behind predictability and velocity, and of the burndown's cycle", async () => {
    const sprint = await cycle(true);
    await itemIn(sprint?.id ?? "", "Shipped one", true);
    await itemIn(sprint?.id ?? "", "Shipped two", true);
    await itemIn(sprint?.id ?? "", "Slipped", false);
    const predictability = await drill(
      w.owner.user,
      "predictability",
      "&window=30",
    );
    expect(predictability.items.map((item) => item.title).sort()).toEqual([
      "Shipped one",
      "Shipped two",
      "Slipped",
    ]);
    const velocity = await drill(w.owner.user, "cycle_velocity");
    expect(velocity.items.map((item) => item.title).sort()).toEqual([
      "Shipped one",
      "Shipped two",
    ]);
    const burndown = await w.get(
      w.owner.user,
      `/api/reports/cycle_burndown/items?workspaceId=${w.workspaceId}&limit=100`,
    );
    expect(
      ((await burndown.json()) as { data: Item[] }).data.map(
        (item) => item.title,
      ),
    ).toHaveLength(3);
  });

  it("lists the articles behind a deflection row, and hides a project-scoped one from a caller without reach", async () => {
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
      {
        workspaceId: w.workspaceId,
        personId: w.customer.person.id,
        kbArticleId: open.id,
        abandonedAt: new Date(),
      },
      {
        workspaceId: w.workspaceId,
        personId: w.customer.person.id,
        kbArticleId: hidden.id,
        abandonedAt: new Date(),
      },
    ]);
    const owner = await w.get(
      w.owner.user,
      `/api/reports/kb_deflection/items?workspaceId=${w.workspaceId}&window=30`,
    );
    const all = ((await owner.json()) as { data: Item[] }).data;
    expect(all.every((item) => item.kind === "article")).toBe(true);
    expect(all.map((item) => item.title).sort()).toEqual([
      "Project B runbook",
      "Reset your password",
    ]);
    const member = await w.get(
      w.member.user,
      `/api/reports/kb_deflection/items?workspaceId=${w.workspaceId}&window=30`,
    );
    expect(
      ((await member.json()) as { data: Item[] }).data.map(
        (item) => item.title,
      ),
    ).toEqual(["Reset your password"]);
  });
});

describe("tier 3 reports and widgets", () => {
  const query = {
    entity: "work_item",
    filter: { window: "30" },
    groupBy: "priority",
    aggregate: { fn: "count" },
  };

  it("lists the items of one group of a custom report, and the whole population without a handle", async () => {
    await w.addItem({ createdDaysAgo: 2, priority: "urgent", title: "U1" });
    await w.addItem({ createdDaysAgo: 2, priority: "urgent", title: "U2" });
    await w.addItem({ createdDaysAgo: 2, priority: "low", title: "L1" });
    const preview = await w.get(w.lead.user, "/api/reports/custom/preview", {
      method: "POST",
      body: { workspaceId: w.workspaceId, query },
    });
    const rows = (
      (await preview.json()) as {
        drill: boolean;
        rows: Array<{ group: string; _drill?: string }>;
      }
    ).rows;
    expect(rows.find((row) => row.group === "urgent")?._drill).toBe("urgent");
    const items = async (handle?: string) =>
      (
        (await (
          await w.get(w.lead.user, "/api/reports/custom/items", {
            method: "POST",
            body: { workspaceId: w.workspaceId, query, handle },
          })
        ).json()) as { data: Item[] }
      ).data;
    expect((await items("urgent")).map((item) => item.title).sort()).toEqual([
      "U1",
      "U2",
    ]);
    expect(await items("nothing")).toEqual([]);
    expect(await items()).toHaveLength(3);
  });

  it("lists time entries behind a custom time report, hours only", async () => {
    await w.logTime(w.lead.user, { date: isoDaysAgo(1), minutes: 45 });
    const items = (
      (await (
        await w.get(w.lead.user, "/api/reports/custom/items", {
          method: "POST",
          body: {
            workspaceId: w.workspaceId,
            query: {
              entity: "time_entry",
              filter: { window: "7" },
              groupBy: "project",
              aggregate: { fn: "sum", field: "minutes" },
            },
          },
        })
      ).json()) as { data: Item[] }
    ).data;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "time_entry", hours: 0.8 });
    noRates(JSON.stringify(items));
  });

  it("drills a dashboard widget, for its viewer only", async () => {
    await w.addItem({ createdDaysAgo: 3, resolvedDaysAgo: 1, title: "Done" });
    const created = await w.get(w.lead.user, "/api/dashboards", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
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
      },
    });
    const dashboard = (await created.json()) as {
      id: string;
      widgets: Array<{ id: string }>;
    };
    const path = `/api/dashboards/${dashboard.id}/widgets/${dashboard.widgets[0]?.id}/items`;
    const own = await w.get(w.lead.user, path);
    expect(own.status).toBe(200);
    expect(
      ((await own.json()) as { data: Item[] }).data.map((item) => item.title),
    ).toEqual(["Done"]);
    expect((await w.get(w.owner.user, path)).status).toBe(404);
    expect((await w.get(w.customer.user, path)).status).toBe(403);
  });
});
