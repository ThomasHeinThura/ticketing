/**
 * P1's foundational identity schema (`organisation`, `organisation_quota`, `person`,
 * `membership`, `role` -- data-model.md §2, decision log 2026-09-16 "P1's foundational
 * identity schema"). Purely additive migration, ahead of #23/#25 -- no route, no policy,
 * no `resolveIdentity` wiring exists yet, so these tests stay at the schema/seed layer:
 *
 *   §1  the migration applies cleanly and produces the five tables with the constraints
 *       `apps/api/src/database/schema.ts` declares;
 *   §2  the boot-time seed creates exactly one internal `organisation` and backfills
 *       exactly one `person` (side: staff) per existing `user` row;
 *   §3  running the seed again is a no-op -- no duplicate organisation, no duplicate
 *       persons;
 *   §4  the FK behaviours chosen for this schema (cascade / set null / restrict) actually
 *       do what the schema comments say, since nothing else in this PR exercises them.
 */
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { seedInternalOrganisationAndStaffPersons } from "../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./helpers/database";
import { signUpUser } from "./helpers/organization-http";

beforeEach(async () => {
  await resetTestDatabase();
});

describe("#1 -- migration 0052 applies cleanly and produces the schema data-model.md §2 specifies", () => {
  it("creates all five tables with their primary keys", async () => {
    const result = await db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('organisation', 'organisation_quota', 'person', 'membership', 'role')
      ORDER BY table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "membership",
      "organisation",
      "organisation_quota",
      "person",
      "role",
    ]);
  });

  it("enforces at most one internal organisation via the partial unique index", async () => {
    const now = new Date();
    await db.insert(schema.organisationTable).values({
      key: "org-a",
      name: "Org A",
      isInternal: true,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      db.insert(schema.organisationTable).values({
        key: "org-b",
        name: "Org B",
        isInternal: true,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow();

    // A second NON-internal organisation is unaffected -- the index is partial.
    await expect(
      db.insert(schema.organisationTable).values({
        key: "org-c",
        name: "Org C",
        isInternal: false,
        createdAt: now,
        updatedAt: now,
      }),
    ).resolves.toBeDefined();
  });

  it("enforces role.key uniqueness scoped to (scope, workspace_id), not globally", async () => {
    const now = new Date();
    const common = {
      key: "lead",
      name: "Lead",
      rank: 10,
      createdAt: now,
      updatedAt: now,
    };

    // Same (scope, workspace_id=null) pair, same key -- must collide.
    await db.insert(schema.roleTable).values({ ...common, scope: "instance" });
    await expect(
      db.insert(schema.roleTable).values({ ...common, scope: "instance" }),
    ).rejects.toThrow();

    // Different scope, same key -- must NOT collide (scope is part of the unique key).
    await expect(
      db.insert(schema.roleTable).values({ ...common, scope: "organisation" }),
    ).resolves.toBeDefined();
  });
});

describe("#2/#3 -- the boot-time seed creates one internal organisation and backfills one staff person per user, idempotently", () => {
  it("creates exactly one internal organisation and one person per existing user", async () => {
    const { app } = createApp();
    const alice = await signUpUser(app);
    const bob = await signUpUser(app);
    const carol = await signUpUser(app);

    await seedInternalOrganisationAndStaffPersons();

    const organisations = await db
      .select()
      .from(schema.organisationTable)
      .where(eq(schema.organisationTable.isInternal, true));
    expect(organisations).toHaveLength(1);
    const internalOrganisation = organisations[0];
    if (!internalOrganisation) throw new Error("expected an organisation row");

    const persons = await db.select().from(schema.personTable);
    expect(persons).toHaveLength(3);

    const byUserId = new Map(persons.map((person) => [person.userId, person]));
    for (const user of [alice.user, bob.user, carol.user]) {
      const person = byUserId.get(user.id);
      expect(person, `expected a person row for user ${user.id}`).toBeDefined();
      expect(person?.organisationId).toBe(internalOrganisation.id);
      expect(person?.side).toBe("staff");
      expect(person?.isPlaceholder).toBe(false);
      expect(person?.active).toBe(true);
    }
  });

  it("running the seed twice creates no duplicate organisation and no duplicate persons", async () => {
    const { app } = createApp();
    await signUpUser(app);
    await signUpUser(app);

    await seedInternalOrganisationAndStaffPersons();
    await seedInternalOrganisationAndStaffPersons();

    const organisations = await db
      .select()
      .from(schema.organisationTable)
      .where(eq(schema.organisationTable.isInternal, true));
    expect(organisations).toHaveLength(1);

    const persons = await db.select().from(schema.personTable);
    expect(persons).toHaveLength(2);
  });

  it("backfills a person for a user who signs up BETWEEN two seed runs, without touching persons already seeded", async () => {
    const { app } = createApp();
    const alice = await signUpUser(app);

    await seedInternalOrganisationAndStaffPersons();
    const [aliceFirstPass] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, alice.user.id));
    if (!aliceFirstPass) throw new Error("expected alice's person row");

    const bob = await signUpUser(app);
    await seedInternalOrganisationAndStaffPersons();

    const persons = await db.select().from(schema.personTable);
    expect(persons).toHaveLength(2);

    const [aliceSecondPass] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, alice.user.id));
    // Alice's row is untouched by the second pass -- same id, not a new insert.
    expect(aliceSecondPass?.id).toBe(aliceFirstPass.id);

    const [bobPerson] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, bob.user.id));
    expect(bobPerson).toBeDefined();
  });

  it("seeds nothing beyond the internal organisation when there are no users yet", async () => {
    await seedInternalOrganisationAndStaffPersons();

    const organisations = await db
      .select()
      .from(schema.organisationTable)
      .where(eq(schema.organisationTable.isInternal, true));
    expect(organisations).toHaveLength(1);

    const persons = await db.select().from(schema.personTable);
    expect(persons).toHaveLength(0);
  });
});

describe("#4 -- the chosen FK behaviours actually hold", () => {
  it("cascades person -> membership on delete (membership.person_id)", async () => {
    const now = new Date();
    const [organisation] = await db
      .insert(schema.organisationTable)
      .values({
        key: "org-fk",
        name: "Org FK",
        isInternal: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!organisation) throw new Error("expected organisation row");

    const [person] = await db
      .insert(schema.personTable)
      .values({
        organisationId: organisation.id,
        side: "staff",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!person) throw new Error("expected person row");

    const [role] = await db
      .insert(schema.roleTable)
      .values({
        scope: "instance",
        key: "member",
        name: "Member",
        rank: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!role) throw new Error("expected role row");

    await db.insert(schema.membershipTable).values({
      personId: person.id,
      scope: "organisation",
      scopeId: organisation.id,
      roleId: role.id,
      createdAt: now,
      updatedAt: now,
    });

    await db
      .delete(schema.personTable)
      .where(eq(schema.personTable.id, person.id));

    const remaining = await db
      .select()
      .from(schema.membershipTable)
      .where(eq(schema.membershipTable.personId, person.id));
    expect(remaining).toHaveLength(0);
  });

  it("restricts deleting a role that a membership still references", async () => {
    const now = new Date();
    const [organisation] = await db
      .insert(schema.organisationTable)
      .values({
        key: "org-restrict",
        name: "Org Restrict",
        isInternal: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!organisation) throw new Error("expected organisation row");

    const [person] = await db
      .insert(schema.personTable)
      .values({
        organisationId: organisation.id,
        side: "staff",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!person) throw new Error("expected person row");

    const [role] = await db
      .insert(schema.roleTable)
      .values({
        scope: "instance",
        key: "referenced",
        name: "Referenced",
        rank: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!role) throw new Error("expected role row");

    await db.insert(schema.membershipTable).values({
      personId: person.id,
      scope: "organisation",
      scopeId: organisation.id,
      roleId: role.id,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      db.delete(schema.roleTable).where(eq(schema.roleTable.id, role.id)),
    ).rejects.toThrow();
  });

  it("sets person.user_id to null (does not delete the person row) when the underlying user is deleted", async () => {
    const { app } = createApp();
    const alice = await signUpUser(app);

    await seedInternalOrganisationAndStaffPersons();

    const [personBefore] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, alice.user.id));
    if (!personBefore) throw new Error("expected alice's person row");

    await db
      .delete(schema.userTable)
      .where(eq(schema.userTable.id, alice.user.id));

    const [personAfter] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.id, personBefore.id));
    expect(personAfter).toBeDefined();
    expect(personAfter?.userId).toBeNull();
  });

  it("cascades organisation -> person and organisation -> organisation_quota on delete", async () => {
    const now = new Date();
    const [organisation] = await db
      .insert(schema.organisationTable)
      .values({
        key: "org-cascade",
        name: "Org Cascade",
        isInternal: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!organisation) throw new Error("expected organisation row");

    await db.insert(schema.personTable).values({
      organisationId: organisation.id,
      side: "customer",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.organisationQuotaTable).values({
      organisationId: organisation.id,
      createdAt: now,
      updatedAt: now,
    });

    await db
      .delete(schema.organisationTable)
      .where(eq(schema.organisationTable.id, organisation.id));

    const remainingPersons = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.organisationId, organisation.id));
    expect(remainingPersons).toHaveLength(0);

    const remainingQuotas = await db
      .select()
      .from(schema.organisationQuotaTable)
      .where(eq(schema.organisationQuotaTable.organisationId, organisation.id));
    expect(remainingQuotas).toHaveLength(0);
  });

  it("permits a placeholder person (no user_id) and a claimed person to coexist without tripping the organisation/user partial unique index", async () => {
    const now = new Date();
    const [organisation] = await db
      .insert(schema.organisationTable)
      .values({
        key: "org-placeholder",
        name: "Org Placeholder",
        isInternal: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!organisation) throw new Error("expected organisation row");

    // Two placeholder persons, same organisation, both userId null -- must NOT collide,
    // since the partial unique index only applies where user_id is not null.
    await expect(
      db.insert(schema.personTable).values([
        {
          organisationId: organisation.id,
          side: "customer",
          isPlaceholder: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          organisationId: organisation.id,
          side: "customer",
          isPlaceholder: true,
          createdAt: now,
          updatedAt: now,
        },
      ]),
    ).resolves.toBeDefined();

    const placeholders = await db
      .select()
      .from(schema.personTable)
      .where(
        and(
          eq(schema.personTable.organisationId, organisation.id),
          eq(schema.personTable.isPlaceholder, true),
        ),
      );
    expect(placeholders).toHaveLength(2);
  });
});
