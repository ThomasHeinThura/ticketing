/**
 * TC-12..TC-14, TC-20 and PA-12: the shared legal-hold predicate fences every person column the
 * cost and capacity tables add (`cost_entry.person_id`, `cost_entry.created_by`,
 * `available_hours.person_id`, `available_hours.created_by`), and the new tables never block a
 * workspace hard delete or a project purge.
 *
 * Every case is two-sided: the row is retained while a person-scope hold covers a person whose
 * ONLY footprint is that column, and is removed once the hold is lifted.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  availableHoursTable,
  costEntryTable,
  costTypeTable,
} from "../../apps/api/src/database/schema-p5-time";
import { purgeSoftDeletedRows } from "../../apps/api/src/scheduler/soft-delete-purge";
import {
  assertWorkspaceNotUnderLegalHold,
  WorkspaceUnderLegalHoldError,
} from "../../apps/api/src/utils/workspace-legal-hold";
import { deleteWorkspaceRoleDependents } from "../../apps/api/src/workspace/controllers/delete-workspace-role-dependents";
import { buildTenant, type Tenant } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;

async function placeHold(personId: string) {
  return requireRow(
    await db
      .insert(schema.legalHoldTable)
      .values({
        scope: "person",
        scopeId: personId,
        placedBy: "integration-test",
        reason: "cost hold scope test",
      })
      .returning(),
    "hold",
  );
}
async function liftHold(id: string) {
  await db
    .update(schema.legalHoldTable)
    .set({ liftedAt: new Date(), liftedBy: "integration-test" })
    .where(eq(schema.legalHoldTable.id, id));
}
async function workspaceIsHeld(t: Tenant): Promise<boolean> {
  return db.transaction(async (tx) => {
    try {
      await assertWorkspaceNotUnderLegalHold(tx, t.workspaceId);
      return false;
    } catch (error) {
      if (error instanceof WorkspaceUnderLegalHoldError) return true;
      throw error;
    }
  });
}
/** A person with no membership and no other footprint, so only the seeded column can fence. */
async function bystander(t: Tenant) {
  const userId = `user-${randomUUID()}`;
  await db.insert(schema.userTable).values({
    id: userId,
    email: `${userId}@example.com`,
    emailVerified: true,
    name: "Bystander",
  });
  const organisationId = requireRow(
    await db
      .select({ id: schema.personTable.organisationId })
      .from(schema.personTable)
      .where(eq(schema.personTable.id, t.requesterPerson.id)),
    "organisation",
  ).id;
  const person = requireRow(
    await db
      .insert(schema.personTable)
      .values({ userId, organisationId, side: "staff", active: true })
      .returning(),
    "bystander person",
  );
  return { userId, person };
}
type Bystander = Awaited<ReturnType<typeof bystander>>;

async function costType(t: Tenant) {
  return requireRow(
    await db
      .insert(costTypeTable)
      .values({
        workspaceId: t.workspaceId,
        name: `Type ${randomUUID().slice(0, 6)}`,
        unit: "seat",
        defaultRateMinor: 100,
        currency: "EUR",
      })
      .returning(),
    "cost type",
  );
}
async function costEntry(
  t: Tenant,
  values: { personId: string; createdBy?: string },
) {
  const type = await costType(t);
  await db.insert(costEntryTable).values({
    workspaceId: t.workspaceId,
    projectId: t.project.id,
    costTypeId: type.id,
    date: "2026-01-01",
    units: 2,
    rateMinor: 100,
    amountMinor: 200,
    currency: "EUR",
    billable: true,
    ...values,
  });
}

async function projectExists(id: string) {
  return (
    (
      await db
        .select({ id: schema.projectTable.id })
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, id))
    ).length === 1
  );
}
async function softDeleteProject(t: Tenant) {
  await db
    .update(schema.projectTable)
    .set({
      deletedAt: new Date(Date.now() - 31 * DAY_MS),
      purgeAfter: new Date(Date.now() - DAY_MS),
    })
    .where(eq(schema.projectTable.id, t.project.id));
}

type Case = {
  name: string;
  scope: "project" | "workspace";
  seed: (t: Tenant, by: Bystander) => Promise<void>;
};
const cases: Case[] = [
  {
    name: "cost_entry.person_id",
    scope: "project",
    seed: async (t, by) => {
      await costEntry(t, { personId: by.person.id });
    },
  },
  {
    name: "cost_entry.created_by (a user id)",
    scope: "project",
    seed: async (t, by) => {
      await costEntry(t, {
        personId: t.requesterPerson.id,
        createdBy: by.userId,
      });
    },
  },
  {
    name: "available_hours.person_id",
    scope: "workspace",
    seed: async (t, by) => {
      await db.insert(availableHoursTable).values({
        workspaceId: t.workspaceId,
        personId: by.person.id,
        minutesPerWeek: 2400,
        effectiveFrom: "2026-01-01",
      });
    },
  },
  {
    name: "available_hours.created_by (a user id)",
    scope: "workspace",
    seed: async (t, by) => {
      await db.insert(availableHoursTable).values({
        workspaceId: t.workspaceId,
        personId: t.requesterPerson.id,
        minutesPerWeek: 2400,
        effectiveFrom: "2026-01-01",
        createdBy: by.userId,
      });
    },
  },
];

describe("a person hold on a cost or capacity column fences the purge and the workspace delete", () => {
  beforeEach(() => resetTestDatabase());

  for (const c of cases) {
    it(`${c.name} (${c.scope})`, async () => {
      const t = await buildTenant(`cost-hold-${randomUUID()}`);
      const by = await bystander(t);
      await c.seed(t, by);
      expect(await workspaceIsHeld(t)).toBe(false);
      const hold = await placeHold(by.person.id);
      expect(await workspaceIsHeld(t)).toBe(true);
      if (c.scope === "project") {
        await softDeleteProject(t);
        await purgeSoftDeletedRows();
        expect(await projectExists(t.project.id)).toBe(true);
        await liftHold(hold.id);
        expect(await workspaceIsHeld(t)).toBe(false);
        await purgeSoftDeletedRows();
        expect(await projectExists(t.project.id)).toBe(false);
      } else {
        await liftHold(hold.id);
        expect(await workspaceIsHeld(t)).toBe(false);
      }
    });
  }

  it("a held bystander's cost entry refuses the workspace hard delete, which runs once the hold lifts", async () => {
    const t = await buildTenant("cost-hold-ws-delete");
    const by = await bystander(t);
    await costEntry(t, { personId: by.person.id });
    await db.insert(availableHoursTable).values({
      workspaceId: t.workspaceId,
      personId: by.person.id,
      minutesPerWeek: 600,
      effectiveFrom: "2026-01-01",
    });
    const hold = await placeHold(by.person.id);
    const hardDelete = () =>
      db.transaction(async (tx) => {
        await assertWorkspaceNotUnderLegalHold(tx, t.workspaceId);
        await deleteWorkspaceRoleDependents(tx, [t.workspaceId]);
        await tx
          .delete(schema.workspaceTable)
          .where(eq(schema.workspaceTable.id, t.workspaceId));
      });
    await expect(hardDelete()).rejects.toBeInstanceOf(
      WorkspaceUnderLegalHoldError,
    );
    expect(await db.select().from(costEntryTable)).toHaveLength(1);
    await liftHold(hold.id);
    await hardDelete();
    expect(await db.select().from(costEntryTable)).toHaveLength(0);
    expect(await db.select().from(costTypeTable)).toHaveLength(0);
    expect(await db.select().from(availableHoursTable)).toHaveLength(0);
  });

  it("deleting a person who has cost entries and available hours removes them without blocking", async () => {
    const t = await buildTenant("cost-person-delete");
    const by = await bystander(t);
    await costEntry(t, { personId: by.person.id });
    await db.insert(availableHoursTable).values({
      workspaceId: t.workspaceId,
      personId: by.person.id,
      minutesPerWeek: 600,
      effectiveFrom: "2026-01-01",
    });
    await db
      .delete(schema.personTable)
      .where(eq(schema.personTable.id, by.person.id));
    expect(await db.select().from(costEntryTable)).toHaveLength(0);
    expect(await db.select().from(availableHoursTable)).toHaveLength(0);
    expect(await db.select().from(costTypeTable)).toHaveLength(1);
  });
});
