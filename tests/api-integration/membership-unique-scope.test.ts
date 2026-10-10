/**
 * Migration 0093 makes `membership (person_id, scope, scope_id)` UNIQUE
 * (`membership_person_scope_scope_id_unique`). Before it, the same person could hold two rows
 * for one scope and the assignable-people picker collapsed them; `work-item-assignable`'s
 * AS-1 no longer creates that state. This is the negative test for the invariant itself: a
 * duplicate insert must be rejected by the database, while a row for a different scope_id or
 * a different person is still accepted (so the rejection is not vacuous).
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";

async function seed() {
  const suffix = randomUUID().slice(0, 8);
  const [organisation] = await db
    .insert(schema.organisationTable)
    .values({ key: `ORG${suffix}`, name: `Org ${suffix}` })
    .returning();
  const people = await db
    .insert(schema.personTable)
    .values([
      { organisationId: organisation?.id ?? "", side: "staff" },
      { organisationId: organisation?.id ?? "", side: "staff" },
    ])
    .returning();
  const [role] = await db
    .insert(schema.roleTable)
    .values({
      scope: "project",
      key: `role-${suffix}`,
      name: "Role",
      rank: 10,
    })
    .returning();
  return { people, role };
}

describe("migration 0093: membership (person_id, scope, scope_id) is unique", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects a second membership row for the same person, scope and scope_id", async () => {
    const { people, role } = await seed();
    const person = people[0];
    const roleId = role?.id ?? "";
    await db.insert(schema.membershipTable).values({
      personId: person?.id ?? "",
      scope: "project",
      scopeId: "project-a",
      roleId,
    });

    const duplicate = db.insert(schema.membershipTable).values({
      personId: person?.id ?? "",
      scope: "project",
      scopeId: "project-a",
      roleId,
    });

    await expect(duplicate).rejects.toMatchObject({
      cause: {
        code: "23505",
        constraint: "membership_person_scope_scope_id_unique",
      },
    });
  });

  it("still accepts a different scope_id for the same person and the same scope_id for another person", async () => {
    const { people, role } = await seed();
    const roleId = role?.id ?? "";
    await db.insert(schema.membershipTable).values([
      {
        personId: people[0]?.id ?? "",
        scope: "project",
        scopeId: "project-a",
        roleId,
      },
      {
        personId: people[0]?.id ?? "",
        scope: "project",
        scopeId: "project-b",
        roleId,
      },
      {
        personId: people[1]?.id ?? "",
        scope: "project",
        scopeId: "project-a",
        roleId,
      },
    ]);

    const rows = await db.select().from(schema.membershipTable);
    expect(rows).toHaveLength(3);
  });
});
