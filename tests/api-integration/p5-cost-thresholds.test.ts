/**
 * TC-18: a budget crossing 75% and 90% notifies the project manager once per threshold, through the
 * outbox and inbox pipeline (read back through the inbox API, not by counting rows), only when the
 * manager may see the figure, and never twice.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  budgetThresholdNoticeTable,
  costEntryTable,
} from "../../apps/api/src/database/schema-p5-time";
import { resetTestDatabase } from "./helpers/database";
import { grantProjectRole } from "./helpers/fixtures";
import {
  isoDaysAgo,
  setTimeFlags,
  type TimeWorld,
  timeWorld,
} from "./helpers/p5-time";

let w: TimeWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await timeWorld();
  for (const project of [w.projectA, w.projectB])
    await grantProjectRole(w.owner.user.id, project.id, [
      "time_entry:manage_rates",
    ]);
});

type User = Parameters<TimeWorld["agent"]>[0];
type Notice = {
  kind: string | null;
  title: string | null;
  content: string | null;
  resourceType: string | null;
  resourceId: string | null;
};

async function setManager(personId: string | null) {
  await db
    .update(schema.projectTable)
    .set({ managerId: personId })
    .where(eq(schema.projectTable.id, w.projectA.id));
}
async function budget(planned: number, name = "Q4") {
  const response = await w.agent(
    w.owner.user,
    `/api/projects/${w.projectA.id}/budgets`,
    {
      method: "POST",
      body: {
        name,
        plannedAmountMinor: planned,
        currency: "EUR",
        periodStart: isoDaysAgo(30),
        periodEnd: isoDaysAgo(-30),
      },
    },
  );
  expect(response.status, await response.clone().text()).toBe(201);
}
async function inbox(user: User) {
  const response = await w.agent(user, "/api/notification");
  expect(response.status).toBe(200);
  return ((await response.json()) as Notice[]).filter(
    (notice) => notice.kind === "budget.threshold_reached",
  );
}
async function logMinutes(minutes: number) {
  const response = await w.logTime(w.member.user, {
    date: isoDaysAgo(1),
    minutes,
  });
  expect(response.status, await response.clone().text()).toBe(201);
}
async function costEntry(units: number, rateMinor: number) {
  const type = (await (
    await w.agent(w.owner.user, "/api/cost-types", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: `Type ${Math.random()}`,
        unit: "unit",
        defaultRateMinor: null,
        currency: "EUR",
      },
    })
  ).json()) as { id: string };
  const response = await w.agent(
    w.owner.user,
    `/api/projects/${w.projectA.id}/costs`,
    {
      method: "POST",
      body: {
        costTypeId: type.id,
        date: isoDaysAgo(0),
        units,
        rateMinor,
      },
    },
  );
  expect(response.status, await response.clone().text()).toBe(201);
}
async function notices() {
  return db.select().from(budgetThresholdNoticeTable);
}

describe("budget thresholds notify the project manager (TC-18)", () => {
  it("notifies at 75% and again at 90%, once each, and the manager reads them in the inbox", async () => {
    await setManager(w.ownerPersonId);
    await budget(10_000);
    await w.addRate(w.member.personId, isoDaysAgo(60), 6000, "EUR");
    await logMinutes(60); // 6000 = 60%
    expect(await inbox(w.owner.user)).toHaveLength(0);
    await logMinutes(15); // 7500 = 75%
    const afterFirst = await inbox(w.owner.user);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toMatchObject({
      title: "Budget at 75%",
      resourceType: "project",
      resourceId: w.projectA.id,
    });
    await logMinutes(5); // 8000: nothing new
    expect(await inbox(w.owner.user)).toHaveLength(1);
    await logMinutes(10); // 9000 = 90%
    const afterSecond = await inbox(w.owner.user);
    expect(afterSecond.map((notice) => notice.title).sort()).toEqual([
      "Budget at 75%",
      "Budget at 90%",
    ]);
    await logMinutes(60); // 15000: both already announced
    await costEntry(10, 1000);
    expect(await inbox(w.owner.user)).toHaveLength(2);
    expect((await notices()).map((row) => row.threshold).sort()).toEqual([
      75, 90,
    ]);
  });

  it("raises it from a cost entry too, and carries no amount in the notice", async () => {
    await setManager(w.ownerPersonId);
    await budget(10_000);
    await costEntry(8, 1000);
    const [notice] = await inbox(w.owner.user);
    expect(notice?.title).toBe("Budget at 75%");
    expect(`${notice?.title} ${notice?.content}`).not.toMatch(/8000|10000/);
    const outbox = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "budget.threshold_reached"));
    expect(outbox).toHaveLength(1);
    const payload = JSON.stringify(outbox[0]?.payload);
    expect(payload).not.toMatch(/8000|10000/);
  });

  it("notifies once, for 90%, when one entry jumps past both thresholds, and never 75% afterwards", async () => {
    await setManager(w.ownerPersonId);
    await budget(1_000);
    await costEntry(1, 950);
    const jumped = await inbox(w.owner.user);
    expect(jumped.map((notice) => notice.title)).toEqual(["Budget at 90%"]);
    expect((await notices()).map((row) => row.threshold).sort()).toEqual([
      75, 90,
    ]);
    await costEntry(1, 100);
    expect(await inbox(w.owner.user)).toHaveLength(1);
  });

  it("announces a budget created over time that is already spent", async () => {
    await setManager(w.ownerPersonId);
    await w.addRate(w.member.personId, isoDaysAgo(60), 6000, "EUR");
    await logMinutes(60);
    await budget(6_500);
    expect((await inbox(w.owner.user)).map((n) => n.title)).toEqual([
      "Budget at 90%",
    ]);
  });

  it("notifies once when two entries cross the line at the same moment", async () => {
    await setManager(w.ownerPersonId);
    await budget(10_000);
    await w.addRate(w.member.personId, isoDaysAgo(60), 6000, "EUR");
    await logMinutes(60); // 6000
    const results = await Promise.all([
      w.logTime(w.member.user, { date: isoDaysAgo(1), minutes: 15 }),
      w.logTime(w.member.user, { date: isoDaysAgo(1), minutes: 20 }),
    ]);
    for (const response of results) expect(response.status).toBe(201);
    // 6000 + 1500 + 2000 = 9500: both thresholds are crossed by the pair, announced exactly once.
    expect((await notices()).map((row) => row.threshold).sort()).toEqual([
      75, 90,
    ]);
    const titles = (await inbox(w.owner.user)).map((n) => n.title);
    expect(titles.length).toBeGreaterThanOrEqual(1);
    expect(titles.length).toBeLessThanOrEqual(2);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("notifies nobody without a manager and records nothing, so a manager assigned later is told (R7-02)", async () => {
    await setManager(null);
    await budget(1_000);
    await costEntry(1, 950);
    expect(await inbox(w.owner.user)).toHaveLength(0);
    // Nobody was told, so the crossing is not marked as announced.
    expect(await notices()).toHaveLength(0);
    await setManager(w.ownerPersonId);
    await costEntry(1, 10);
    expect((await inbox(w.owner.user)).map((n) => n.title)).toEqual([
      "Budget at 90%",
    ]);
    expect((await notices()).map((row) => row.threshold).sort()).toEqual([
      75, 90,
    ]);
    // Exactly once: a further write does not repeat it.
    await costEntry(1, 10);
    expect(await inbox(w.owner.user)).toHaveLength(1);
  });

  it("fires after cost tracking is switched on again, and the inbox hides it while it is off (R7-02, R7-06)", async () => {
    await setManager(w.ownerPersonId);
    await budget(1_000);
    // A time entry crosses the line while cost tracking is off: nobody is eligible.
    await w.addRate(w.member.personId, isoDaysAgo(60), 6000, "EUR");
    await setTimeFlags(w.workspaceId, { time: true, cost: false });
    const logged = await w.logTime(w.member.user, {
      date: isoDaysAgo(1),
      minutes: 10,
    });
    expect(logged.status, await logged.clone().text()).toBe(201);
    expect(await notices()).toHaveLength(0);
    await setTimeFlags(w.workspaceId, { time: true, cost: true });
    await costEntry(1, 10);
    expect(await inbox(w.owner.user)).toHaveLength(1);
    // Switched off again: the existing notice is no longer readable.
    await setTimeFlags(w.workspaceId, { time: true, cost: false });
    expect(await inbox(w.owner.user)).toHaveLength(0);
    await setTimeFlags(w.workspaceId, { time: true, cost: true });
    expect(await inbox(w.owner.user)).toHaveLength(1);
  });

  it("does not tell a manager who may not see rates (the figure would reveal them)", async () => {
    await setManager(w.lead.personId);
    await budget(1_000);
    await costEntry(1, 950);
    expect(await inbox(w.lead.user)).toHaveLength(0);
    expect(await inbox(w.owner.user)).toHaveLength(0);
  });

  it("never shows the notice to anyone but the manager", async () => {
    await setManager(w.ownerPersonId);
    await budget(1_000);
    await costEntry(1, 950);
    for (const user of [w.lead.user, w.member.user, w.other.user])
      expect(await inbox(user)).toHaveLength(0);
    expect(await inbox(w.owner.user)).toHaveLength(1);
  });

  it("drops the notice from the inbox once the manager loses reach to the project", async () => {
    await setManager(w.ownerPersonId);
    await budget(1_000);
    await costEntry(1, 950);
    expect(await inbox(w.owner.user)).toHaveLength(1);
    // Foreign workspace project: the same row, a different recipient context, stays invisible.
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, w.projectA.id));
    expect(await inbox(w.owner.user)).toHaveLength(0);
    expect(await db.select().from(costEntryTable)).toHaveLength(1);
  });
});
