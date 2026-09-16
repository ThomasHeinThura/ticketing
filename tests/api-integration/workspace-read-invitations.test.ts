import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

// GET /api/workspace/{id}/invitations -- the native replacement for
// authClient.organization.listInvitations() (retrofit plan, S2 row, issue
// #6). Read only: this workspace's invitations that are still
// status = "pending" -- expired or not (issue #160; see
// get-workspace-invitations.ts's own doc comment for why expired ones are
// included here even though the INVITEE-facing pending-invitations list is
// filtered by expiry).

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

  it("lists only THIS workspace's still-pending invitations, expired or not -- not another workspace's, not already resolved", async () => {
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
    expect(new Set(invitations.map((i) => i.email))).toEqual(
      new Set(["pending@example.com", "expired@example.com"]),
    );
  });

  // Issue #160 (Opus security review of PR #158, the invitation ceiling):
  // the native ceiling counts every `status = "pending"` row regardless of
  // expiry (deliberate -- otherwise the cap is dodgeable), but until this
  // route stopped filtering by expiry, an expired-but-uncanceled invitation
  // counted against the ceiling while being invisible here -- so there was
  // no way to find its id and cancel it. Before S10 unmounted the
  // organization() plugin, its own unfiltered list-invitations route was
  // the (accidental) recovery path; this proves the native list -> native
  // cancel path now closes the loop on its own, with no plugin involved.
  it("an expired-but-pending invitation is visible here and cancelable via DELETE /api/invitation/{id} (issue #160)", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });

    const [expired] = await db
      .insert(schema.invitationTable)
      .values({
        workspaceId: workspace.id,
        email: "stale@example.com",
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() - 1000),
        inviterId: user.id,
      })
      .returning({ id: schema.invitationTable.id });
    if (!expired) throw new Error("failed to plant the expired invitation");

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const listed = await app.request(
      `/api/workspace/${workspace.id}/invitations`,
    );
    expect(listed.status).toBe(200);
    const invitations = (await listed.json()) as Array<{
      id: string;
      email: string;
    }>;
    const found = invitations.find((i) => i.id === expired.id);
    expect(found?.email).toBe("stale@example.com");

    const canceled = await app.request(`/api/invitation/${expired.id}`, {
      method: "DELETE",
    });
    expect(canceled.status).toBe(200);

    const [row] = await db
      .select({ status: schema.invitationTable.status })
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.id, expired.id));
    expect(row?.status).toBe("canceled");
  });
});
