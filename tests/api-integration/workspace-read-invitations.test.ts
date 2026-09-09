import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

// GET /api/workspace/{id}/invitations -- the native replacement for
// authClient.organization.listInvitations() (retrofit plan, S2 row, issue
// #6). Read only: this workspace's pending, unexpired invitations.

beforeEach(async () => {
  await resetTestDatabase();
});

describe("GET /api/workspace/{id}/invitations", () => {
  it("refuses a caller who is not a member (A1-P2)", async () => {
    const { workspace } = await createWorkspaceMember();
    const outsider = await createWorkspaceMember();

    mockAuthenticatedSession(outsider.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${workspace.id}/invitations`,
    );
    expect(response.status).toBe(403);
  });

  it("lists only THIS workspace's pending, unexpired invitations -- not another workspace's, not expired, not already resolved", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const other = await createWorkspaceMember();

    await db.insert(schema.invitationTable).values([
      {
        workspaceId: workspace.id,
        email: "pending@example.com",
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        inviterId: user.id,
      },
      {
        workspaceId: workspace.id,
        email: "expired@example.com",
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() - 1000),
        inviterId: user.id,
      },
      {
        workspaceId: workspace.id,
        email: "accepted@example.com",
        role: "member",
        status: "accepted",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        inviterId: user.id,
      },
      {
        workspaceId: other.workspace.id,
        email: "other-workspace@example.com",
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        inviterId: other.user.id,
      },
    ]);

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(
      `/api/workspace/${workspace.id}/invitations`,
    );
    expect(response.status).toBe(200);
    const invitations = (await response.json()) as Array<{ email: string }>;
    expect(invitations.map((i) => i.email)).toEqual(["pending@example.com"]);
  });
});
