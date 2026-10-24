/**
 * P5-R4-02: a cross-project move re-homes the item's time. Entries and the running timer follow
 * the item to the destination project (roll-ups and budgets with them), rate snapshots stay as
 * recorded (owner decision D4), a caller who reaches only the old project stops seeing the item's
 * time, and entry reads redact key and title when the item's current project is out of reach.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { timeEntryTable } from "../../apps/api/src/database/schema-p5-time";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  entryRows,
  isoDaysAgo,
  type TimeWorld,
  timerRows,
  timeWorld,
} from "./helpers/p5-time";

let w: TimeWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await timeWorld();
  // The fixtures insert items with explicit numbers; the project counters must agree.
  await db
    .update(schema.projectTable)
    .set({ lastTaskNumber: 5 })
    .where(eq(schema.projectTable.workspaceId, w.workspaceId));
});

type User = Parameters<TimeWorld["agent"]>[0];
type Entry = {
  id: string;
  projectId: string;
  workItemKey: string | null;
  workItemTitle: string | null;
};

async function moveWithVersion(
  item: { id: string; key: string },
  targetProjectId: string,
) {
  const [row] = await db
    .select({
      version: schema.workItemTable.version,
      templateId: schema.stateTable.stateTemplateId,
    })
    .from(schema.workItemTable)
    .innerJoin(
      schema.stateTable,
      eq(schema.stateTable.id, schema.workItemTable.stateId),
    )
    .where(eq(schema.workItemTable.id, item.id));
  // The destination needs a live state for the item's workflow state.
  const [existing] = await db
    .select({ id: schema.stateTable.id })
    .from(schema.stateTable)
    .where(
      and(
        eq(schema.stateTable.projectId, targetProjectId),
        eq(schema.stateTable.stateTemplateId, row?.templateId as string),
      ),
    );
  if (!existing)
    await db.insert(schema.stateTable).values({
      projectId: targetProjectId,
      stateTemplateId: row?.templateId as string,
      isDefault: false,
    });
  mockAuthenticatedSession(w.owner.user);
  const response = await w.app.request(`/api/v2/work-items/${item.key}/move`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "if-match": `"${row?.version}"`,
    },
    body: JSON.stringify({ targetProjectId, moveChildren: false }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { item: { key: string } };
}

const list = async (user: User, query = "", person = "all") =>
  (await (
    await w.agent(
      user,
      `/api/time-entries?workspaceId=${w.workspaceId}&person=${person}${query}`,
    )
  ).json()) as { data: Entry[] };

type Budget = {
  data: Array<{ actualMinor?: number }>;
};
const budgetOf = async (projectId: string) =>
  (await (
    await w.agent(w.owner.user, `/api/projects/${projectId}/budget`)
  ).json()) as Budget;
const createBudget = (projectId: string) =>
  w.agent(w.owner.user, `/api/projects/${projectId}/budgets`, {
    method: "POST",
    body: {
      name: "Q4",
      plannedAmountMinor: 100000,
      currency: "EUR",
      periodStart: isoDaysAgo(10),
      periodEnd: isoDaysAgo(-20),
    },
  });

describe("a cross-project move re-homes the item's time (P5-R4-02)", () => {
  it("moves entries and the running timer with the item, keeps rate snapshots and rolls budgets over", async () => {
    await w.addRate(w.member.personId, isoDaysAgo(20), 6000, "EUR");
    await w.addRate(w.ownerPersonId, isoDaysAgo(20), 3000, "EUR");
    expect((await createBudget(w.projectA.id)).status).toBe(201);
    expect((await createBudget(w.projectB.id)).status).toBe(201);
    const logged = await w.logTime(w.member.user, { minutes: 60 });
    expect(logged.status, await logged.clone().text()).toBe(201);
    expect((await budgetOf(w.projectA.id)).data[0]?.actualMinor).toBe(6000);
    expect((await budgetOf(w.projectB.id)).data[0]?.actualMinor).toBe(0);
    const started = await w.agent(
      w.owner.user,
      "/api/time-entries/timer/start",
      {
        method: "POST",
        body: { workspaceId: w.workspaceId, workItemId: w.itemA.id },
      },
    );
    expect(started.status, await started.clone().text()).toBe(200);
    const before = await entryRows(w.workspaceId);
    expect(before[0]?.rateMinor).toBe(6000);

    const moved = await moveWithVersion(w.itemA, w.projectB.id);
    expect(moved.item.key).not.toBe(w.itemA.key);

    // Rows follow the item; the snapshotted rate and currency are untouched.
    const after = await entryRows(w.workspaceId);
    expect(after.map((row) => row.projectId)).toEqual([w.projectB.id]);
    expect(after[0]?.rateMinor).toBe(6000);
    expect(after[0]?.currency).toBe("EUR");
    const timers = await timerRows(w.workspaceId);
    expect(timers.map((row) => row.projectId)).toEqual([w.projectB.id]);

    // Budgets follow: A drops, B rises.
    expect((await budgetOf(w.projectA.id)).data[0]?.actualMinor).toBe(0);
    expect((await budgetOf(w.projectB.id)).data[0]?.actualMinor).toBe(6000);

    // Stopping the timer after the move writes the entry against the NEW project.
    const stopped = await w.agent(
      w.owner.user,
      "/api/time-entries/timer/stop",
      {
        method: "POST",
        body: { workspaceId: w.workspaceId },
      },
    );
    expect(stopped.status, await stopped.clone().text()).toBe(200);
    const all = await entryRows(w.workspaceId);
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(new Set(all.map((row) => row.projectId))).toEqual(
      new Set([w.projectB.id]),
    );
  });

  it("hides the moved item's entries, key and title from a caller who reaches only the old project", async () => {
    await w.logTime(w.member.user, { minutes: 45 });
    expect((await list(w.lead.user)).data).toHaveLength(1);
    await moveWithVersion(w.itemA, w.projectB.id);
    expect((await list(w.lead.user)).data).toHaveLength(0);
    const [entry] = await entryRows(w.workspaceId);
    const direct = await w.agent(
      w.member.user,
      `/api/time-entries/${entry?.id}`,
      {
        method: "PATCH",
        body: { description: "after the move" },
      },
    );
    expect(direct.status).toBe(404);
    // The owner (reaches B) sees the entry on the new project, naming the item.
    const owned = (await list(w.owner.user)).data;
    expect(owned).toHaveLength(1);
    expect(owned[0]?.projectId).toBe(w.projectB.id);
    expect(owned[0]?.workItemKey).toBeTruthy();
  });

  it("redacts key and title when an entry's item sits in a project the caller cannot reach (defence in depth)", async () => {
    await w.logTime(w.member.user, { minutes: 45 });
    await moveWithVersion(w.itemA, w.projectB.id);
    // Simulate a stale row left on the old project: the caller reaches the entry's project but
    // not the item's current one.
    await db
      .update(timeEntryTable)
      .set({ projectId: w.projectA.id })
      .where(eq(timeEntryTable.workspaceId, w.workspaceId));
    const seen = (await list(w.member.user, "", w.member.personId)).data;
    expect(seen).toHaveLength(1);
    expect(seen[0]?.workItemKey).toBeNull();
    expect(seen[0]?.workItemTitle).toBeNull();
    const [entry] = await entryRows(w.workspaceId);
    const direct = await w.agent(
      w.member.user,
      `/api/time-entries/${entry?.id}`,
      {
        method: "PATCH",
        body: { description: "still mine" },
      },
    );
    expect(direct.status, await direct.clone().text()).toBe(200);
    const body = (await direct.json()) as Entry;
    expect(body.workItemKey).toBeNull();
    expect(body.workItemTitle).toBeNull();
  });
});
