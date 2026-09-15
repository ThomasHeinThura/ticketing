/**
 * S6a — the native invitation write routes (issue #6, retrofit plan §3,
 * S6a row). Positive paths, validation, authorization boundaries, and the
 * issue #88 duplicate-membership fix for the four routes: invite (create),
 * accept, reject, cancel.
 *
 * The two moved path-keyed guards (rate limit, cloud abuse gate) have their
 * own dedicated files -- `workspace-invite-rate-limit.test.ts` and
 * `workspace-invite-abuse-guards.test.ts` -- mirroring how
 * `organization-invite-rate-limit.test.ts` and
 * `organization-invite-abuse-guards.test.ts` are kept separate from the
 * plugin's own S1 characterization suite.
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
  acceptInvitationNative,
  cancelInvitationNative,
  inviteWorkspaceMemberNative,
  rejectInvitationNative,
} from "./helpers/workspace-invitation-write-http";
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

async function invitationRow(invitationId: string) {
  const [row] = await db
    .select()
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId));
  return row;
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

async function membershipRowCount(
  workspaceId: string,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({ id: schema.workspaceUserTable.id })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    );
  return rows.length;
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("S6a invite (POST /api/workspace/{id}/invitations)", () => {
  it("an owner invites a new email and an invitation row is created, pending", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Invites");

    const invited = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "newcomer@example.com", role: "member" },
    );
    expect(invited.status).toBe(200);
    const body = (await invited.json()) as { id: string; status: string };
    expect(body.status).toBe("pending");

    const row = await invitationRow(body.id);
    expect(row?.workspaceId).toBe(workspaceId);
    expect(row?.email).toBe("newcomer@example.com");
    expect(row?.status).toBe("pending");
  });

  it('refuses role "owner" with 400 and writes no row', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "No Owner");

    const invited = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "wannabe-owner@example.com", role: "owner" },
    );
    expect(invited.status).toBe(400);

    const rows = await db
      .select()
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.workspaceId, workspaceId));
    expect(rows).toHaveLength(0);
  });

  it("refuses an unknown role with 400", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Bad Role");

    const invited = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "someone@example.com", role: "not-a-real-role" },
    );
    expect(invited.status).toBe(400);
  });

  it("refuses inviting an email that is already a member with 409", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Already");
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const invited = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: member.user.email, role: "member" },
    );
    expect(invited.status).toBe(409);
  });

  it("refuses a second invite to the same pending email without resend, with 409", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Dupe");

    const first = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "pending@example.com", role: "member" },
    );
    expect(first.status).toBe(200);

    const second = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "pending@example.com", role: "member" },
    );
    expect(second.status).toBe(409);

    const rows = await db
      .select()
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.email, "pending@example.com"));
    expect(rows).toHaveLength(1);
  });

  it("resend: true refreshes the existing pending invitation instead of creating a second row", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Resend");

    const first = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "resend-me@example.com", role: "member" },
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { id: string; expiresAt: string };

    const second = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "resend-me@example.com", role: "member", resend: true },
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { id: string };
    expect(secondBody.id).toBe(firstBody.id);

    const rows = await db
      .select()
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.email, "resend-me@example.com"));
    expect(rows).toHaveLength(1);
  });

  it("a plain member (no invitation:create) is refused with 403", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Boundary");
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const invited = await inviteWorkspaceMemberNative(
      app,
      member.cookie,
      workspaceId,
      { email: "target@example.com", role: "member" },
    );
    expect(invited.status).toBe(403);
  });

  it("an admin (invitation:create granted) succeeds", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Admin OK");
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    const invited = await inviteWorkspaceMemberNative(
      app,
      admin.cookie,
      workspaceId,
      { email: "admin-invitee@example.com", role: "member" },
    );
    expect(invited.status).toBe(200);
  });
});

describe("S6a accept (POST /api/invitation/{id}/accept)", () => {
  it("creates the caller's membership and marks the invitation accepted", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Accept");

    const invited = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "invitee@example.com", role: "member" },
    );
    const invitation = (await invited.json()) as { id: string };
    const invitee = await signUpUser(app, { email: "invitee@example.com" });

    const accepted = await acceptInvitationNative(
      app,
      invitee.cookie,
      invitation.id,
    );
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as {
      invitation: { workspaceId: string; status: string };
      member: { userId: string; role: string };
    };
    expect(body.invitation.workspaceId).toBe(workspaceId);
    expect(body.invitation.status).toBe("accepted");
    expect(body.member.role).toBe("member");

    expect(await membershipRole(workspaceId, invitee.user.id)).toBe("member");
    expect((await invitationRow(invitation.id))?.status).toBe("accepted");
  });

  it("ISSUE #88: refuses a caller who is already a member, with 409, and writes no second membership row", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Already Mem");
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    // A second, independent invitation to the SAME already-a-member email --
    // reachable exactly the way `workspace-member-roles.ts`'s doc comment
    // describes: invite an email that later becomes a member some other way,
    // then the invitation is still sitting there, pending.
    const secondInvite = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: member.user.email, role: "admin", resend: false },
    );
    // The CREATE route itself already refuses this (409, tested above) --
    // so reach the accept-time race a different way: seed the invitation
    // row directly, bypassing the create route's own guard, to prove the
    // ACCEPT route's own check is what refuses it, not merely the create
    // route's.
    expect(secondInvite.status).toBe(409);

    const now = new Date();
    const [directInvitation] = await db
      .insert(schema.invitationTable)
      .values({
        workspaceId,
        email: member.user.email,
        role: "admin",
        status: "pending",
        expiresAt: new Date(now.getTime() + 60_000),
        createdAt: now,
        inviterId: owner.user.id,
      })
      .returning();
    if (!directInvitation) throw new Error("seed insert returned no row");

    const accepted = await acceptInvitationNative(
      app,
      member.cookie,
      directInvitation.id,
    );
    expect(accepted.status).toBe(409);
    expect(await membershipRowCount(workspaceId, member.user.id)).toBe(1);
    expect(await membershipRole(workspaceId, member.user.id)).toBe("member");
  });

  it("refuses a caller who is not the invitation's recipient, with 403", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Wrong Recipient",
    );
    const invited = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "recipient@example.com", role: "member" },
    );
    const invitation = (await invited.json()) as { id: string };
    const stranger = await signUpUser(app);

    const accepted = await acceptInvitationNative(
      app,
      stranger.cookie,
      invitation.id,
    );
    expect(accepted.status).toBe(403);
    expect(await membershipRowCount(workspaceId, stranger.user.id)).toBe(0);
  });

  it("refuses an already-accepted invitation with 400", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Twice");
    const invited = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "twice@example.com", role: "member" },
    );
    const invitation = (await invited.json()) as { id: string };
    const invitee = await signUpUser(app, { email: "twice@example.com" });

    const first = await acceptInvitationNative(
      app,
      invitee.cookie,
      invitation.id,
    );
    expect(first.status).toBe(200);

    const second = await acceptInvitationNative(
      app,
      invitee.cookie,
      invitation.id,
    );
    expect(second.status).toBe(400);
  });

  it("returns 404 for an unknown invitation id", async () => {
    const { app } = createApp();
    const caller = await signUpUser(app);
    const accepted = await acceptInvitationNative(app, caller.cookie, "nope");
    expect(accepted.status).toBe(404);
  });
});

describe("S6a reject (POST /api/invitation/{id}/reject)", () => {
  it('stores status "canceled" -- the app vocabulary has no "rejected" value', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Reject");
    const invited = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "decliner@example.com", role: "member" },
    );
    const invitation = (await invited.json()) as { id: string };
    const decliner = await signUpUser(app, { email: "decliner@example.com" });

    const rejected = await rejectInvitationNative(
      app,
      decliner.cookie,
      invitation.id,
    );
    expect(rejected.status).toBe(200);
    const body = (await rejected.json()) as { status: string };
    expect(body.status).toBe("canceled");
    expect((await invitationRow(invitation.id))?.status).toBe("canceled");
    expect(await membershipRowCount(workspaceId, decliner.user.id)).toBe(0);
  });

  it("refuses a caller who is not the recipient, with 403", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Reject Wrong",
    );
    const invited = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "target@example.com", role: "member" },
    );
    const invitation = (await invited.json()) as { id: string };
    const stranger = await signUpUser(app);

    const rejected = await rejectInvitationNative(
      app,
      stranger.cookie,
      invitation.id,
    );
    expect(rejected.status).toBe(403);
  });
});

describe("S6a cancel (DELETE /api/invitation/{id})", () => {
  it("an owner cancels a pending invitation", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Cancel");
    const invited = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "to-cancel@example.com", role: "member" },
    );
    const invitation = (await invited.json()) as { id: string };

    const canceled = await cancelInvitationNative(
      app,
      owner.cookie,
      invitation.id,
    );
    expect(canceled.status).toBe(200);
    expect((await invitationRow(invitation.id))?.status).toBe("canceled");
  });

  it("a plain member (no invitation:cancel) is refused with 403, and the invitation stays pending", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Cancel Boundary",
    );
    const otherMember = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );
    const invited = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "protected@example.com", role: "member" },
    );
    const invitation = (await invited.json()) as { id: string };

    const canceled = await cancelInvitationNative(
      app,
      otherMember.cookie,
      invitation.id,
    );
    expect(canceled.status).toBe(403);
    expect((await invitationRow(invitation.id))?.status).toBe("pending");
  });

  it("a member of a DIFFERENT workspace cannot cancel this one's invitation", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Cancel Cross",
    );
    const invited = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "cross@example.com", role: "member" },
    );
    const invitation = (await invited.json()) as { id: string };

    const otherOwner = await signUpUser(app);
    await createWorkspace(app, otherOwner.cookie, "Unrelated Workspace");

    const canceled = await cancelInvitationNative(
      app,
      otherOwner.cookie,
      invitation.id,
    );
    expect(canceled.status).toBe(403);
  });

  it("returns 404 for an unknown invitation id", async () => {
    const { app } = createApp();
    const caller = await signUpUser(app);
    const canceled = await cancelInvitationNative(app, caller.cookie, "nope");
    expect(canceled.status).toBe(404);
  });
});
