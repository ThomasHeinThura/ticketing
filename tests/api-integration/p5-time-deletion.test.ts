/**
 * P5 time and cost never block a deletion. The 0066 lesson (a RESTRICT foreign key made every
 * workspace that had ever held an `activity` row undeletable) is checked here with every new table
 * populated: a work item purge keeps the time on its project, a project purge takes it all, and a
 * workspace delete (the real route, with approval) leaves nothing behind.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  budgetTable,
  hourlyRateTable,
  runningTimerTable,
  timeActivityTable,
  timeEntryTable,
} from "../../apps/api/src/database/schema-p5-time";
import { createApp } from "../../apps/api/src/index";
import { purgeSoftDeletedRows } from "../../apps/api/src/scheduler/soft-delete-purge";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture } from "./helpers/fixtures";
import { signUpUser } from "./helpers/organization-http";
import { workItemWorld } from "./helpers/p4-closeout";
import { isoDaysAgo, timeWorld } from "./helpers/p5-time";
import {
  createWorkspaceNative,
  deleteWorkspaceThroughApproval,
} from "./helpers/workspace-write-http";

const DAY_MS = 86_400_000;

beforeEach(async () => {
  await resetTestDatabase();
});

async function counts(workspaceId: string) {
  const size = (rows: unknown[]) => rows.length;
  return {
    entries: size(
      await db
        .select()
        .from(timeEntryTable)
        .where(eq(timeEntryTable.workspaceId, workspaceId)),
    ),
    timers: size(
      await db
        .select()
        .from(runningTimerTable)
        .where(eq(runningTimerTable.workspaceId, workspaceId)),
    ),
    rates: size(
      await db
        .select()
        .from(hourlyRateTable)
        .where(eq(hourlyRateTable.workspaceId, workspaceId)),
    ),
    budgets: size(
      await db
        .select()
        .from(budgetTable)
        .where(eq(budgetTable.workspaceId, workspaceId)),
    ),
    activities: size(
      await db
        .select()
        .from(timeActivityTable)
        .where(eq(timeActivityTable.workspaceId, workspaceId)),
    ),
  };
}

describe("a work item purge", () => {
  it("keeps the time on its project and drops the running timer", async () => {
    const w = await timeWorld();
    const response = await w.logTime(w.member.user, {}, w.childItem.id);
    expect(response.status).toBe(201);
    await db.insert(runningTimerTable).values({
      personId: w.member.personId,
      workspaceId: w.workspaceId,
      projectId: w.projectA.id,
      workItemId: w.childItem.id,
      activityId: w.dev.id,
      billable: true,
    });
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date(Date.now() - 31 * DAY_MS) })
      .where(eq(schema.workItemTable.id, w.childItem.id));

    const outcome = await purgeSoftDeletedRows();

    expect(outcome.degraded).toBe(false);
    const [entry] = await db
      .select()
      .from(timeEntryTable)
      .where(eq(timeEntryTable.workspaceId, w.workspaceId));
    expect(entry?.workItemId).toBeNull();
    expect(entry?.projectId).toBe(w.projectA.id);
    expect((await counts(w.workspaceId)).timers).toBe(0);
  });
});

describe("a project purge", () => {
  it("removes its time, timers, project rates and budgets and is idempotent", async () => {
    const w = await timeWorld();
    expect((await w.logTime(w.member.user)).status).toBe(201);
    await w.addRate(
      w.member.personId,
      isoDaysAgo(10),
      6000,
      "EUR",
      w.projectA.id,
    );
    await db.insert(runningTimerTable).values({
      personId: w.other.personId,
      workspaceId: w.workspaceId,
      projectId: w.projectA.id,
      workItemId: w.itemA.id,
      activityId: w.dev.id,
      billable: true,
    });
    await db.insert(budgetTable).values({
      workspaceId: w.workspaceId,
      projectId: w.projectA.id,
      name: "Q4",
      plannedAmountMinor: 1000,
      currency: "EUR",
      periodStart: isoDaysAgo(5),
      periodEnd: isoDaysAgo(-5),
    });
    // Time on the other project is untouched.
    expect((await w.logTime(w.owner.user, {}, w.itemB.id)).status).toBe(201);
    await db
      .update(schema.projectTable)
      .set({
        deletedAt: new Date(Date.now() - 31 * DAY_MS),
        purgeAfter: new Date(Date.now() - DAY_MS),
      })
      .where(eq(schema.projectTable.id, w.projectA.id));

    const first = await purgeSoftDeletedRows();
    expect(first.projectsPurged).toBe(1);
    expect(first.degraded).toBe(false);

    const after = await counts(w.workspaceId);
    expect(after).toMatchObject({
      entries: 1,
      timers: 0,
      rates: 0,
      budgets: 0,
    });
    expect((await purgeSoftDeletedRows()).projectsPurged).toBe(0);
  });
});

describe("a workspace delete through the route", () => {
  it("is not blocked by logged time, a timer, a rate, a budget or an activity", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Time deletion workspace",
    });
    const { id: workspaceId } = (await created.json()) as { id: string };
    await ensureStaffPersonForUser(owner.user.id);
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, owner.user.id));
    if (!person) throw new Error("person missing");
    const { project } = await createProjectFixture({ workspaceId });
    const rows = await workItemWorld(workspaceId, project.id);
    const item = await rows.makeItem("Deletion probe");
    const [activity] = await db
      .insert(timeActivityTable)
      .values({ workspaceId, name: `Dev ${randomUUID().slice(0, 4)}` })
      .returning();
    if (!activity) throw new Error("activity missing");
    await db.insert(timeEntryTable).values({
      workspaceId,
      projectId: project.id,
      workItemId: item.id,
      personId: person.id,
      date: isoDaysAgo(1),
      minutes: 60,
      activityId: activity.id,
      billable: true,
      rateMinor: 6000,
      currency: "EUR",
    });
    await db.insert(runningTimerTable).values({
      personId: person.id,
      workspaceId,
      projectId: project.id,
      workItemId: item.id,
      activityId: activity.id,
      billable: true,
    });
    await db.insert(hourlyRateTable).values({
      workspaceId,
      personId: person.id,
      projectId: project.id,
      rateMinor: 6000,
      currency: "EUR",
      effectiveFrom: isoDaysAgo(30),
    });
    await db.insert(budgetTable).values({
      workspaceId,
      projectId: project.id,
      name: "Q4",
      plannedAmountMinor: 1000,
      currency: "EUR",
      periodStart: isoDaysAgo(5),
      periodEnd: isoDaysAgo(-5),
    });
    expect(await counts(workspaceId)).toMatchObject({
      entries: 1,
      timers: 1,
      rates: 1,
      budgets: 1,
    });

    const { approved } = await deleteWorkspaceThroughApproval(
      app,
      owner.cookie,
      workspaceId,
    );
    expect(approved?.status, await approved?.clone().text()).toBe(200);

    expect(await counts(workspaceId)).toEqual({
      entries: 0,
      timers: 0,
      rates: 0,
      budgets: 0,
      activities: 0,
    });
    const gone = await db
      .select({ id: schema.workspaceTable.id })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId));
    expect(gone).toHaveLength(0);
  });
});
