import { randomUUID } from "node:crypto";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import {
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
});
