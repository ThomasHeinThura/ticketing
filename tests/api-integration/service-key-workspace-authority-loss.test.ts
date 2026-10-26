import { authorityFor } from "@taskdesk/permissions";
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createServiceApiKey,
  reattestServiceApiKey,
} from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import {
  apiKeyExtensionTable,
  apikeyTable,
} from "../../apps/api/src/database/schema";
import { projectMembershipKeys } from "../../apps/api/src/identity/repository";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import leaveWorkspace from "../../apps/api/src/workspace/controllers/leave-workspace";
import removeWorkspaceMember from "../../apps/api/src/workspace/controllers/remove-workspace-member";
import transferWorkspaceOwnership from "../../apps/api/src/workspace/controllers/transfer-workspace-ownership";
import updateWorkspaceMemberRole from "../../apps/api/src/workspace/controllers/update-workspace-member-role";
import {
  createRole,
  resolveRoleCaller,
  updateRole,
} from "../../apps/api/src/workspace/role-service";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

async function addWorkspaceMembership(
  workspaceId: string,
  userId: string,
  role: string,
) {
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId,
    role,
    joinedAt: new Date(),
  });
}

describe("AK-7 workspace authority loss", () => {
  beforeEach(async () => resetTestDatabase());

  it("marks only after a real demotion loss and does not reflag an acknowledged no-op", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const creator = await createWorkspaceMember({ role: "admin" });
    await addWorkspaceMembership(owner.workspace.id, creator.user.id, "admin");
    const key = await createServiceApiKey(
      { userId: creator.user.id },
      owner.workspace.id,
      { name: "Workspace reader", capabilities: ["workspace:read"] },
    );
    const [credentialBefore] = await db
      .select({
        keyHash: apikeyTable.key,
        permissions: apikeyTable.permissions,
      })
      .from(apikeyTable)
      .where(eq(apikeyTable.id, key.id));

    await updateWorkspaceMemberRole(
      owner.workspace.id,
      creator.user.id,
      "member",
      owner.user.id,
    );

    const [transferred] = await db
      .select()
      .from(apiKeyExtensionTable)
      .where(eq(apiKeyExtensionTable.apikeyId, key.id));
    expect(transferred?.adminOwnershipTransferredAt).toBeInstanceOf(Date);
    expect(transferred?.reattestationRequiredAt).toBeInstanceOf(Date);
    expect(transferred?.formerCreatorAt).toBeNull();
    expect(transferred?.capabilities).toEqual(["workspace:read"]);
    expect(transferred?.accountabilityVersion).toBe(2);

    const acknowledged = await reattestServiceApiKey(
      { userId: owner.user.id },
      owner.workspace.id,
      key.id,
      2,
    );
    expect(acknowledged.requiresReattestation).toBe(false);

    // A repeated role assignment has no before/after capability loss and must not undo the
    // explicit acknowledgement just because this creator once lost api_key:manage.
    await updateWorkspaceMemberRole(
      owner.workspace.id,
      creator.user.id,
      "member",
      owner.user.id,
    );
    const [afterNoOp] = await db
      .select()
      .from(apiKeyExtensionTable)
      .where(eq(apiKeyExtensionTable.apikeyId, key.id));
    expect(afterNoOp?.reattestationRequiredAt).toBeNull();
    expect(afterNoOp?.accountabilityVersion).toBe(3);
    const [credentialAfter] = await db
      .select({
        keyHash: apikeyTable.key,
        permissions: apikeyTable.permissions,
      })
      .from(apikeyTable)
      .where(eq(apikeyTable.id, key.id));
    expect(credentialAfter).toEqual(credentialBefore);
  });

  it.each(["remove", "leave"] as const)(
    "transfers accountability without calling a workspace leaver a former person (%s)",
    async (kind) => {
      const owner = await createWorkspaceMember({ role: "owner" });
      const creator = await createWorkspaceMember({ role: "admin" });
      await addWorkspaceMembership(
        owner.workspace.id,
        creator.user.id,
        "admin",
      );
      const key = await createServiceApiKey(
        { userId: creator.user.id },
        owner.workspace.id,
        { name: "Workspace reader", capabilities: ["workspace:read"] },
      );

      if (kind === "remove") {
        await removeWorkspaceMember(owner.workspace.id, creator.user.id);
      } else {
        await leaveWorkspace(
          owner.workspace.id,
          creator.user.id,
          "no-session-fixture",
        );
      }

      const [transferred] = await db
        .select()
        .from(apiKeyExtensionTable)
        .where(eq(apiKeyExtensionTable.apikeyId, key.id));
      expect(transferred?.adminOwnershipTransferredAt).toBeInstanceOf(Date);
      expect(transferred?.reattestationRequiredAt).toBeInstanceOf(Date);
      expect(transferred?.formerCreatorAt).toBeNull();
      expect(transferred?.capabilities).toEqual(["workspace:read"]);
      const [credential] = await db
        .select({ enabled: apikeyTable.enabled })
        .from(apikeyTable)
        .where(eq(apikeyTable.id, key.id));
      expect(credential?.enabled).toBe(true);
    },
  );

  it("marks a transferred owner key when its frozen ownership-transfer capability is lost", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const incoming = await createWorkspaceMember({ role: "member" });
    await addWorkspaceMembership(
      owner.workspace.id,
      incoming.user.id,
      "member",
    );
    const key = await createServiceApiKey(
      { userId: owner.user.id },
      owner.workspace.id,
      {
        name: "Ownership transfer key",
        capabilities: ["workspace:transfer_ownership"],
      },
    );
    const frozenCapabilitiesBeforeTransfer = [...key.capabilities];

    await transferWorkspaceOwnership(
      owner.workspace.id,
      owner.user.id,
      incoming.user.id,
    );

    const [transferred] = await db
      .select()
      .from(apiKeyExtensionTable)
      .where(eq(apiKeyExtensionTable.apikeyId, key.id));
    expect(transferred?.adminOwnershipTransferredAt).toBeInstanceOf(Date);
    expect(transferred?.reattestationRequiredAt).toBeInstanceOf(Date);
    expect(transferred?.formerCreatorAt).toBeNull();
    expect(transferred?.capabilities).toEqual(frozenCapabilitiesBeforeTransfer);
  });

  it("marks a key when a role edit removes one frozen capability while retaining key management", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const creator = await createWorkspaceMember({ role: "member" });
    const ownerCaller = await resolveRoleCaller(
      owner.workspace.id,
      owner.user.id,
      {
        userId: owner.user.id,
        actorType: "person",
      },
    );
    if (!ownerCaller)
      throw new Error("Workspace owner role caller was not resolved");
    const role = await createRole({
      workspaceId: owner.workspace.id,
      name: "Key Manager With Projects",
      rank: 50,
      capabilities: ["workspace:read", "api_key:manage", "project:read"],
      caller: ownerCaller,
    });
    await addWorkspaceMembership(
      owner.workspace.id,
      creator.user.id,
      role.role,
    );
    const key = await createServiceApiKey(
      { userId: creator.user.id },
      owner.workspace.id,
      { name: "Project reader", capabilities: ["project:read"] },
    );

    await updateRole({
      workspaceId: owner.workspace.id,
      roleId: role.id,
      expectedVersion: role.version,
      capabilities: ["workspace:read", "api_key:manage"],
      caller: ownerCaller,
    });

    const creatorIdentity = await resolveIdentity({
      userId: creator.user.id,
      credential: "session",
    });
    expect(creatorIdentity).not.toBeNull();
    expect(
      authorityFor(creatorIdentity!, "workspace", {
        workspaceId: owner.workspace.id,
      }).has("api_key:manage"),
    ).toBe(true);

    const [transferred] = await db
      .select()
      .from(apiKeyExtensionTable)
      .where(eq(apiKeyExtensionTable.apikeyId, key.id));
    expect(transferred?.adminOwnershipTransferredAt).toBeInstanceOf(Date);
    expect(transferred?.reattestationRequiredAt).toBeInstanceOf(Date);
    expect(transferred?.formerCreatorAt).toBeNull();
    expect(transferred?.capabilities).toEqual(["project:read"]);
  });

  it("flags a frozen capability lost when a direct membership grant is retired and reprojected", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const creator = await createWorkspaceMember({ role: "member" });
    const caller = await resolveRoleCaller(owner.workspace.id, owner.user.id, {
      userId: owner.user.id,
      actorType: "person",
    });
    if (!caller)
      throw new Error("Workspace owner role caller was not resolved");
    const keyManagerRole = await createRole({
      workspaceId: owner.workspace.id,
      name: "Key Manager",
      rank: 50,
      capabilities: ["workspace:read", "api_key:manage"],
      caller,
    });
    await addWorkspaceMembership(
      owner.workspace.id,
      creator.user.id,
      keyManagerRole.role,
    );

    const [creatorPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, creator.user.id));
    const [ownerPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, owner.user.id));
    const [adminRole] = await db
      .select({ id: schema.roleTable.id })
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.workspaceId, owner.workspace.id),
          eq(schema.roleTable.scope, "workspace"),
          eq(schema.roleTable.key, "admin"),
        ),
      );
    if (!creatorPerson || !ownerPerson || !adminRole) {
      throw new Error("Direct-grant test fixture is incomplete");
    }
    const [grant] = await db
      .insert(schema.membershipGrantTable)
      .values({
        personId: creatorPerson.id,
        scope: "workspace",
        scopeId: owner.workspace.id,
        roleId: adminRole.id,
        sourceKind: "direct",
        directOrigin: "admin",
        grantedByPersonId: ownerPerson.id,
      })
      .returning({ id: schema.membershipGrantTable.id });
    if (!grant) throw new Error("Direct grant insert returned no row");
    await db.transaction((tx) =>
      projectMembershipKeys(tx, [
        {
          personId: creatorPerson.id,
          scope: "workspace",
          scopeId: owner.workspace.id,
        },
      ]),
    );

    const key = await createServiceApiKey(
      { userId: creator.user.id },
      owner.workspace.id,
      { name: "Direct-grant project reader", capabilities: ["project:read"] },
    );

    await db.transaction(async (tx) => {
      await tx
        .update(schema.membershipGrantTable)
        .set({
          revokedAt: new Date(),
          revocationReason: "direct_removed",
          updatedAt: new Date(),
          membershipId: null,
        })
        .where(
          and(
            eq(schema.membershipGrantTable.id, grant.id),
            isNull(schema.membershipGrantTable.revokedAt),
          ),
        );
      await projectMembershipKeys(tx, [
        {
          personId: creatorPerson.id,
          scope: "workspace",
          scopeId: owner.workspace.id,
        },
      ]);
    });

    const creatorIdentity = await resolveIdentity({
      userId: creator.user.id,
      credential: "session",
    });
    expect(creatorIdentity).not.toBeNull();
    const remaining = authorityFor(creatorIdentity!, "workspace", {
      workspaceId: owner.workspace.id,
    });
    expect(remaining.has("api_key:manage")).toBe(true);
    expect(remaining.has("project:read")).toBe(false);

    const [transferred] = await db
      .select()
      .from(apiKeyExtensionTable)
      .where(eq(apiKeyExtensionTable.apikeyId, key.id));
    expect(transferred?.adminOwnershipTransferredAt).toBeInstanceOf(Date);
    expect(transferred?.reattestationRequiredAt).toBeInstanceOf(Date);
    expect(transferred?.formerCreatorAt).toBeNull();
    expect(transferred?.capabilities).toEqual(["project:read"]);
  });
});
