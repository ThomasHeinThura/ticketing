import { randomUUID } from "node:crypto";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import {
  listOwnSettingRows,
  listReachableProjectFacts,
  upsertOwnSettingRow,
} from "../../apps/api/src/user-preference/repository";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

async function createCustomerPreferenceFixture() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const project = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const organisationId = `org-${randomUUID()}`;
  await db.insert(schema.organisationTable).values({
    id: organisationId,
    key: organisationId,
    name: "Preference repository customer",
    isInternal: false,
    active: true,
    portalAccess: true,
  });
  const role = requireRow(
    await db
      .insert(schema.roleTable)
      .values({
        scope: BUILT_IN_ROLES.customer.scope,
        workspaceId: null,
        key: BUILT_IN_ROLES.customer.key,
        name: "Customer",
        rank: BUILT_IN_ROLES.customer.rank,
        capabilities: [...BUILT_IN_ROLES.customer.capabilities],
        isSystem: true,
        isEditable: false,
      })
      .returning(),
    "customer role",
  );
  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: `customer-${randomUUID()}`,
        email: `customer-${randomUUID()}@example.test`,
        emailVerified: true,
        name: "Preference repository customer",
      })
      .returning(),
    "customer user",
  );
  const person = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId: user.id,
        organisationId,
        side: "customer",
        active: true,
        isPlaceholder: false,
      })
      .returning(),
    "customer person",
  );
  const membership = requireRow(
    await db
      .insert(schema.membershipTable)
      .values({
        personId: person.id,
        scope: "organisation",
        scopeId: organisationId,
        roleId: role.id,
        seesAll: false,
      })
      .returning(),
    "customer membership",
  );
  await db
    .update(schema.projectTable)
    .set({ organisationId })
    .where(eq(schema.projectTable.id, project.project.id));
  const identity = await resolveIdentity({
    userId: user.id,
    credential: "session",
  });
  if (!identity) throw new Error("customer identity did not resolve");
  return { identity, user, person, role, membership, organisationId, project };
}

describe("user-preference repository current project reach", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("uses the project's serving organisation and rechecks it in the INSERT SELECT", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const served = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const internal = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const organisationId = `org-${randomUUID()}`;
    await db.insert(schema.organisationTable).values({
      id: organisationId,
      key: organisationId,
      name: "Preference repository customer",
      isInternal: false,
      active: true,
      portalAccess: true,
    });

    const customerRole = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: BUILT_IN_ROLES.customer.scope,
          workspaceId: null,
          key: BUILT_IN_ROLES.customer.key,
          name: "Customer",
          rank: BUILT_IN_ROLES.customer.rank,
          capabilities: [...BUILT_IN_ROLES.customer.capabilities],
          isSystem: true,
          isEditable: false,
        })
        .returning(),
      "customer role",
    );
    const user = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: `customer-${randomUUID()}`,
          email: `customer-${randomUUID()}@example.test`,
          emailVerified: true,
          name: "Preference repository customer",
        })
        .returning(),
      "customer user",
    );
    const person = requireRow(
      await db
        .insert(schema.personTable)
        .values({
          userId: user.id,
          organisationId,
          side: "customer",
          active: true,
          isPlaceholder: false,
        })
        .returning(),
      "customer person",
    );
    await db.insert(schema.membershipTable).values({
      personId: person.id,
      scope: "organisation",
      scopeId: organisationId,
      roleId: customerRole.id,
      seesAll: false,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId })
      .where(eq(schema.projectTable.id, served.project.id));

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });
    if (!identity) throw new Error("customer identity did not resolve");
    expect(identity).toMatchObject({
      side: "customer",
      reach: { kind: "organisation", ids: [organisationId] },
    });

    // Workspace organisation remains internal; the customer reach fact comes from project.
    expect(owner.workspace.organisationId).not.toBe(organisationId);
    expect(
      await listReachableProjectFacts(identity, [
        served.project.id,
        internal.project.id,
      ]),
    ).toEqual([
      {
        id: served.project.id,
        workspaceId: owner.workspace.id,
        organisationId,
      },
    ]);

    const outcome = await db.transaction(async (tx) => {
      const allowed = await upsertOwnSettingRow(tx, identity, {
        target: {
          scope: "project",
          scopeId: served.project.id,
          rowKey: "layout",
        },
        value: "list",
        updatedAt: new Date(),
      });
      const denied = await upsertOwnSettingRow(tx, identity, {
        target: {
          scope: "project",
          scopeId: internal.project.id,
          rowKey: "layout",
        },
        value: "board",
        updatedAt: new Date(),
      });
      return { allowed, denied };
    });

    expect(outcome.allowed).toMatchObject({ personId: person.id });
    expect(outcome.denied).toBeUndefined();
    const rows = await db
      .select()
      .from(schema.userPreferenceTable)
      .where(eq(schema.userPreferenceTable.personId, person.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope: "project",
      scopeId: served.project.id,
      key: "layout",
      value: "list",
    });
  });

  it("rechecks a resolved staff identity after persisted project reach is revoked", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const project = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectRole(member.user.id, project.project.id, [
      "project:read",
    ]);

    const identity = await resolveIdentity({
      userId: member.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("staff identity did not resolve");
    expect(identity.side).toBe("staff");
    expect(
      await listReachableProjectFacts(identity, [project.project.id]),
    ).toHaveLength(1);

    // Keep the already-resolved identity while revoking its actual persisted project grant.
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, identity.personId),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, project.project.id),
        ),
      );

    expect(
      await listReachableProjectFacts(identity, [project.project.id]),
    ).toEqual([]);
    const denied = await db.transaction((tx) =>
      upsertOwnSettingRow(tx, identity, {
        target: {
          scope: "project",
          scopeId: project.project.id,
          rowKey: "layout",
        },
        value: "list",
        updatedAt: new Date(),
      }),
    );
    expect(denied).toBeUndefined();
    expect(
      await db
        .select()
        .from(schema.userPreferenceTable)
        .where(eq(schema.userPreferenceTable.personId, identity.personId)),
    ).toEqual([]);
  });

  it.each([
    "membership",
    "extra organisation membership",
    "person",
    "organisation inactive",
    "portal access",
    "organisation deleted",
    "role capabilities",
    "role capability order",
    "role key",
    "role scope",
    "role workspace",
    "role rank",
    "role system flag",
    "membership sees_all",
  ])(
    "rejects a resolved customer after %s admission is revoked",
    async (revocation) => {
      const fixture = await createCustomerPreferenceFixture();
      expect(fixture.identity.side).toBe("customer");
      expect(await listOwnSettingRows(fixture.identity)).toEqual([]);
      expect(
        await listReachableProjectFacts(fixture.identity, [
          fixture.project.project.id,
        ]),
      ).toHaveLength(1);
      await db.insert(schema.userPreferenceTable).values({
        personId: fixture.person.id,
        scope: "global",
        scopeId: null,
        key: "density",
        value: "compact",
      });
      expect(await listOwnSettingRows(fixture.identity)).toHaveLength(1);

      switch (revocation) {
        case "membership":
          await db
            .delete(schema.membershipTable)
            .where(eq(schema.membershipTable.id, fixture.membership.id));
          break;
        case "extra organisation membership": {
          const otherOrganisationId = `org-${randomUUID()}`;
          await db.insert(schema.organisationTable).values({
            id: otherOrganisationId,
            key: otherOrganisationId,
            name: "Other customer organisation",
            isInternal: false,
            active: true,
            portalAccess: true,
          });
          await db.insert(schema.membershipTable).values({
            personId: fixture.person.id,
            scope: "organisation",
            scopeId: otherOrganisationId,
            roleId: fixture.role.id,
            seesAll: false,
          });
          break;
        }
        case "person":
          await db
            .update(schema.personTable)
            .set({ active: false })
            .where(eq(schema.personTable.id, fixture.person.id));
          break;
        case "organisation inactive":
          await db
            .update(schema.organisationTable)
            .set({ active: false })
            .where(eq(schema.organisationTable.id, fixture.organisationId));
          break;
        case "portal access":
          await db
            .update(schema.organisationTable)
            .set({ portalAccess: false })
            .where(eq(schema.organisationTable.id, fixture.organisationId));
          break;
        case "organisation deleted":
          await db
            .update(schema.organisationTable)
            .set({ deletedAt: new Date() })
            .where(eq(schema.organisationTable.id, fixture.organisationId));
          break;
        case "role capabilities":
          await db
            .update(schema.roleTable)
            .set({ capabilities: [] })
            .where(eq(schema.roleTable.id, fixture.role.id));
          break;
        case "role capability order":
          await db
            .update(schema.roleTable)
            .set({
              capabilities: [...BUILT_IN_ROLES.customer.capabilities].reverse(),
            })
            .where(eq(schema.roleTable.id, fixture.role.id));
          break;
        case "role key":
          await db
            .update(schema.roleTable)
            .set({ key: "changed-customer" })
            .where(eq(schema.roleTable.id, fixture.role.id));
          break;
        case "role scope":
          await db
            .update(schema.roleTable)
            .set({ scope: "workspace" })
            .where(eq(schema.roleTable.id, fixture.role.id));
          break;
        case "role workspace":
          await db
            .update(schema.roleTable)
            .set({ workspaceId: fixture.project.project.workspaceId })
            .where(eq(schema.roleTable.id, fixture.role.id));
          break;
        case "role rank":
          await db
            .update(schema.roleTable)
            .set({ rank: BUILT_IN_ROLES.customer.rank + 1 })
            .where(eq(schema.roleTable.id, fixture.role.id));
          break;
        case "role system flag":
          await db
            .update(schema.roleTable)
            .set({ isSystem: false })
            .where(eq(schema.roleTable.id, fixture.role.id));
          break;
        case "membership sees_all":
          await db
            .update(schema.membershipTable)
            .set({ seesAll: true })
            .where(eq(schema.membershipTable.id, fixture.membership.id));
          break;
      }

      const denied = await db.transaction((tx) =>
        upsertOwnSettingRow(tx, fixture.identity, {
          target: {
            scope: "project",
            scopeId: fixture.project.project.id,
            rowKey: "layout",
          },
          value: "list",
          updatedAt: new Date(),
        }),
      );
      expect(denied).toBeUndefined();
      expect(await listOwnSettingRows(fixture.identity)).toEqual([]);
      expect(
        await listReachableProjectFacts(fixture.identity, [
          fixture.project.project.id,
        ]),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(schema.userPreferenceTable)
          .where(
            and(
              eq(schema.userPreferenceTable.personId, fixture.person.id),
              eq(schema.userPreferenceTable.scope, "project"),
            ),
          ),
      ).toEqual([]);
    },
  );

  it.each(["person deactivated", "user banned"])(
    "rejects a resolved staff identity after %s",
    async (revocation) => {
      const member = await createWorkspaceMember({ role: "member" });
      const project = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectRole(member.user.id, project.project.id, [
        "project:read",
      ]);
      const identity = await resolveIdentity({
        userId: member.user.id,
        credential: "session",
      });
      if (!identity) throw new Error("staff identity did not resolve");
      await db.insert(schema.userPreferenceTable).values({
        personId: identity.personId,
        scope: "global",
        scopeId: null,
        key: "density",
        value: "compact",
      });
      expect(await listOwnSettingRows(identity)).toHaveLength(1);
      if (revocation === "person deactivated") {
        await db
          .update(schema.personTable)
          .set({ active: false })
          .where(eq(schema.personTable.id, identity.personId));
      } else {
        await db
          .update(schema.userTable)
          .set({ banned: true })
          .where(eq(schema.userTable.id, member.user.id));
      }
      const denied = await db.transaction((tx) =>
        upsertOwnSettingRow(tx, identity, {
          target: {
            scope: "project",
            scopeId: project.project.id,
            rowKey: "layout",
          },
          value: "list",
          updatedAt: new Date(),
        }),
      );
      expect(denied).toBeUndefined();
      expect(await listOwnSettingRows(identity)).toEqual([]);
      expect(
        await listReachableProjectFacts(identity, [project.project.id]),
      ).toEqual([]);
    },
  );
});
