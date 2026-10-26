/**
 * P5 time and cost, money: rates keyed by person/project with an effective date (TC-8..TC-10), the
 * rate captured on the entry (owner decision D4), rate invisibility without
 * time_entry:manage_rates on every response surface (TC-11), roll-ups (TC-7), activities (TC-2) and
 * project budgets (TC-15..TC-19).
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  cycleTable,
  estimatePointTable,
  estimateTable,
  moduleTable,
} from "../../apps/api/src/database/schema-p5-agile";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import {
  auditActionsOf,
  isoDaysAgo,
  setProjectTimeFlag,
  setTimeFlags,
  type TimeWorld,
  timeWorld,
} from "./helpers/p5-time";

let w: TimeWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await timeWorld();
});

type User = Parameters<TimeWorld["agent"]>[0];
type Entry = {
  id: string;
  minutes: number;
  date: string;
  rate?: {
    rateMinor: number | null;
    currency: string | null;
    costMinor: number | null;
  };
};

async function listEntries(user: User, query = "") {
  const response = await w.agent(
    user,
    `/api/time-entries?workspaceId=${w.workspaceId}&person=all${query}`,
  );
  return { response, body: (await response.json()) as { data: Entry[] } };
}
async function log(
  user: User,
  overrides: Record<string, unknown> = {},
  workItemId?: string,
) {
  const response = await w.logTime(user, overrides, workItemId);
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as Entry;
}

describe("the rate is captured on the entry (D4, TC-9)", () => {
  it("prices an entry at the rate effective on its date and keeps it when rates change later", async () => {
    expect(
      (await w.addRate(w.member.personId, isoDaysAgo(20), 6000)).status,
    ).toBe(201);
    const first = await log(w.member.user, {
      date: isoDaysAgo(2),
      minutes: 90,
    });
    // A raise takes effect from today; the earlier entry keeps what it was captured at.
    expect(
      (await w.addRate(w.member.personId, isoDaysAgo(0), 7000)).status,
    ).toBe(201);
    const second = await log(w.member.user, {
      date: isoDaysAgo(0),
      minutes: 60,
    });
    const { body } = await listEntries(w.owner.user);
    const byId = new Map(body.data.map((entry) => [entry.id, entry]));
    expect(byId.get(first.id)?.rate).toEqual({
      rateMinor: 6000,
      currency: "EUR",
      costMinor: 9000,
    });
    expect(byId.get(second.id)?.rate).toEqual({
      rateMinor: 7000,
      currency: "EUR",
      costMinor: 7000,
    });
  });

  it("prices the earlier date of an entry logged now at the earlier rate", async () => {
    await w.addRate(w.member.personId, isoDaysAgo(20), 6000);
    await w.addRate(w.member.personId, isoDaysAgo(3), 7000);
    const old = await log(w.member.user, { date: isoDaysAgo(5), minutes: 60 });
    const recent = await log(w.member.user, {
      date: isoDaysAgo(1),
      minutes: 60,
    });
    const { body } = await listEntries(w.owner.user);
    const rate = (id: string) =>
      body.data.find((e) => e.id === id)?.rate?.rateMinor;
    expect(rate(old.id)).toBe(6000);
    expect(rate(recent.id)).toBe(7000);
  });

  it("leaves a rate added retroactively out of entries already logged (they stay unpriced)", async () => {
    const entry = await log(w.member.user, { date: isoDaysAgo(4) });
    await w.addRate(w.member.personId, isoDaysAgo(10), 6000);
    const { body } = await listEntries(w.owner.user);
    expect(body.data.find((e) => e.id === entry.id)?.rate).toEqual({
      rateMinor: null,
      currency: null,
      costMinor: null,
    });
  });

  it("lets a project-specific rate win over the person's default on that project", async () => {
    await w.addRate(w.member.personId, isoDaysAgo(20), 6000, "EUR");
    await w.addRate(
      w.member.personId,
      isoDaysAgo(20),
      9000,
      "USD",
      w.projectA.id,
    );
    const entry = await log(w.member.user);
    const { body } = await listEntries(w.owner.user);
    expect(body.data.find((e) => e.id === entry.id)?.rate).toMatchObject({
      rateMinor: 9000,
      currency: "USD",
    });
  });

  it("captures the rate again when an entry moves to another date, and not for other edits", async () => {
    await w.addRate(w.member.personId, isoDaysAgo(20), 6000);
    await w.addRate(w.member.personId, isoDaysAgo(3), 7000);
    const entry = await log(w.member.user, { date: isoDaysAgo(10) });
    const patch = (body: unknown) =>
      w.agent(w.member.user, `/api/time-entries/${entry.id}`, {
        method: "PATCH",
        body,
      });
    await patch({ minutes: 30, description: "shorter" });
    let rate = (await listEntries(w.owner.user)).body.data.find(
      (e) => e.id === entry.id,
    )?.rate;
    expect(rate?.rateMinor).toBe(6000);
    await patch({ date: isoDaysAgo(1) });
    rate = (await listEntries(w.owner.user)).body.data.find(
      (e) => e.id === entry.id,
    )?.rate;
    expect(rate?.rateMinor).toBe(7000);
  });
});

describe("rates are invisible without time_entry:manage_rates (TC-11)", () => {
  beforeEach(async () => {
    await w.addRate(w.member.personId, isoDaysAgo(20), 6000);
  });

  it("strips rate and cost from create, patch, list and summary responses", async () => {
    const created = await w.logTime(w.member.user);
    const createdBody = await created.json();
    expect(JSON.stringify(createdBody)).not.toMatch(/rate|cost|6000|9000/i);
    const id = (createdBody as Entry).id;
    const patched = await w.agent(w.member.user, `/api/time-entries/${id}`, {
      method: "PATCH",
      body: { minutes: 120 },
    });
    expect(JSON.stringify(await patched.json())).not.toMatch(/"rate"|cost/i);
    for (const user of [w.member.user, w.lead.user]) {
      const list = await w.agent(
        user,
        `/api/time-entries?workspaceId=${w.workspaceId}${user === w.lead.user ? "&person=all" : ""}`,
      );
      expect(list.status).toBe(200);
      const text = JSON.stringify(await list.json());
      expect(text, text).not.toMatch(/"rate"|cost/i);
    }
    const summary = await w.agent(
      w.lead.user,
      `/api/time-entries/summary?workspaceId=${w.workspaceId}&projectId=${w.projectA.id}`,
    );
    expect(summary.status).toBe(200);
    const text = JSON.stringify(await summary.json());
    expect(text).not.toMatch(/cost|rate|byCurrency/i);
  });

  it("shows cost per currency, never summed, to a rate manager", async () => {
    await w.addRate(w.other.personId, isoDaysAgo(20), 9000, "USD");
    await log(w.member.user, { minutes: 60 });
    await log(w.other.user, { minutes: 30 });
    const summary = await w.agent(
      w.owner.user,
      `/api/time-entries/summary?workspaceId=${w.workspaceId}&projectId=${w.projectA.id}`,
    );
    const body = (await summary.json()) as {
      totalMinutes: number;
      cost: {
        byCurrency: Array<{ currency: string; costMinor: number }>;
        unpricedMinutes: number;
      };
    };
    expect(body.totalMinutes).toBe(90);
    expect(body.cost.byCurrency).toEqual([
      expect.objectContaining({ currency: "EUR", costMinor: 6000 }),
      expect.objectContaining({ currency: "USD", costMinor: 4500 }),
    ]);
    expect(body.cost.unpricedMinutes).toBe(0);
  });

  it("hides cost when feature.cost_tracking is off, even from a rate manager", async () => {
    await log(w.member.user);
    await setTimeFlags(w.workspaceId, { cost: false });
    const { body } = await listEntries(w.owner.user);
    expect(JSON.stringify(body)).not.toMatch(/"rate"|cost/i);
  });

  it("keeps the rate out of the entry's audit rows", async () => {
    await log(w.member.user);
    const rows = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "time_entry.created"));
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows.map((row) => row.after))).not.toMatch(
      /rate|6000|cost/i,
    );
  });

  it("refuses the rates API to everyone without the capability", async () => {
    for (const [name, user] of [
      ["member", w.member.user],
      ["lead", w.lead.user],
      ["viewer", w.viewer.user],
    ] as const) {
      const list = await w.agent(
        user,
        `/api/rates?workspaceId=${w.workspaceId}`,
      );
      expect(list.status, name).toBe(403);
      const create = await w.agent(user, "/api/rates", {
        method: "POST",
        body: {
          workspaceId: w.workspaceId,
          personId: w.member.personId,
          rateMinor: 1,
          currency: "EUR",
          effectiveFrom: isoDaysAgo(0),
        },
      });
      expect(create.status, name).toBe(403);
    }
  });
});

describe("the rates API", () => {
  it("creates, lists and audits rates, refusing a duplicate effective date and a bad currency", async () => {
    const created = await w.addRate(w.member.personId, isoDaysAgo(5), 5500);
    expect(created.status, await created.clone().text()).toBe(201);
    expect(await auditActionsOf(w.workspaceId)).toContain(
      "hourly_rate.created",
    );
    // The audit log is readable with workspace:manage_settings alone: no amount, no currency (P5-R3-08).
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "hourly_rate.created"));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify([audit[0]?.before, audit[0]?.after])).not.toMatch(
      /5500|EUR/u,
    );
    expect(JSON.stringify(audit[0]?.after)).not.toContain("rateMinor");
    expect(audit[0]?.after).toMatchObject({
      rateSet: true,
      personId: w.member.personId,
    });
    expect(
      (await w.addRate(w.member.personId, isoDaysAgo(5), 6000)).status,
    ).toBe(409);
    expect(
      (await w.addRate(w.member.personId, isoDaysAgo(4), 1, "eur")).status,
    ).toBe(400);
    expect((await w.addRate(w.member.personId, isoDaysAgo(4), -1)).status).toBe(
      400,
    );
    expect(
      (await w.addRate(w.member.personId, isoDaysAgo(4), 1.5)).status,
    ).toBe(400);
    const list = await w.agent(
      w.owner.user,
      `/api/rates?workspaceId=${w.workspaceId}`,
    );
    const body = (await list.json()) as {
      data: Array<{ rateMinor: number; personName: string }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.rateMinor).toBe(5500);
  });

  it("does not take a person or project from another workspace", async () => {
    const stranger = await createWorkspaceMember({ role: "owner" });
    const foreignPerson = (
      await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, stranger.user.id))
    )[0]?.id;
    expect((await w.addRate(foreignPerson ?? "x", isoDaysAgo(1))).status).toBe(
      404,
    );
    expect(
      (
        await w.addRate(
          w.member.personId,
          isoDaysAgo(1),
          1,
          "EUR",
          "no-such-project",
        )
      ).status,
    ).toBe(404);
  });

  it("is gated by feature.cost_tracking", async () => {
    await setTimeFlags(w.workspaceId, { cost: false });
    expect((await w.addRate(w.member.personId, isoDaysAgo(1))).status).toBe(
      409,
    );
  });

  it("answers another workspace's owner with a refusal", async () => {
    const stranger = await createWorkspaceMember({ role: "owner" });
    await setTimeFlags(stranger.workspace.id);
    const response = await w.agent(
      stranger.user,
      `/api/rates?workspaceId=${w.workspaceId}`,
    );
    expect([403, 404]).toContain(response.status);
  });
});

describe("roll-up (TC-7)", () => {
  it("includes descendants of a work item and breaks time down by activity and person", async () => {
    await log(w.member.user, { minutes: 60 }, w.itemA.id);
    await log(
      w.other.user,
      { minutes: 30, activityId: undefined },
      w.childItem.id,
    ).catch(() => undefined);
    const support = (
      await w.json<{ data: Array<{ id: string; name: string }> }>(
        await w.agent(
          w.owner.user,
          `/api/time-activities?workspaceId=${w.workspaceId}`,
        ),
      )
    ).data.find((activity) => activity.name === "Support");
    await log(
      w.other.user,
      { minutes: 30, activityId: support?.id },
      w.childItem.id,
    );
    const response = await w.agent(
      w.lead.user,
      `/api/time-entries/summary?workspaceId=${w.workspaceId}&workItemId=${w.itemA.id}`,
    );
    const body = (await response.json()) as {
      totalMinutes: number;
      byActivity: Array<{ label: string; minutes: number }>;
      byPerson: Array<{ key: string; minutes: number }>;
    };
    expect(body.totalMinutes).toBe(90);
    expect(
      Object.fromEntries(body.byActivity.map((r) => [r.label, r.minutes])),
    ).toEqual({
      Development: 60,
      Support: 30,
    });
    expect(body.byPerson.map((r) => r.minutes).sort()).toEqual([30, 60]);
  });

  it("rolls a cycle's time up from the work items assigned to it", async () => {
    const [cycle] = await db
      .insert(cycleTable)
      .values({
        workspaceId: w.workspaceId,
        projectId: w.projectA.id,
        name: "Sprint 1",
        startDate: isoDaysAgo(7),
        endDate: isoDaysAgo(-7),
      })
      .returning();
    await db
      .update(schema.workItemTable)
      .set({ cycleId: cycle?.id })
      .where(eq(schema.workItemTable.id, w.childItem.id));
    await log(w.member.user, { minutes: 40 }, w.itemA.id);
    await log(w.member.user, { minutes: 25 }, w.childItem.id);
    const response = await w.agent(
      w.lead.user,
      `/api/time-entries/summary?workspaceId=${w.workspaceId}&cycleId=${cycle?.id}`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      scope: string;
      totalMinutes: number;
    };
    expect(body.scope).toBe("cycle");
    expect(body.totalMinutes).toBe(25);
  });

  it("rolls a module's time up from the work items assigned to it", async () => {
    const [module] = await db
      .insert(moduleTable)
      .values({
        workspaceId: w.workspaceId,
        projectId: w.projectA.id,
        name: "Module rollup",
        createdBy: w.owner.user.id,
      })
      .returning();
    await db
      .update(schema.workItemTable)
      .set({ moduleId: module?.id })
      .where(eq(schema.workItemTable.id, w.childItem.id));
    await log(w.member.user, { minutes: 40 }, w.itemA.id);
    await log(w.member.user, { minutes: 25 }, w.childItem.id);
    const response = await w.agent(
      w.lead.user,
      `/api/time-entries/summary?workspaceId=${w.workspaceId}&moduleId=${module?.id}`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      scope: string;
      totalMinutes: number;
    };
    expect(body.scope).toBe("module");
    expect(body.totalMinutes).toBe(25);
  });

  it("needs time_entry:create (a member then sees only their own time, see below)", async () => {
    const response = await w.agent(
      w.viewer.user,
      `/api/time-entries/summary?workspaceId=${w.workspaceId}&projectId=${w.projectA.id}`,
    );
    expect(response.status).toBe(403);
  });

  it("asks for exactly one of workItemId and projectId", async () => {
    const both = await w.agent(
      w.lead.user,
      `/api/time-entries/summary?workspaceId=${w.workspaceId}&projectId=${w.projectA.id}&workItemId=${w.itemA.id}`,
    );
    expect(both.status).toBe(400);
  });
});

describe("activity types (TC-2)", () => {
  it("lists the four defaults to anyone who can log time", async () => {
    const response = await w.agent(
      w.member.user,
      `/api/time-activities?workspaceId=${w.workspaceId}`,
    );
    const body = (await response.json()) as { data: Array<{ name: string }> };
    expect(body.data.map((a) => a.name)).toEqual([
      "Development",
      "Support",
      "Meeting",
      "Travel",
    ]);
  });

  it("lets a settings manager add, rename and archive; archived types leave new entries", async () => {
    const add = await w.agent(w.owner.user, "/api/time-activities", {
      method: "POST",
      body: { workspaceId: w.workspaceId, name: "Training" },
    });
    expect(add.status).toBe(201);
    const created = (await add.json()) as { id: string };
    expect(
      (
        await w.agent(w.owner.user, "/api/time-activities", {
          method: "POST",
          body: { workspaceId: w.workspaceId, name: "Training" },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await w.agent(w.member.user, "/api/time-activities", {
          method: "POST",
          body: { workspaceId: w.workspaceId, name: "Nope" },
        })
      ).status,
    ).toBe(403);
    const archive = await w.agent(
      w.owner.user,
      `/api/time-activities/${created.id}?workspaceId=${w.workspaceId}`,
      { method: "PATCH", body: { archived: true } },
    );
    expect(archive.status).toBe(200);
    const response = await w.logTime(w.member.user, { activityId: created.id });
    expect(response.status).toBe(422);
    const visible = (await (
      await w.agent(
        w.owner.user,
        `/api/time-activities?workspaceId=${w.workspaceId}`,
      )
    ).json()) as { data: Array<{ id: string }> };
    expect(visible.data.some((a) => a.id === created.id)).toBe(false);
  });
});

describe("the summary is limited to the caller's own time without time_entry:read_any", () => {
  type Summary = {
    totalMinutes: number;
    billableMinutes: number;
    entryCount: number;
    byPerson: Array<{ key: string; minutes: number }>;
    byActivity: Array<{ minutes: number }>;
  };
  const summary = async (user: User) => {
    const response = await w.agent(
      user,
      `/api/time-entries/summary?workspaceId=${w.workspaceId}&projectId=${w.projectA.id}`,
    );
    return { response, body: (await response.json()) as Summary };
  };

  it("returns only the caller's minutes to a member, everyone's to a reader of any time", async () => {
    await log(w.member.user, { minutes: 60 });
    await log(w.other.user, { minutes: 30 });
    const own = await summary(w.member.user);
    expect(own.response.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body.totalMinutes).toBe(60);
    expect(own.body.entryCount).toBe(1);
    expect(own.body.byPerson.map((row) => row.key)).toEqual([
      w.member.personId,
    ]);
    expect(own.body.byActivity.reduce((sum, row) => sum + row.minutes, 0)).toBe(
      60,
    );
    const all = await summary(w.lead.user);
    expect(all.body.totalMinutes).toBe(90);
    expect(all.body.byPerson).toHaveLength(2);
  });

  it("does not let a budget:read member derive another person's minutes next to a cost (TC-11)", async () => {
    await w.addRate(w.other.personId, isoDaysAgo(20), 9000, "EUR");
    await log(w.other.user, { date: isoDaysAgo(1), minutes: 30 }); // 4500 EUR
    await w.agent(w.owner.user, `/api/projects/${w.projectA.id}/budgets`, {
      method: "POST",
      body: {
        name: "Q4",
        plannedAmountMinor: 10000,
        currency: "EUR",
        periodStart: isoDaysAgo(10),
        periodEnd: isoDaysAgo(-20),
      },
    });
    const budget = (await (
      await w.agent(w.member.user, `/api/projects/${w.projectA.id}/budget`)
    ).json()) as { data: Array<{ actualMinor?: number }>; byPerson: unknown[] };
    // Neither the project's cost nor the minutes behind it are the member's to see (TC-11).
    expect(budget.data[0]?.actualMinor).toBeUndefined();
    expect(budget.byPerson).toEqual([]);
    const own = await summary(w.member.user);
    expect(own.body.totalMinutes).toBe(0);
    expect(own.body.entryCount).toBe(0);
    expect(own.body.byPerson).toEqual([]);
    expect(JSON.stringify(own.body)).not.toContain(w.other.personId);
  });
});

describe("project budgets (TC-15..TC-19)", () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    name: "Q4",
    plannedAmountMinor: 10000,
    currency: "EUR",
    periodStart: isoDaysAgo(10),
    periodEnd: isoDaysAgo(-20),
    ...extra,
  });
  const create = (
    user: User,
    extra: Record<string, unknown> = {},
    projectId = w.projectA.id,
  ) =>
    w.agent(user, `/api/projects/${projectId}/budgets`, {
      method: "POST",
      body: body(extra),
    });
  const get = (user: User, projectId = w.projectA.id) =>
    w.agent(user, `/api/projects/${projectId}/budget`);

  type Budget = {
    data: Array<{
      name: string;
      figuresHidden: boolean;
      actualMinor?: number;
      remainingMinor?: number;
      plannedAmountMinor: number;
      thresholdReached?: number | null;
      committedMinor: number | null;
      committedByCurrency?: Array<{
        currency: string;
        amountMinor: number;
        taskCount: number;
      }>;
      committedUnknown?: {
        taskCount: number;
        reasons: {
          unscheduled: number;
          nonTime: number;
          unassigned: number;
          unrated: number;
        };
        knownRemainingMinutes: number;
      };
      otherCurrencies?: Array<{ currency: string; costMinor: number }>;
      unpricedMinutes?: number;
    }>;
    byActivity: unknown[];
    byPerson: unknown[];
  };

  it("computes actuals from captured rates inside the period, per currency, and reports thresholds", async () => {
    await w.addRate(w.member.personId, isoDaysAgo(20), 6000, "EUR");
    await w.addRate(w.other.personId, isoDaysAgo(20), 9000, "USD");
    await log(w.member.user, { date: isoDaysAgo(1), minutes: 90 }); // 9000 EUR
    await log(w.member.user, { date: isoDaysAgo(15), minutes: 600 }); // before the period
    await log(w.other.user, { date: isoDaysAgo(1), minutes: 60 }); // 9000 USD, kept apart
    await log(w.lead.user, { date: isoDaysAgo(1), minutes: 30 }); // unpriced
    const created = await create(w.owner.user);
    expect(created.status, await created.clone().text()).toBe(201);
    const response = await get(w.owner.user);
    const budget = (await response.json()) as Budget;
    const row = budget.data[0];
    expect(row?.plannedAmountMinor).toBe(10000);
    expect(row?.actualMinor).toBe(9000);
    expect(row?.remainingMinor).toBe(1000);
    expect(row?.thresholdReached).toBe(90);
    expect(row?.otherCurrencies).toEqual([
      expect.objectContaining({ currency: "USD", costMinor: 9000 }),
    ]);
    expect(row?.unpricedMinutes).toBe(30);
    expect(row?.committedMinor).toBeNull();
    expect(budget.byActivity.length).toBeGreaterThan(0);
    expect(await auditActionsOf(w.workspaceId)).toContain("budget.created");
  });

  it("shows a budget:read holder the planned amount only, no figure derived from priced time", async () => {
    await w.addRate(w.member.personId, isoDaysAgo(20), 6000);
    await w.addRate(w.other.personId, isoDaysAgo(20), 9000, "USD");
    await log(w.member.user, { date: isoDaysAgo(1), minutes: 60 });
    await log(w.other.user, { date: isoDaysAgo(1), minutes: 30 });
    await log(w.lead.user, { date: isoDaysAgo(1), minutes: 30 }); // unpriced
    await create(w.owner.user);
    const response = await get(w.member.user);
    expect(response.status, await response.clone().text()).toBe(200);
    const budget = (await response.json()) as Budget;
    const row = budget.data[0] as Record<string, unknown>;
    expect(row.plannedAmountMinor).toBe(10000);
    expect(row.figuresHidden).toBe(true);
    for (const key of [
      "actualMinor",
      "remainingMinor",
      "thresholdReached",
      "otherCurrencies",
      "unpricedMinutes",
      "committedMinor",
      "committedByCurrency",
      "committedUnknown",
    ])
      expect(key in row, key).toBe(false);
    expect(JSON.stringify(budget)).not.toContain('"pricedMinutes"');
    expect(budget.byActivity).toEqual([]);
    expect(budget.byPerson).toEqual([]);
    // The owner, who may see rates anyway, gets the full figures and the priced minutes.
    const full = (await (await get(w.owner.user)).json()) as Budget;
    expect(full.data[0]?.figuresHidden).toBe(false);
    expect(full.data[0]?.actualMinor).toBe(6000);
    expect(full.data[0]?.otherCurrencies).toEqual([
      expect.objectContaining({ currency: "USD", costMinor: 4500 }),
    ]);
    expect(JSON.stringify(full)).toContain('"pricedMinutes"');
  });

  it("values only open leaf time estimates due in-period at current rates and reports unknowns", async () => {
    const today = isoDaysAgo(0);
    const dueSoon = isoDaysAgo(-10);
    const dueOutside = isoDaysAgo(-40);
    const periodEnd = isoDaysAgo(-30);
    const timeEstimate = (
      await db
        .insert(estimateTable)
        .values({
          workspaceId: w.workspaceId,
          projectId: w.projectA.id,
          system: "time",
          active: true,
        })
        .returning()
    )[0];
    const pointsEstimate = (
      await db
        .insert(estimateTable)
        .values({
          workspaceId: w.workspaceId,
          projectId: w.projectA.id,
          system: "points",
          active: false,
        })
        .returning()
    )[0];
    if (!timeEstimate || !pointsEstimate) throw new Error("estimate missing");
    const points = await db
      .insert(estimatePointTable)
      .values([
        {
          estimateId: timeEstimate.id,
          key: "two-hours",
          value: "2h",
          weight: "120",
        },
        {
          estimateId: timeEstimate.id,
          key: "half-hour",
          value: "30m",
          weight: "30",
        },
        {
          estimateId: timeEstimate.id,
          key: "one-hour",
          value: "1h",
          weight: "60",
        },
        {
          estimateId: timeEstimate.id,
          key: "ninety",
          value: "90m",
          weight: "90",
        },
        { estimateId: pointsEstimate.id, key: "five", value: "5", weight: "5" },
      ])
      .returning();
    const point = (key: string) => points.find((row) => row.key === key)?.id;
    const newRows = await db
      .insert(schema.workItemTable)
      .values(
        [
          "Unscheduled",
          "Unassigned",
          "Unrated",
          "Non-time estimate",
          "Outside budget period",
          "No remaining estimate",
          "USD estimate",
        ].map((title, index) => ({
          workspaceId: w.workspaceId,
          projectId: w.projectA.id,
          typeId: w.childItem.typeId,
          stateId: w.childItem.stateId,
          title,
          number: 90_000 + index,
          key: `TC17-${randomUUID()}`,
        })),
      )
      .returning();
    const [
      unscheduled,
      unassigned,
      unrated,
      nonTime,
      outside,
      zeroRemaining,
      pricedUsd,
    ] = newRows;
    if (
      !unscheduled ||
      !unassigned ||
      !unrated ||
      !nonTime ||
      !outside ||
      !zeroRemaining ||
      !pricedUsd
    )
      throw new Error("forecast task missing");

    const setForecast = async (
      itemId: string,
      input: {
        dueDate?: string;
        assigneeId?: string | null;
        pointId?: string;
      },
    ) => {
      await db
        .update(schema.workItemTable)
        .set({
          dueDate: input.dueDate
            ? new Date(`${input.dueDate}T00:00:00.000Z`)
            : null,
          assigneeId: input.assigneeId ?? null,
          estimatePointId: input.pointId ?? null,
        })
        .where(eq(schema.workItemTable.id, itemId));
    };
    await setForecast(w.itemA.id, {
      dueDate: dueSoon,
      assigneeId: w.member.personId,
      pointId: point("two-hours"),
    });
    await setForecast(w.childItem.id, {
      dueDate: dueSoon,
      assigneeId: w.member.personId,
      pointId: point("two-hours"),
    });
    await setForecast(unscheduled.id, {
      assigneeId: w.member.personId,
      pointId: point("one-hour"),
    });
    await setForecast(unassigned.id, {
      dueDate: dueSoon,
      pointId: point("ninety"),
    });
    await setForecast(unrated.id, {
      dueDate: dueSoon,
      assigneeId: w.lead.personId,
      pointId: point("one-hour"),
    });
    await setForecast(nonTime.id, {
      dueDate: dueSoon,
      assigneeId: w.member.personId,
      pointId: point("five"),
    });
    await setForecast(outside.id, {
      dueDate: dueOutside,
      assigneeId: w.member.personId,
      pointId: point("two-hours"),
    });
    await setForecast(zeroRemaining.id, {
      dueDate: dueSoon,
      assigneeId: w.member.personId,
      pointId: point("half-hour"),
    });
    await setForecast(pricedUsd.id, {
      dueDate: dueSoon,
      assigneeId: w.other.personId,
      pointId: point("one-hour"),
    });

    await w.addRate(w.member.personId, isoDaysAgo(20), 6000, "EUR");
    await w.addRate(w.other.personId, isoDaysAgo(20), 12_000, "USD");
    await log(w.member.user, { date: today, minutes: 60 }, w.childItem.id);
    await log(w.member.user, { date: today, minutes: 60 }, zeroRemaining.id);
    await w.addRate(w.member.personId, today, 9000, "EUR", w.projectA.id);

    await create(w.owner.user, {
      periodStart: today,
      periodEnd,
    });
    const response = await get(w.owner.user);
    expect(response.status, await response.clone().text()).toBe(200);
    const budget = (await response.json()) as Budget;
    const row = budget.data[0];
    expect(row).toMatchObject({
      committedMinor: null,
      committedByCurrency: [
        { currency: "EUR", amountMinor: 9000, taskCount: 2 },
        { currency: "USD", amountMinor: 12_000, taskCount: 1 },
      ],
      committedUnknown: {
        taskCount: 4,
        reasons: { unscheduled: 1, nonTime: 1, unassigned: 1, unrated: 1 },
        knownRemainingMinutes: 210,
      },
    });
    expect(JSON.stringify(row?.committedByCurrency)).not.toContain(
      "Outside budget period",
    );
    expect(row?.actualMinor).toBe(12_000);

    const hiddenResponse = await get(w.lead.user);
    expect(hiddenResponse.status).toBe(200);
    const hidden = (await hiddenResponse.json()) as Budget;
    expect(hidden.data[0]).not.toHaveProperty("committedMinor");
    expect(hidden.data[0]).not.toHaveProperty("committedByCurrency");
    expect(hidden.data[0]).not.toHaveProperty("committedUnknown");
  });

  it("does not let a lead without manage_rates infer a colleague's rate by polling the budget (P5-R3-02)", async () => {
    await w.addRate(w.other.personId, isoDaysAgo(20), 9000, "EUR");
    await create(w.owner.user);
    const poll = async () => {
      const response = await get(w.lead.user);
      expect(response.status, await response.clone().text()).toBe(200);
      return response.text();
    };
    const before = await poll();
    await log(w.other.user, { date: isoDaysAgo(1), minutes: 60 }); // 9000 EUR
    const after = await poll();
    // Identical: nothing moves with the colleague's entry, so there is no delta to divide.
    expect(after).toBe(before);
    const row = (JSON.parse(after) as { data: Array<Record<string, unknown>> })
      .data[0] as Record<string, unknown>;
    for (const key of [
      "actualMinor",
      "remainingMinor",
      "thresholdReached",
      "otherCurrencies",
      "unpricedMinutes",
    ])
      expect(key in row, key).toBe(false);
    expect(row.plannedAmountMinor).toBe(10000);
  });

  it("honours a project-level switch inside a workspace that has cost tracking on", async () => {
    await setProjectTimeFlag(w.projectA.id, "feature.cost_tracking", false);
    expect((await get(w.owner.user)).status).toBe(409);
    expect((await create(w.owner.user)).status).toBe(409);
    expect((await get(w.owner.user, w.projectB.id)).status).toBe(200);
  });

  it("refuses managing a budget without budget:manage, and bad bodies", async () => {
    expect((await create(w.member.user)).status).toBe(403);
    expect(
      (await create(w.owner.user, { periodEnd: isoDaysAgo(30) })).status,
    ).toBe(400);
    expect(
      (await create(w.owner.user, { plannedAmountMinor: -1 })).status,
    ).toBe(400);
    expect((await create(w.owner.user, { currency: "euro" })).status).toBe(400);
  });

  it("does not show or accept a budget on a project the caller cannot reach", async () => {
    expect((await create(w.owner.user, {}, w.projectB.id)).status).toBe(201);
    expect((await get(w.member.user, w.projectB.id)).status).toBe(404);
    expect((await create(w.member.user, {}, w.projectB.id)).status).toBe(404);
  });

  it("answers another workspace with a refusal", async () => {
    const stranger = await createWorkspaceMember({ role: "owner" });
    await setTimeFlags(stranger.workspace.id);
    const response = await get(stranger.user);
    expect([403, 404]).toContain(response.status);
  });

  it("is gated by feature.cost_tracking", async () => {
    await setTimeFlags(w.workspaceId, { cost: false });
    expect((await get(w.owner.user)).status).toBe(409);
  });
});
