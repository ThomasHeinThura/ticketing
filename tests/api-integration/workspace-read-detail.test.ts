import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

// GET /api/workspace/{id} -- the native replacement for
// authClient.organization.getFullOrganization() (retrofit plan, S2 row,
// issue #6). Read only: workspace + members + pending invitations.

async function createInstanceAdmin() {
  const id = `admin-${randomUUID()}`;
  const admin = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id,
        email: `${id}@example.com`,
        emailVerified: true,
        name: "Instance Admin",
        role: "admin",
      })
      .returning(),
    "admin",
  );
  return admin;
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("GET /api/workspace/{id}", () => {
  it("refuses a caller who is not a member -- 403/404, never 200 with data (A1-P1)", async () => {
    const { workspace } = await createWorkspaceMember();
    const outsider = await createWorkspaceMember();

    mockAuthenticatedSession(outsider.user);
    const { app } = createApp();

    const response = await app.request(`/api/workspace/${workspace.id}`);
    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).not.toContain(workspace.id);
  });

  it("returns workspace, members, and pending invitations for a member", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.invitationTable).values({
      workspaceId: workspace.id,
      email: "invitee@example.com",
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      inviterId: user.id,
    });

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(`/api/workspace/${workspace.id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workspace: { id: string; name: string };
      members: Array<{ id: string; role: string }>;
      pendingInvitations: Array<{ email: string }>;
    };

    expect(body.workspace.id).toBe(workspace.id);
    expect(body.members).toHaveLength(1);
    expect(body.pendingInvitations).toHaveLength(1);
    expect(body.pendingInvitations[0]?.email).toBe("invitee@example.com");
  });

  it("404s a workspace id that does not exist -- not 500, no stack leak (A1-P7)", async () => {
    const admin = await createInstanceAdmin();
    mockAuthenticatedSession(admin);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/does-not-exist-${randomUUID()}`,
    );
    expect(response.status).toBe(404);
    const body = await response.text();
    // No stack trace / file path leaked in the error body.
    expect(body).not.toMatch(/\.ts:\d+/);
    expect(body).not.toContain("node_modules");
  });

  it("404s a well-formed id belonging to a deleted workspace (A1-P8)", async () => {
    const admin = await createInstanceAdmin();
    const { workspace } = await createWorkspaceMember();
    await db
      .delete(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspace.id));

    mockAuthenticatedSession(admin);
    const { app } = createApp();

    const response = await app.request(`/api/workspace/${workspace.id}`);
    expect(response.status).toBe(404);
  });

  it("reports role=owner for the creator, and seeds no owner row in workspace_role (A1-P9)", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(`/api/workspace/${workspace.id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      members: Array<{ id: string; role: string }>;
    };
    const me = body.members.find((m) => m.id === user.id);
    expect(me?.role).toBe("owner");

    const ownerRoleRows = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspace.id),
          eq(schema.workspaceRoleTable.role, "owner"),
        ),
      );
    expect(ownerRoleRows).toHaveLength(0);
  });
});
