/**
 * P4 review H1 (RL-3): handing a person a role compares capabilities, not only rank. A custom
 * role may carry any capability at any rank (an Admin clone sits at rank 30), so a manager or
 * lead who passes the rank test must still be refused a role that holds something they do not.
 * Covers add, change (including your own), invite, accept and bulk reassignment.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import { signUpUser } from "./helpers/organization-http";
import {
  acceptInvitationNative,
  inviteAndAcceptAsNewMemberNative,
  inviteWorkspaceMemberNative,
} from "./helpers/workspace-invitation-write-http";
import {
  addWorkspaceMemberNative,
  updateWorkspaceMemberRoleNative,
} from "./helpers/workspace-membership-write-http";
import {
  createWorkspaceRoleNative,
  listWorkspaceRolesNative,
  reassignWorkspaceRoleNative,
} from "./helpers/workspace-role-write-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

type App = ReturnType<typeof createApp>["app"];
type RoleBody = {
  id: string;
  role: string;
  rank: number;
  capabilities: string[];
};

beforeEach(async () => {
  await resetTestDatabase();
});

async function setup() {
  const { app } = createApp();
  const owner = await signUpUser(app);
  const created = await createWorkspaceNative(app, owner.cookie, {
    name: "Assignment",
  });
  expect(created.status).toBe(200);
  const workspaceId = ((await created.json()) as { id: string }).id;
  return { app, owner, workspaceId };
}

async function roleByKey(
  app: App,
  cookie: string,
  workspaceId: string,
  key: string,
) {
  const response = await listWorkspaceRolesNative(app, cookie, workspaceId);
  const found = ((await response.json()) as RoleBody[]).find(
    (role) => role.role === key,
  );
  if (!found) throw new Error(`no role ${key}`);
  return found;
}

/** The owner clones Admin: same capabilities, but the default rank (30) sits below a manager. */
async function adminClone(app: App, cookie: string, workspaceId: string) {
  const admin = await roleByKey(app, cookie, workspaceId, "admin");
  const response = await createWorkspaceRoleNative(app, cookie, workspaceId, {
    role: "Integrations",
    cloneFromRoleId: admin.id,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const clone = (await response.json()) as RoleBody;
  expect(clone.rank).toBeLessThan(60);
  return clone;
}

async function refused(response: Response) {
  expect(response.status, await response.clone().text()).toBe(403);
  const body = JSON.parse(await response.text()) as { error?: string };
  expect(body.error).toBe("beyond_own_authority");
}

async function roleOf(workspaceId: string, userId: string) {
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

describe("role assignment compares capabilities (H1)", () => {
  it("a manager cannot move themselves into a lower-ranked role that holds more", async () => {
    const { app, owner, workspaceId } = await setup();
    await adminClone(app, owner.cookie, workspaceId);
    const manager = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "manager",
    );
    const response = await updateWorkspaceMemberRoleNative(
      app,
      manager.cookie,
      workspaceId,
      manager.user.id,
      { role: "integrations" },
    );
    await refused(response);
    expect(await roleOf(workspaceId, manager.user.id)).toBe("manager");
  });

  it("a manager cannot add or promote a peer into it either", async () => {
    const { app, owner, workspaceId } = await setup();
    await adminClone(app, owner.cookie, workspaceId);
    const manager = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "manager",
    );
    const member = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );
    await refused(
      await updateWorkspaceMemberRoleNative(
        app,
        manager.cookie,
        workspaceId,
        member.user.id,
        { role: "integrations" },
      ),
    );
    const outsider = await signUpUser(app);
    await refused(
      await addWorkspaceMemberNative(app, manager.cookie, workspaceId, {
        userId: outsider.user.id,
        role: "integrations",
      }),
    );
    expect(await roleOf(workspaceId, member.user.id)).toBe("member");
  });

  it("a lead cannot invite with it, and an invitation cannot be accepted once its inviter lost the authority", async () => {
    const { app, owner, workspaceId } = await setup();
    await adminClone(app, owner.cookie, workspaceId);
    const lead = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "lead",
    );
    await refused(
      await inviteWorkspaceMemberNative(app, lead.cookie, workspaceId, {
        email: "escalation@example.com",
        role: "integrations",
      }),
    );

    // The owner invites into a role the lead may not grant; a lead-issued invitation for a role
    // that is later edited upwards must fail at acceptance.
    const invitee = await signUpUser(app);
    const lowRole = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "Helper", rank: 20, capabilities: ["project:read"] },
    );
    expect(lowRole.status, await lowRole.clone().text()).toBe(200);
    const invited = await inviteWorkspaceMemberNative(
      app,
      lead.cookie,
      workspaceId,
      { email: invitee.user.email, role: "helper" },
    );
    expect(invited.status, await invited.clone().text()).toBe(200);
    const invitation = (await invited.json()) as { id: string };
    // Widen the role beyond the lead after the invitation was issued.
    await db
      .update(schema.roleTable)
      .set({ capabilities: ["workspace:manage_roles"] })
      .where(
        and(
          eq(schema.roleTable.workspaceId, workspaceId),
          eq(schema.roleTable.key, "helper"),
        ),
      );
    const accepted = await acceptInvitationNative(
      app,
      invitee.cookie,
      invitation.id,
    );
    expect(accepted.status, await accepted.clone().text()).toBe(403);
    expect(await roleOf(workspaceId, invitee.user.id)).toBeUndefined();
  });

  it("bulk reassignment cannot move people into a role the caller does not fully hold", async () => {
    const { app, owner, workspaceId } = await setup();
    const clone = await adminClone(app, owner.cookie, workspaceId);
    const small = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "Small", rank: 20, capabilities: ["project:read"] },
    );
    const smallRole = (await small.json()) as RoleBody;
    const viewer = await roleByKey(app, owner.cookie, workspaceId, "viewer");
    const roleManager = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      {
        role: "Rolemgr",
        rank: 60,
        capabilities: [
          ...viewer.capabilities,
          "workspace:manage_roles",
          "workspace:manage_members",
        ],
      },
    );
    expect(roleManager.status, await roleManager.clone().text()).toBe(200);
    const caller = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "rolemgr",
    );
    const holder = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "small",
    );
    await refused(
      await reassignWorkspaceRoleNative(
        app,
        caller.cookie,
        workspaceId,
        smallRole.id,
        { toRoleId: clone.id },
      ),
    );
    expect(await roleOf(workspaceId, holder.user.id)).toBe("small");
  });

  it("an admin may still assign what they hold, including another admin and the clone", async () => {
    const { app, owner, workspaceId } = await setup();
    await adminClone(app, owner.cookie, workspaceId);
    const admin = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    const member = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );
    const changed = await updateWorkspaceMemberRoleNative(
      app,
      admin.cookie,
      workspaceId,
      member.user.id,
      { role: "integrations" },
    );
    expect(changed.status, await changed.clone().text()).toBe(200);
  });
});
