/**
 * P5 time and cost, cost: cost types (TC-12), cost entries on a project or work item with the rate
 * captured on the row (TC-13, TC-14), permission and amount stripping (TC-11), reach and tenant
 * isolation, deletion through the pending-action flow with the legal-hold fence, and the actuals
 * of a budget including cost entries per currency (TC-16, TC-19).
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  costEntryTable,
  costTypeTable,
} from "../../apps/api/src/database/schema-p5-time";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, grantProjectRole } from "./helpers/fixtures";
import {
  isoDaysAgo,
  setProjectTimeFlag,
  setTimeFlags,
  type TimeWorld,
  timeWorld,
} from "./helpers/p5-time";
import {
  approvePendingDeletion,
  ensureAgentSession,
  type PendingDeletionBody,
} from "./helpers/pending-deletion";

let w: TimeWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await timeWorld();
  // Project routes evaluate the project role, which overrides the workspace role for that project
  // (timeWorld gives the owner a budget-only project role): add the capability cost writes need.
  for (const project of [w.projectA, w.projectB])
    await grantProjectRole(w.owner.user.id, project.id, [
      "time_entry:manage_rates",
    ]);
});

type User = Parameters<TimeWorld["agent"]>[0];
type CostType = {
  id: string;
  name: string;
  unit: string;
  defaultRateMinor?: number | null;
  currency: string;
  archived: boolean;
};
type CostEntry = {
  id: string;
  units: number;
  currency: string;
  workItemId: string | null;
  costTypeName: string;
  rateMinor?: number;
  amountMinor?: number;
  note: string | null;
};
type Costs = {
  data: CostEntry[];
  canManage: boolean;
  costTypes?: CostType[];
  totals?: Array<{ currency: string; amountMinor: number; entryCount: number }>;
};

async function addType(
  user: User = w.owner.user,
  overrides: Record<string, unknown> = {},
) {
  return w.agent(user, "/api/cost-types", {
    method: "POST",
    body: {
      workspaceId: w.workspaceId,
      name: "Licence",
      unit: "seat",
      defaultRateMinor: 2500,
      currency: "EUR",
      ...overrides,
    },
  });
}
async function makeType(overrides: Record<string, unknown> = {}) {
  const response = await addType(w.owner.user, overrides);
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as CostType;
}
function addCost(
  user: User,
  typeId: string,
  overrides: Record<string, unknown> = {},
  projectId = w.projectA.id,
) {
  return w.agent(user, `/api/projects/${projectId}/costs`, {
    method: "POST",
    body: { costTypeId: typeId, date: isoDaysAgo(0), ...overrides },
  });
}
async function logCost(
  typeId: string,
  overrides: Record<string, unknown> = {},
  projectId = w.projectA.id,
) {
  const response = await addCost(w.owner.user, typeId, overrides, projectId);
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as CostEntry;
}
async function listCosts(user: User, query = "", projectId = w.projectA.id) {
  const response = await w.agent(
    user,
    `/api/projects/${projectId}/costs${query}`,
  );
  const text = await response.clone().text();
  let body = {} as Costs;
  try {
    body = JSON.parse(text) as Costs;
  } catch {
    // An error answer is plain text; the status is what the caller asserts.
  }
  return { response, body };
}

describe("cost types (TC-12)", () => {
  it("lets a rate manager add, list, edit and archive them", async () => {
    const created = await makeType();
    expect(created).toMatchObject({
      name: "Licence",
      unit: "seat",
      defaultRateMinor: 2500,
      currency: "EUR",
      archived: false,
    });
    const list = (await (
      await w.agent(
        w.owner.user,
        `/api/cost-types?workspaceId=${w.workspaceId}`,
      )
    ).json()) as { data: CostType[] };
    expect(list.data.map((type) => type.name)).toEqual(["Licence"]);
    const edited = await w.agent(
      w.owner.user,
      `/api/cost-types/${created.id}?workspaceId=${w.workspaceId}`,
      { method: "PATCH", body: { unit: "licence", defaultRateMinor: 3000 } },
    );
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({
      unit: "licence",
      defaultRateMinor: 3000,
    });
    const archived = await w.agent(
      w.owner.user,
      `/api/cost-types/${created.id}?workspaceId=${w.workspaceId}`,
      { method: "PATCH", body: { archived: true } },
    );
    expect(await archived.json()).toMatchObject({ archived: true });
    const active = (await (
      await w.agent(
        w.owner.user,
        `/api/cost-types?workspaceId=${w.workspaceId}`,
      )
    ).json()) as { data: CostType[] };
    expect(active.data).toHaveLength(0);
    const all = (await (
      await w.agent(
        w.owner.user,
        `/api/cost-types?workspaceId=${w.workspaceId}&includeArchived=true`,
      )
    ).json()) as { data: CostType[] };
    expect(all.data).toHaveLength(1);
  });

  it("refuses a duplicate name and an archived type for new entries", async () => {
    const type = await makeType();
    expect((await addType()).status).toBe(409);
    await w.agent(
      w.owner.user,
      `/api/cost-types/${type.id}?workspaceId=${w.workspaceId}`,
      { method: "PATCH", body: { archived: true } },
    );
    const refused = await addCost(w.owner.user, type.id);
    expect(refused.status).toBe(422);
    expect(await refused.text()).toContain("cost_type_unavailable");
  });

  it("is closed to everyone without time_entry:manage_rates", async () => {
    for (const user of [w.lead.user, w.member.user, w.viewer.user]) {
      expect((await addType(user, { name: `T-${user.id}` })).status).toBe(403);
      expect(
        (await w.agent(user, `/api/cost-types?workspaceId=${w.workspaceId}`))
          .status,
      ).toBe(403);
    }
    expect(await db.select().from(costTypeTable)).toHaveLength(0);
  });

  it("is switched off with cost tracking", async () => {
    await setTimeFlags(w.workspaceId, { cost: false });
    expect((await addType()).status).toBe(409);
  });

  it("never lets another workspace see or edit a type", async () => {
    const type = await makeType();
    const stranger = await createWorkspaceMember({ role: "owner" });
    await setTimeFlags(stranger.workspace.id);
    const other = await w.agent(
      stranger.user,
      `/api/cost-types/${type.id}?workspaceId=${stranger.workspace.id}`,
      { method: "PATCH", body: { name: "Hijacked" } },
    );
    expect(other.status).toBe(404);
    const list = (await (
      await w.agent(
        stranger.user,
        `/api/cost-types?workspaceId=${stranger.workspace.id}`,
      )
    ).json()) as { data: CostType[] };
    expect(list.data).toHaveLength(0);
    expect(
      (
        await w.agent(
          stranger.user,
          `/api/cost-types?workspaceId=${w.workspaceId}`,
        )
      ).status,
    ).toBe(403);
  });
});

describe("cost entries (TC-13, TC-14)", () => {
  it("prices units at the type's default rate and captures it on the row", async () => {
    const type = await makeType();
    const entry = await logCost(type.id, { units: 3, note: "Seats for Q4" });
    expect(entry).toMatchObject({
      units: 3,
      rateMinor: 2500,
      amountMinor: 7500,
      currency: "EUR",
      costTypeName: "Licence",
      workItemId: null,
      note: "Seats for Q4",
    });
    // A later change of the default rate never rewrites logged cost.
    await w.agent(
      w.owner.user,
      `/api/cost-types/${type.id}?workspaceId=${w.workspaceId}`,
      { method: "PATCH", body: { defaultRateMinor: 9000 } },
    );
    const { body } = await listCosts(w.owner.user);
    expect(body.data[0]).toMatchObject({ rateMinor: 2500, amountMinor: 7500 });
    const next = await logCost(type.id, { units: 1 });
    expect(next.amountMinor).toBe(9000);
  });

  it("takes an explicit rate and currency, and refuses an entry that cannot be priced", async () => {
    const free = await makeType({ name: "Travel", defaultRateMinor: null });
    const unpriced = await addCost(w.owner.user, free.id, { units: 12 });
    expect(unpriced.status).toBe(422);
    expect(await unpriced.text()).toContain("rate_required");
    const priced = await logCost(free.id, {
      units: 12,
      rateMinor: 70,
      currency: "USD",
    });
    expect(priced).toMatchObject({
      amountMinor: 840,
      currency: "USD",
      rateMinor: 70,
    });
  });

  it("attaches to a work item or directly to the project, and rolls an item up from its sub-items", async () => {
    const type = await makeType();
    await logCost(type.id, { workItemId: w.itemA.id });
    await logCost(type.id, { workItemId: w.childItem.id, units: 2 });
    await logCost(type.id, {});
    const all = await listCosts(w.owner.user);
    expect(all.body.data).toHaveLength(3);
    const item = await listCosts(w.owner.user, `?workItemId=${w.itemA.id}`);
    expect(item.body.data).toHaveLength(2);
    expect(item.body.totals).toEqual([
      { currency: "EUR", amountMinor: 7500, entryCount: 2 },
    ]);
    const child = await listCosts(
      w.owner.user,
      `?workItemId=${w.childItem.id}`,
    );
    expect(child.body.data).toHaveLength(1);
    // A work item of another project is not a valid attachment.
    const wrong = await addCost(w.owner.user, type.id, {
      workItemId: w.itemB.id,
    });
    expect(wrong.status).toBe(404);
  });

  it("groups totals per currency and never sums across currencies (TC-19)", async () => {
    const eur = await makeType();
    const usd = await makeType({ name: "Hosting", currency: "USD" });
    await logCost(eur.id, { units: 2 });
    await logCost(usd.id, { units: 1 });
    const { body } = await listCosts(w.owner.user);
    expect(body.totals).toEqual([
      { currency: "EUR", amountMinor: 5000, entryCount: 1 },
      { currency: "USD", amountMinor: 2500, entryCount: 1 },
    ]);
  });

  it("refuses a future date and accepts a backdated one for a holder of time_entry:log_backdated", async () => {
    const type = await makeType();
    const future = await addCost(w.owner.user, type.id, {
      date: isoDaysAgo(-3),
    });
    expect(future.status).toBe(422);
    expect(await future.text()).toContain("date_in_future");
    const old = await addCost(w.owner.user, type.id, { date: isoDaysAgo(90) });
    expect(old.status).toBe(201);
  });

  it("edits units and keeps the captured rate unless a new one is given", async () => {
    const type = await makeType();
    const entry = await logCost(type.id, { units: 2 });
    await w.agent(
      w.owner.user,
      `/api/cost-types/${type.id}?workspaceId=${w.workspaceId}`,
      { method: "PATCH", body: { defaultRateMinor: 9000 } },
    );
    const patch = (body: unknown, user: User = w.owner.user) =>
      w.agent(user, `/api/cost-entries/${entry.id}`, {
        method: "PATCH",
        body,
      });
    const units = await patch({ units: 4 });
    expect(units.status).toBe(200);
    expect(await units.json()).toMatchObject({
      units: 4,
      rateMinor: 2500,
      amountMinor: 10000,
    });
    const rate = await patch({ rateMinor: 100, note: null });
    expect(await rate.json()).toMatchObject({
      rateMinor: 100,
      amountMinor: 400,
      note: null,
    });
    expect((await patch({ units: 9 }, w.lead.user)).status).toBe(403);
    const row = (await db.select().from(costEntryTable))[0];
    expect(row?.amountMinor).toBe(400);
  });
});

describe("permissions and amount stripping (TC-11)", () => {
  it("shows units, type and note to a budget reader but no rate, amount, total or cost type", async () => {
    const type = await makeType();
    await logCost(type.id, { units: 3, note: "Seats" });
    for (const user of [w.member.user, w.lead.user]) {
      const { response, body } = await listCosts(user);
      expect(response.status).toBe(200);
      expect(body.canManage).toBe(false);
      expect(body.data[0]).toMatchObject({
        units: 3,
        costTypeName: "Licence",
        note: "Seats",
      });
      const raw = JSON.stringify(body);
      expect(raw).not.toContain("rateMinor");
      expect(raw).not.toContain("amountMinor");
      expect(body.totals).toBeUndefined();
      expect(body.costTypes).toBeUndefined();
    }
    const manager = await listCosts(w.owner.user);
    expect(manager.body.canManage).toBe(true);
    expect(manager.body.totals).toHaveLength(1);
    expect(manager.body.costTypes?.map((entry) => entry.name)).toEqual([
      "Licence",
    ]);
  });

  it("refuses to read without budget:read and to write without time_entry:manage_rates", async () => {
    const type = await makeType();
    const entry = await logCost(type.id);
    expect((await listCosts(w.viewer.user)).response.status).toBe(403);
    for (const user of [w.member.user, w.lead.user, w.other.user]) {
      expect((await addCost(user, type.id)).status).toBe(403);
      expect(
        (
          await w.agent(user, `/api/cost-entries/${entry.id}`, {
            method: "PATCH",
            body: { units: 2 },
          })
        ).status,
      ).toBe(403);
      await ensureAgentSession(user.id);
      expect(
        (
          await w.agent(user, `/api/cost-entries/${entry.id}`, {
            method: "DELETE",
          })
        ).status,
      ).toBe(403);
    }
    expect(await db.select().from(costEntryTable)).toHaveLength(1);
  });

  it("keeps rate and amount out of the audit rows", async () => {
    const type = await makeType({ defaultRateMinor: 123_456 });
    const entry = await logCost(type.id, { units: 7 });
    await w.agent(w.owner.user, `/api/cost-entries/${entry.id}`, {
      method: "PATCH",
      body: { units: 8, rateMinor: 987_654 },
    });
    const rows = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.workspaceId, w.workspaceId));
    const mine = rows.filter(
      (row) =>
        row.action.startsWith("cost_entry.") ||
        row.action.startsWith("cost_type."),
    );
    expect(mine.map((row) => row.action).sort()).toEqual([
      "cost_entry.created",
      "cost_entry.updated",
      "cost_type.created",
    ]);
    const raw = JSON.stringify(mine, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    for (const secret of ["123456", "987654", "864192", "rateMinor"])
      expect(raw).not.toContain(secret);
  });

  it("is switched off by a project-level cost tracking switch", async () => {
    const type = await makeType();
    await setProjectTimeFlag(w.projectA.id, "feature.cost_tracking", false);
    expect((await addCost(w.owner.user, type.id)).status).toBe(409);
    expect((await listCosts(w.owner.user)).response.status).toBe(409);
  });
});

describe("a project role override applies to every cost write alike", () => {
  it("refuses create, edit and delete, and withholds the quick-add, when the project role drops time_entry:manage_rates", async () => {
    const type = await makeType();
    const entry = await logCost(type.id);
    // timeWorld gives the owner a budget-only project role: drop the extra capability again.
    const [membership] = await db
      .select({ roleId: schema.membershipTable.roleId })
      .from(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, w.ownerPersonId),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, w.projectA.id),
        ),
      );
    await db
      .update(schema.roleTable)
      .set({ capabilities: ["budget:read", "budget:manage"] })
      .where(eq(schema.roleTable.id, membership?.roleId ?? ""));
    expect((await addCost(w.owner.user, type.id)).status).toBe(403);
    expect(
      (
        await w.agent(w.owner.user, `/api/cost-entries/${entry.id}`, {
          method: "PATCH",
          body: { units: 2 },
        })
      ).status,
    ).toBe(403);
    await ensureAgentSession(w.owner.user.id);
    expect(
      (
        await w.agent(w.owner.user, `/api/cost-entries/${entry.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(403);
    const { body } = await listCosts(w.owner.user);
    expect(body.canManage).toBe(false);
    expect(body.costTypes).toBeUndefined();
    expect(await db.select().from(costEntryTable)).toHaveLength(1);
  });
});

describe("reach and tenant isolation", () => {
  it("answers 404 for a project the caller cannot reach and never leaks a foreign entry", async () => {
    const type = await makeType();
    const hidden = await logCost(type.id, {}, w.projectB.id);
    expect(
      (await listCosts(w.lead.user, "", w.projectB.id)).response.status,
    ).toBe(404);
    expect(
      (
        await w.agent(w.lead.user, `/api/cost-entries/${hidden.id}`, {
          method: "PATCH",
          body: { units: 5 },
        })
      ).status,
    ).toBe(404);
    const stranger = await createWorkspaceMember({ role: "owner" });
    await setTimeFlags(stranger.workspace.id);
    expect(
      (
        await w.agent(stranger.user, `/api/cost-entries/${hidden.id}`, {
          method: "PATCH",
          body: { units: 5 },
        })
      ).status,
    ).toBe(404);
    await ensureAgentSession(stranger.user.id);
    expect(
      (
        await w.agent(stranger.user, `/api/cost-entries/${hidden.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (await listCosts(stranger.user, "", w.projectA.id)).response.status,
    ).toBeGreaterThanOrEqual(403);
  });

  it("refuses a cost type of another workspace", async () => {
    const stranger = await createWorkspaceMember({ role: "owner" });
    await setTimeFlags(stranger.workspace.id);
    const foreign = (await (
      await w.agent(stranger.user, "/api/cost-types", {
        method: "POST",
        body: {
          workspaceId: stranger.workspace.id,
          name: "Foreign",
          unit: "unit",
          defaultRateMinor: 100,
          currency: "EUR",
        },
      })
    ).json()) as CostType;
    const refused = await addCost(w.owner.user, foreign.id);
    expect(refused.status).toBe(422);
    expect(await refused.text()).toContain("cost_type_unavailable");
  });

  it("logs for another workspace member only, never for someone outside", async () => {
    const type = await makeType();
    const forOther = await addCost(w.owner.user, type.id, {
      personId: w.member.personId,
    });
    expect(forOther.status).toBe(201);
    const stranger = await createWorkspaceMember({ role: "owner" });
    const foreignPerson = (
      await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, stranger.user.id))
    )[0];
    const refused = await addCost(w.owner.user, type.id, {
      personId: foreignPerson?.id ?? "missing",
    });
    expect(refused.status).toBe(422);
  });
});

describe("deleting a cost entry goes through a pending action", () => {
  async function requestDelete(id: string) {
    await ensureAgentSession(w.owner.user.id);
    return w.agent(w.owner.user, `/api/cost-entries/${id}`, {
      method: "DELETE",
    });
  }

  it("answers 202, keeps the entry until approval, then removes it with an audit row", async () => {
    const type = await makeType();
    const entry = await logCost(type.id);
    const response = await requestDelete(entry.id);
    expect(response.status, await response.clone().text()).toBe(202);
    const pending = (await response.json()) as PendingDeletionBody;
    expect(await db.select().from(costEntryTable)).toHaveLength(1);
    const approved = await approvePendingDeletion(
      w.app,
      w.owner.user.id,
      pending,
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(await db.select().from(costEntryTable)).toHaveLength(0);
    const audit = await db
      .select({ action: schema.auditLogTable.action })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.workspaceId, w.workspaceId));
    expect(audit.map((row) => row.action)).toContain("cost_entry.deleted");
  });

  for (const scope of ["person", "organisation"] as const) {
    it(`an open ${scope} hold refuses the approved deletion with 409 legal_hold`, async () => {
      const type = await makeType();
      const entry = await logCost(type.id, { personId: w.member.personId });
      const pending = (await (
        await requestDelete(entry.id)
      ).json()) as PendingDeletionBody;
      const [hold] = await db
        .insert(schema.legalHoldTable)
        .values({
          scope,
          scopeId:
            scope === "person"
              ? w.member.personId
              : ((
                  await db
                    .select({ id: schema.workspaceTable.organisationId })
                    .from(schema.workspaceTable)
                    .where(eq(schema.workspaceTable.id, w.workspaceId))
                )[0]?.id ?? ""),
          placedBy: "compliance-officer",
          reason: "litigation",
        })
        .returning();
      const refused = await approvePendingDeletion(
        w.app,
        w.owner.user.id,
        pending,
      );
      expect(refused.status, await refused.clone().text()).toBe(409);
      expect(await refused.text()).toContain("legal_hold");
      expect(await db.select().from(costEntryTable)).toHaveLength(1);
      const upFront = await requestDelete(entry.id);
      expect(upFront.status).toBe(409);
      await db
        .update(schema.legalHoldTable)
        .set({ liftedAt: new Date(), liftedBy: "compliance-officer" })
        .where(eq(schema.legalHoldTable.id, hold?.id ?? ""));
      const approved = await approvePendingDeletion(
        w.app,
        w.owner.user.id,
        pending,
      );
      expect(approved.status, await approved.clone().text()).toBe(200);
      expect(await db.select().from(costEntryTable)).toHaveLength(0);
    });
  }

  it("an open hold on the user who recorded the entry fences it too", async () => {
    const type = await makeType();
    const entry = await logCost(type.id, { personId: w.member.personId });
    const ownerPerson = w.ownerPersonId;
    await db.insert(schema.legalHoldTable).values({
      scope: "person",
      scopeId: ownerPerson,
      placedBy: "compliance-officer",
      reason: "litigation",
    });
    const upFront = await requestDelete(entry.id);
    expect(upFront.status).toBe(409);
    expect(await upFront.text()).toContain("legal_hold");
  });
});

describe("budget actuals include cost entries (TC-16)", () => {
  async function createBudget(overrides: Record<string, unknown> = {}) {
    return w.agent(w.owner.user, `/api/projects/${w.projectA.id}/budgets`, {
      method: "POST",
      body: {
        name: "Q4",
        plannedAmountMinor: 100_000,
        currency: "EUR",
        periodStart: isoDaysAgo(30),
        periodEnd: isoDaysAgo(-30),
        ...overrides,
      },
    });
  }
  type BudgetBody = {
    data: Array<{
      actualMinor?: number;
      timeMinor?: number;
      costEntriesMinor?: number;
      otherCurrencies?: Array<{ currency: string; costMinor: number }>;
      remainingMinor?: number;
      committedMinor: number | null;
    }>;
  };
  async function budget(user: User = w.owner.user) {
    return (await (
      await w.agent(user, `/api/projects/${w.projectA.id}/budget`)
    ).json()) as BudgetBody;
  }

  it("adds cost entries to priced time per currency and reports other currencies separately", async () => {
    await createBudget();
    await w.addRate(w.member.personId, isoDaysAgo(60), 6000, "EUR");
    expect(
      (await w.logTime(w.member.user, { date: isoDaysAgo(1), minutes: 60 }))
        .status,
    ).toBe(201);
    const eur = await makeType();
    const usd = await makeType({ name: "Hosting", currency: "USD" });
    await logCost(eur.id, { units: 2 });
    await logCost(usd.id, { units: 4 });
    // Outside the period: counted nowhere.
    await logCost(eur.id, { units: 50, date: isoDaysAgo(90) });
    const { data } = await budget();
    expect(data[0]).toMatchObject({
      timeMinor: 6000,
      costEntriesMinor: 5000,
      actualMinor: 11_000,
      remainingMinor: 89_000,
      committedMinor: null,
    });
    expect(data[0]?.otherCurrencies).toEqual([
      { currency: "USD", costMinor: 10_000, pricedMinutes: 0 },
    ]);
  });

  it("hides every cost-derived figure from a budget reader without rates", async () => {
    await createBudget();
    const type = await makeType();
    await logCost(type.id, { units: 2 });
    const { data } = await budget(w.member.user);
    expect(JSON.stringify(data)).not.toMatch(
      /actualMinor|timeMinor|costEntriesMinor|otherCurrencies/,
    );
  });

  it("adds cost entries to the summary roll-up for rate managers only", async () => {
    const type = await makeType();
    await logCost(type.id, { units: 2, workItemId: w.itemA.id });
    const summary = async (user: User) =>
      (await (
        await w.agent(
          user,
          `/api/time-entries/summary?workspaceId=${w.workspaceId}&workItemId=${w.itemA.id}`,
        )
      ).json()) as {
        cost?: {
          costEntries?: Array<{ currency: string; amountMinor: number }>;
        };
      };
    expect((await summary(w.owner.user)).cost?.costEntries).toEqual([
      { currency: "EUR", amountMinor: 5000, entryCount: 1 },
    ]);
    expect((await summary(w.lead.user)).cost).toBeUndefined();
  });
});
