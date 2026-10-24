/**
 * SLA-16 / SLA-17 / NO-21 / NO-22 notification eligibility and the escalation walk against the
 * real DB and reach evaluators. Runs under `vitest.integration.config.ts` against a dedicated
 * `_test` PostgreSQL database (see docs/testing.md).
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { slaEscalationTable } from "../../apps/api/src/database/schema";
import { advanceDueEscalations } from "../../apps/api/src/scheduler/sla-escalation";
import { scanWorkItemSla } from "../../apps/api/src/scheduler/sla-scan";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";
import { slaFixture } from "./helpers/sla-fixture";

type Fixture = Awaited<ReturnType<typeof slaFixture>>;

async function personOf(userId: string) {
  return requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId))
      .limit(1),
    "person",
  );
}

/** A staff member of the fixture's workspace; `reach` grants work-item access on the project. */
async function addStaff(f: Fixture, reach: boolean) {
  const member = await createWorkspaceMember({ role: "member" });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: f.owner.workspace.id,
    userId: member.user.id,
    role: "member",
    joinedAt: new Date(),
  });
  if (reach) await grantWorkItemProjectAccess(member.user.id, f.project.id);
  return personOf(member.user.id);
}

/** A `project-lead` membership; `reach` decides whether its role can read work items. */
async function makeLead(f: Fixture, reach: boolean) {
  const person = await addStaff(f, false);
  const role = requireRow(
    await db
      .insert(schema.roleTable)
      .values({
        scope: "project",
        workspaceId: f.owner.workspace.id,
        key: "project-lead",
        name: `Lead ${randomUUID()}`,
        rank: 1,
        capabilities: reach ? ["project:read", "work_item:read"] : [],
      })
      .returning(),
    "lead role",
  );
  await db.insert(schema.membershipTable).values({
    personId: person.id,
    scope: "project",
    scopeId: f.project.id,
    roleId: role.id,
    seesAll: false,
  });
  return person;
}

async function stakeholder(
  f: Fixture,
  personId: string,
  order: number,
  waitMinutes: number,
) {
  await db.insert(schema.stakeholderTable).values({
    projectId: f.project.id,
    personId,
    role: "escalation",
    escalationOrder: order,
    escalationWaitMinutes: waitMinutes,
  });
}

async function assign(f: Fixture, personId: string) {
  await db
    .update(schema.workItemTable)
    .set({ assigneeId: personId })
    .where(eq(schema.workItemTable.id, f.item.id));
}

async function breachInboxPersons() {
  const rows = await db
    .select({ personId: schema.notificationTable.personId })
    .from(schema.notificationTable)
    .where(eq(schema.notificationTable.kind, "sla.breached"));
  return new Set(rows.map((row) => row.personId));
}

async function resolutionWalk(f: Fixture) {
  return requireRow(
    await db
      .select()
      .from(slaEscalationTable)
      .where(
        and(
          eq(slaEscalationTable.workItemId, f.item.id),
          eq(slaEscalationTable.metric, "resolution"),
        ),
      )
      .limit(1),
    "walk",
  );
}

async function makeWalkDue(walkId: string) {
  await db
    .update(slaEscalationTable)
    .set({ nextDueAt: new Date(Date.now() - 60_000) })
    .where(eq(slaEscalationTable.id, walkId));
}

describe("sla.breached recipients (SLA-16, NO-21)", () => {
  beforeEach(async () => resetTestDatabase());

  it("writes inbox rows for the assignee, a project lead with reach and the first stakeholder", async () => {
    const f = await slaFixture(130);
    const assignee = await addStaff(f, true);
    const lead = await makeLead(f, true);
    const first = await addStaff(f, true);
    await stakeholder(f, first.id, 1, 30);
    await assign(f, assignee.id);

    await scanWorkItemSla(f.item.id);

    const persons = await breachInboxPersons();
    expect(persons.has(assignee.id)).toBe(true);
    expect(persons.has(lead.id)).toBe(true);
    expect(persons.has(first.id)).toBe(true);
  });

  it("writes nothing for a project lead WITHOUT project reach", async () => {
    const f = await slaFixture(130);
    const assignee = await addStaff(f, true);
    const blindLead = await makeLead(f, false);
    await assign(f, assignee.id);

    await scanWorkItemSla(f.item.id);

    const persons = await breachInboxPersons();
    expect(persons.has(assignee.id)).toBe(true);
    expect(persons.has(blindLead.id)).toBe(false);
  });

  it("never notifies a customer person, even as assignee or stakeholder", async () => {
    const f = await slaFixture(130);
    const orgId = `cust-org-${randomUUID()}`;
    await db.insert(schema.organisationTable).values({
      id: orgId,
      key: orgId,
      name: "Customer org",
      isInternal: false,
      portalAccess: true,
    });
    const userId = `cust-${randomUUID()}`;
    await db
      .insert(schema.userTable)
      .values({ id: userId, name: userId, email: `${userId}@example.test` });
    const customer = requireRow(
      await db
        .insert(schema.personTable)
        .values({
          userId,
          organisationId: orgId,
          side: "customer",
          active: true,
          isPlaceholder: false,
        })
        .returning(),
      "customer person",
    );
    await stakeholder(f, customer.id, 1, 10);
    await assign(f, customer.id);

    await scanWorkItemSla(f.item.id);

    expect((await breachInboxPersons()).has(customer.id)).toBe(false);
  });
});

describe("SLA-17 escalation walk", () => {
  beforeEach(async () => resetTestDatabase());

  it("advances after the wait and notifies the next stakeholder, then completes", async () => {
    const f = await slaFixture(130);
    const first = await addStaff(f, true);
    const second = await addStaff(f, true);
    await stakeholder(f, first.id, 1, 30);
    await stakeholder(f, second.id, 2, 30);
    await scanWorkItemSla(f.item.id);
    expect((await breachInboxPersons()).has(second.id)).toBe(false);

    const walk = await resolutionWalk(f);
    expect(walk).toMatchObject({ state: "active", lastOrder: 1 });
    await makeWalkDue(walk.id);
    const outcome = await advanceDueEscalations();

    expect(outcome.completed + outcome.advanced).toBeGreaterThanOrEqual(1);
    expect((await breachInboxPersons()).has(second.id)).toBe(true);
    expect(await resolutionWalk(f)).toMatchObject({
      state: "completed",
      lastOrder: 2,
    });
  });

  it("notifies every stakeholder sharing the same escalation order in one step", async () => {
    const f = await slaFixture(130);
    const first = await addStaff(f, true);
    const tiedA = await addStaff(f, true);
    const tiedB = await addStaff(f, true);
    await stakeholder(f, first.id, 1, 5);
    await stakeholder(f, tiedA.id, 2, 5);
    await stakeholder(f, tiedB.id, 2, 5);
    await scanWorkItemSla(f.item.id);

    await makeWalkDue((await resolutionWalk(f)).id);
    await advanceDueEscalations();

    const persons = await breachInboxPersons();
    expect(persons.has(tiedA.id)).toBe(true);
    expect(persons.has(tiedB.id)).toBe(true);
    expect(await resolutionWalk(f)).toMatchObject({ lastOrder: 2 });
  });

  it("notifies tied stakeholders at the FIRST order together as well", async () => {
    const f = await slaFixture(130);
    const a = await addStaff(f, true);
    const b = await addStaff(f, true);
    await stakeholder(f, a.id, 1, 10);
    await stakeholder(f, b.id, 1, 10);
    await scanWorkItemSla(f.item.id);
    const persons = await breachInboxPersons();
    expect(persons.has(a.id)).toBe(true);
    expect(persons.has(b.id)).toBe(true);
  });

  it("stops when a staff member comments, notifying no further stakeholder", async () => {
    const f = await slaFixture(130);
    const first = await addStaff(f, true);
    const second = await addStaff(f, true);
    await stakeholder(f, first.id, 1, 30);
    await stakeholder(f, second.id, 2, 30);
    await scanWorkItemSla(f.item.id);
    const walk = await resolutionWalk(f);

    await db.insert(schema.commentTable).values({
      workspaceId: f.owner.workspace.id,
      workItemId: f.item.id,
      authorId: first.id,
      actorType: "person",
      body: { text: "On it" },
      visibility: "internal",
    });
    await makeWalkDue(walk.id);
    const outcome = await advanceDueEscalations();

    expect(outcome.stopped).toBeGreaterThanOrEqual(1);
    expect(await resolutionWalk(f)).toMatchObject({
      state: "stopped",
      stopReason: "staff_commented",
    });
    expect((await breachInboxPersons()).has(second.id)).toBe(false);
  });
});
