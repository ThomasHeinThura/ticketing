/**
 * S5 — native membership writes (issue #6, retrofit plan §3, S5 row).
 *
 * Positive paths, validation errors, and the capability/role boundaries for
 * the five routes: add member, remove member, update member role, leave,
 * transfer ownership. Same authorization shape S4 established (`workspace-
 * write-authorization.test.ts`), applied to this batch's own routes.
 *
 * The three specifically required negative probes (last owner cannot leave,
 * cannot self-demote, cannot remove a member of another workspace) and the
 * concurrent ownership-transfer probe live in
 * `workspace-membership-writes-negative.test.ts`, kept separate so the
 * required set is easy to find and audit on its own.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  inviteAndAcceptAsNewMember,
  signUpUser,
} from "./helpers/organization-http";
import {
  addWorkspaceMemberNative,
  leaveWorkspaceNative,
  removeWorkspaceMemberNative,
  transferWorkspaceOwnershipNative,
  updateWorkspaceMemberRoleNative,
} from "./helpers/workspace-membership-write-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

async function createWorkspace(
  app: ReturnType<typeof createApp>["app"],
  cookie: string,
  name: string,
): Promise<string> {
  const created = await createWorkspaceNative(app, cookie, { name });
  if (created.status !== 200) {
    throw new Error(`create failed: ${created.status} ${await created.text()}`);
  }
  return ((await created.json()) as { id: string }).id;
}

async function membershipRole(
  workspaceId: string,
  userId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    );
  return row?.role;
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("S5 add member (POST /api/workspace/{id}/members)", () => {
  it("an admin adds an existing platform user with a seeded role", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Roster");
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    const newcomer = await signUpUser(app);

    const added = await addWorkspaceMemberNative(
      app,
      admin.cookie,
      workspaceId,
      {
        userId: newcomer.user.id,
        role: "member",
      },
    );
    expect(added.status).toBe(200);
    const body = (await added.json()) as { id: string; role: string };
    expect(body.id).toBe(newcomer.user.id);
    expect(body.role).toBe("member");

    expect(await membershipRole(workspaceId, newcomer.user.id)).toBe("member");
  });

  it("rejects role 'owner' -- ownership only moves through transfer-ownership", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "No Second Owner",
    );
    const newcomer = await signUpUser(app);

    const added = await addWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      {
        userId: newcomer.user.id,
        role: "owner",
      },
    );
    expect(added.status).toBe(400);
    expect(await membershipRole(workspaceId, newcomer.user.id)).toBeUndefined();
  });

  it("rejects an unknown role -- ROLE_NOT_FOUND semantics, not a free-text write", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Unknown Role",
    );
    const newcomer = await signUpUser(app);

    const added = await addWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      {
        userId: newcomer.user.id,
        role: "does-not-exist",
      },
    );
    expect(added.status).toBe(400);
  });

  it("rejects a userId that does not exist", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Ghost");

    const added = await addWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      {
        userId: "does-not-exist",
        role: "member",
      },
    );
    expect(added.status).toBe(404);
  });

  it("rejects adding someone who is already a member", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Dup");
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const added = await addWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      {
        userId: member.user.id,
        role: "admin",
      },
    );
    expect(added.status).toBe(409);
    // Unchanged -- still "member", not silently promoted.
    expect(await membershipRole(workspaceId, member.user.id)).toBe("member");
  });

  it("a viewer cannot add a member -- the seeded viewer payload carries no member:create", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Viewer Blocked",
    );
    const viewer = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "viewer",
    );
    const newcomer = await signUpUser(app);

    const added = await addWorkspaceMemberNative(
      app,
      viewer.cookie,
      workspaceId,
      {
        userId: newcomer.user.id,
        role: "member",
      },
    );
    expect(added.status).toBe(403);
    expect(await membershipRole(workspaceId, newcomer.user.id)).toBeUndefined();
  });
});

describe("S5 remove member (DELETE /api/workspace/{id}/members/{userId})", () => {
  it("an admin removes a member", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Removable");
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const removed = await removeWorkspaceMemberNative(
      app,
      admin.cookie,
      workspaceId,
      member.user.id,
    );
    expect(removed.status).toBe(200);
    expect(await membershipRole(workspaceId, member.user.id)).toBeUndefined();
  });

  it("404s for a userId with no membership row in this workspace at all", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "No Such Member",
    );
    const stranger = await signUpUser(app);

    const removed = await removeWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      stranger.user.id,
    );
    expect(removed.status).toBe(404);
  });

  it("a viewer cannot remove a member", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Viewer Cannot Remove",
    );
    const viewer = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "viewer",
    );
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const removed = await removeWorkspaceMemberNative(
      app,
      viewer.cookie,
      workspaceId,
      member.user.id,
    );
    expect(removed.status).toBe(403);
    expect(await membershipRole(workspaceId, member.user.id)).toBe("member");
  });

  it("clears the removed user's session active_organization_id when it pointed here", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Session Clear",
    );
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    await db
      .update(schema.sessionTable)
      .set({ activeOrganizationId: workspaceId })
      .where(eq(schema.sessionTable.userId, member.user.id));

    const removed = await removeWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      member.user.id,
    );
    expect(removed.status).toBe(200);

    const [sessionAfter] = await db
      .select({
        activeOrganizationId: schema.sessionTable.activeOrganizationId,
      })
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, member.user.id));
    expect(sessionAfter?.activeOrganizationId).toBeNull();
  });
});

describe("S5 update member role (PATCH /api/workspace/{id}/members/{userId}/role)", () => {
  it("an admin promotes a member to admin", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Promote");
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const updated = await updateWorkspaceMemberRoleNative(
      app,
      admin.cookie,
      workspaceId,
      member.user.id,
      { role: "admin" },
    );
    expect(updated.status).toBe(200);
    expect(await membershipRole(workspaceId, member.user.id)).toBe("admin");
  });

  it("rejects setting role to 'owner'", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "No Owner Grant",
    );
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const updated = await updateWorkspaceMemberRoleNative(
      app,
      owner.cookie,
      workspaceId,
      member.user.id,
      { role: "owner" },
    );
    expect(updated.status).toBe(400);
    expect(await membershipRole(workspaceId, member.user.id)).toBe("member");
  });

  it("rejects an unknown role", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Unknown Role Update",
    );
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const updated = await updateWorkspaceMemberRoleNative(
      app,
      owner.cookie,
      workspaceId,
      member.user.id,
      { role: "does-not-exist" },
    );
    expect(updated.status).toBe(400);
  });

  it("404s for a target with no membership row here", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "No Target");
    const stranger = await signUpUser(app);

    const updated = await updateWorkspaceMemberRoleNative(
      app,
      owner.cookie,
      workspaceId,
      stranger.user.id,
      { role: "admin" },
    );
    expect(updated.status).toBe(404);
  });

  it("a viewer cannot change another member's role", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Viewer Cannot Update",
    );
    const viewer = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "viewer",
    );
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const updated = await updateWorkspaceMemberRoleNative(
      app,
      viewer.cookie,
      workspaceId,
      member.user.id,
      { role: "admin" },
    );
    expect(updated.status).toBe(403);
    expect(await membershipRole(workspaceId, member.user.id)).toBe("member");
  });
});

describe("S5 leave (POST /api/workspace/{id}/leave)", () => {
  it("an ordinary member leaves and their row is gone", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Leaveable");
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const left = await leaveWorkspaceNative(app, member.cookie, workspaceId);
    expect(left.status).toBe(200);
    expect(await membershipRole(workspaceId, member.user.id)).toBeUndefined();
  });

  it("an admin (not the only owner) can leave -- the rule is about owners, not authority level", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Admin Leaves",
    );
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    const left = await leaveWorkspaceNative(app, admin.cookie, workspaceId);
    expect(left.status).toBe(200);
    expect(await membershipRole(workspaceId, admin.user.id)).toBeUndefined();
  });

  it("404s for a non-member", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Not Yours");
    const stranger = await signUpUser(app);

    const left = await leaveWorkspaceNative(app, stranger.cookie, workspaceId);
    expect([403, 404]).toContain(left.status);
  });
});

describe("S5 transfer ownership (POST /api/workspace/{id}/transfer-ownership)", () => {
  it("atomically installs the new owner and demotes the caller to admin", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Transfer");
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const transferred = await transferWorkspaceOwnershipNative(
      app,
      owner.cookie,
      workspaceId,
      { newOwnerUserId: member.user.id },
    );
    expect(transferred.status).toBe(200);
    const body = (await transferred.json()) as {
      newOwnerUserId: string;
      previousOwnerUserId: string;
      previousOwnerNewRole: string;
    };
    expect(body.newOwnerUserId).toBe(member.user.id);
    expect(body.previousOwnerUserId).toBe(owner.user.id);
    expect(body.previousOwnerNewRole).toBe("admin");

    expect(await membershipRole(workspaceId, member.user.id)).toBe("owner");
    expect(await membershipRole(workspaceId, owner.user.id)).toBe("admin");

    const owners = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.role, "owner"),
        ),
      );
    expect(owners).toHaveLength(1);
  });

  it("rejects a caller who is not the current owner", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Not Owner");
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const transferred = await transferWorkspaceOwnershipNative(
      app,
      admin.cookie,
      workspaceId,
      { newOwnerUserId: member.user.id },
    );
    expect(transferred.status).toBe(403);
    expect(await membershipRole(workspaceId, member.user.id)).toBe("member");
    expect(await membershipRole(workspaceId, owner.user.id)).toBe("owner");
  });

  // The remaining native roles that must be refused `workspace:transfer_ownership`
  // (rbac.md § Capabilities — granted to `owner` alone). `admin` above is the
  // shape every one of these follows: attempt the transfer, assert 403, and
  // assert BOTH roles are unchanged in the database afterwards — the invariant
  // this batch closes is that the capability check refuses the request before
  // any row is touched, not merely that the response looks like a refusal.
  //
  // `manager` and `lead` are the two that matter most: `manager` is the role
  // the permission-matrix fixture used to read `allow` for on this exact route
  // (the defect this batch fixes), and `lead` sits directly below it on the
  // rank ladder. Neither better-auth's organization plugin nor the seeded
  // `workspace_role` rows know about `manager`/`lead`/`customer` (they are
  // TaskDesk additions with no seeded row and no better-auth `ac` role), so
  // those three memberships are inserted directly — the same technique
  // `workspace-write-authorization.test.ts`'s A2-P17 probe uses to give an
  // instance admin a plain `workspace_member` row without going through the
  // invite flow.
  it("rejects a caller who is a manager", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Not Manager");
    const manager = await signUpUser(app);
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: manager.user.id,
      role: "manager",
      joinedAt: new Date(),
    });
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const transferred = await transferWorkspaceOwnershipNative(
      app,
      manager.cookie,
      workspaceId,
      { newOwnerUserId: member.user.id },
    );
    expect(transferred.status).toBe(403);
    expect(await membershipRole(workspaceId, member.user.id)).toBe("member");
    expect(await membershipRole(workspaceId, owner.user.id)).toBe("owner");
  });

  it("rejects a caller who is a lead", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Not Lead");
    const lead = await signUpUser(app);
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: lead.user.id,
      role: "lead",
      joinedAt: new Date(),
    });
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const transferred = await transferWorkspaceOwnershipNative(
      app,
      lead.cookie,
      workspaceId,
      { newOwnerUserId: member.user.id },
    );
    expect(transferred.status).toBe(403);
    expect(await membershipRole(workspaceId, member.user.id)).toBe("member");
    expect(await membershipRole(workspaceId, owner.user.id)).toBe("owner");
  });

  it("rejects a caller who is a plain member", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Not Member");
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );
    const other = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const transferred = await transferWorkspaceOwnershipNative(
      app,
      member.cookie,
      workspaceId,
      { newOwnerUserId: other.user.id },
    );
    expect(transferred.status).toBe(403);
    expect(await membershipRole(workspaceId, other.user.id)).toBe("member");
    expect(await membershipRole(workspaceId, owner.user.id)).toBe("owner");
  });

  it("rejects a caller who is a viewer", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Not Viewer");
    const viewer = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "viewer",
    );
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const transferred = await transferWorkspaceOwnershipNative(
      app,
      viewer.cookie,
      workspaceId,
      { newOwnerUserId: member.user.id },
    );
    expect(transferred.status).toBe(403);
    expect(await membershipRole(workspaceId, member.user.id)).toBe("member");
    expect(await membershipRole(workspaceId, owner.user.id)).toBe("owner");
  });

  it("rejects a caller who is a customer", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Not Customer",
    );
    const customer = await signUpUser(app);
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: customer.user.id,
      role: "customer",
      joinedAt: new Date(),
    });
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const transferred = await transferWorkspaceOwnershipNative(
      app,
      customer.cookie,
      workspaceId,
      { newOwnerUserId: member.user.id },
    );
    expect(transferred.status).toBe(403);
    expect(await membershipRole(workspaceId, member.user.id)).toBe("member");
    expect(await membershipRole(workspaceId, owner.user.id)).toBe("owner");
  });

  // The instance-admin boundary, same shape as `workspace-write-authorization.
  // test.ts`'s A2-P17: an instance admin who IS a member of this workspace,
  // but whose OWN workspace role does not grant the capability, must be
  // refused exactly like anyone else — `requireWorkspaceCapability` never
  // calls `isInstanceAdmin`, so there is no bypass to probe here, only its
  // absence. `databaseHooks.user.create.after` promotes the FIRST user on the
  // instance to instance admin (`apps/api/src/auth.ts`), so the instance
  // admin is signed up before the owner, matching that same file's
  // `bootstrapInstanceAdmin` ordering.
  it("rejects an instance admin who is not this workspace's owner", async () => {
    const { app } = createApp();
    const instanceAdmin = await signUpUser(app);
    const [adminRow] = await db
      .select({ role: schema.userTable.role })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, instanceAdmin.user.id));
    expect(adminRow?.role).toBe("admin");

    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Not Instance Admin's",
    );
    // A plain member row -- an ordinary workspace role, deliberately not "owner".
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: instanceAdmin.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    const target = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const transferred = await transferWorkspaceOwnershipNative(
      app,
      instanceAdmin.cookie,
      workspaceId,
      { newOwnerUserId: target.user.id },
    );
    expect(transferred.status).toBe(403);
    expect(await membershipRole(workspaceId, target.user.id)).toBe("member");
    expect(await membershipRole(workspaceId, owner.user.id)).toBe("owner");
  });

  it("rejects a new owner who is not a member of this workspace", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Stranger Transfer",
    );
    const stranger = await signUpUser(app);

    const transferred = await transferWorkspaceOwnershipNative(
      app,
      owner.cookie,
      workspaceId,
      { newOwnerUserId: stranger.user.id },
    );
    expect(transferred.status).toBe(404);
    expect(await membershipRole(workspaceId, owner.user.id)).toBe("owner");
  });

  it("rejects transferring to the caller themselves", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Self Transfer",
    );

    const transferred = await transferWorkspaceOwnershipNative(
      app,
      owner.cookie,
      workspaceId,
      { newOwnerUserId: owner.user.id },
    );
    expect(transferred.status).toBe(400);
    expect(await membershipRole(workspaceId, owner.user.id)).toBe("owner");
  });
});
