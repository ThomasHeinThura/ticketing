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
import { MAX_PENDING_INVITATIONS_PER_WORKSPACE } from "../../apps/api/src/utils/workspace-invitation-limits";
import { resetTestDatabase } from "./helpers/database";
import { signUpUser } from "./helpers/organization-http";
import {
  acceptInvitationNative,
  cancelInvitationNative,
  inviteAndAcceptAsNewMemberNative,
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

async function pendingInvitationRowCount(workspaceId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.invitationTable.id })
    .from(schema.invitationTable)
    .where(
      and(
        eq(schema.invitationTable.workspaceId, workspaceId),
        eq(schema.invitationTable.status, "pending"),
      ),
    );
  return rows.length;
}

/**
 * Direct-insert seed for the invitation-ceiling tests below -- the same
 * "seed the boring bulk of a capacity scenario by hand, exercise the real
 * route only at the boundary" pattern `workspace-role-writes.test.ts` uses
 * for its 25-role ceiling test, adapted here to avoid `n` real HTTP
 * round-trips for `n` up to 100. Each row gets a distinct email so the test
 * asserting on `pendingInvitationRowCount` can tell seeded rows apart from
 * whatever the test's own real HTTP call adds.
 */
async function seedPendingInvitations(
  workspaceId: string,
  inviterId: string,
  n: number,
  overrides?: { emailPrefix?: string; expired?: boolean },
): Promise<void> {
  if (n <= 0) return;
  const now = new Date();
  const expiresAt = overrides?.expired
    ? new Date(now.getTime() - 60_000)
    : new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const prefix = overrides?.emailPrefix ?? "seed-pending";
  await db.insert(schema.invitationTable).values(
    Array.from({ length: n }, (_, i) => ({
      workspaceId,
      email: `${prefix}-${i}@example.com`,
      role: "member",
      status: "pending" as const,
      expiresAt,
      createdAt: now,
      inviterId,
    })),
  );
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
    const member = await inviteAndAcceptAsNewMemberNative(
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
    const member = await inviteAndAcceptAsNewMemberNative(
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
    const admin = await inviteAndAcceptAsNewMemberNative(
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

  it(`enforces the ${MAX_PENDING_INVITATIONS_PER_WORKSPACE}-pending-invitation ceiling (issue #6 NB-1)`, async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "InviteCeiling",
    );

    // Seed all but one of the ceiling directly -- 100 real HTTP round-trips
    // would work but is needlessly slow for what is otherwise a boundary
    // check.
    await seedPendingInvitations(
      workspaceId,
      owner.user.id,
      MAX_PENDING_INVITATIONS_PER_WORKSPACE - 1,
    );
    expect(await pendingInvitationRowCount(workspaceId)).toBe(
      MAX_PENDING_INVITATIONS_PER_WORKSPACE - 1,
    );

    // The real route takes the LAST available slot.
    const atCeiling = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "the-hundredth@example.com", role: "member" },
    );
    expect(atCeiling.status).toBe(200);
    expect(await pendingInvitationRowCount(workspaceId)).toBe(
      MAX_PENDING_INVITATIONS_PER_WORKSPACE,
    );

    // The real route refuses the next one, and writes no row.
    const overCeiling = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "one-too-many@example.com", role: "member" },
    );
    expect(overCeiling.status).toBe(400);
    // `HTTPException#getResponse()` renders `message` as a plain-text body,
    // not JSON -- same convention every other error-path assertion in this
    // suite relies on (e.g. `workspace-invite-abuse-guards.test.ts`).
    await expect(overCeiling.text()).resolves.toContain(
      `maximum of ${MAX_PENDING_INVITATIONS_PER_WORKSPACE} pending invitations`,
    );
    expect(await pendingInvitationRowCount(workspaceId)).toBe(
      MAX_PENDING_INVITATIONS_PER_WORKSPACE,
    );
  }, 30_000);

  it("the ceiling is workspace-scoped -- a workspace at capacity does not block invitations in a different workspace", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const fullWorkspaceId = await createWorkspace(app, owner.cookie, "Full");
    const otherWorkspaceId = await createWorkspace(app, owner.cookie, "Other");

    await seedPendingInvitations(
      fullWorkspaceId,
      owner.user.id,
      MAX_PENDING_INVITATIONS_PER_WORKSPACE,
    );

    const blockedInFull = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      fullWorkspaceId,
      { email: "blocked@example.com", role: "member" },
    );
    expect(blockedInFull.status).toBe(400);

    const okInOther = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      otherWorkspaceId,
      { email: "fine-elsewhere@example.com", role: "member" },
    );
    expect(okInOther.status).toBe(200);
  });

  it("resend: true succeeds even when the workspace is AT the ceiling, since it updates the existing row rather than inserting a new one", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "ResendAtCeiling",
    );

    // 99 filler rows plus one real, unexpired pending invitation for the
    // email we are about to resend to -- 100 pending rows total, exactly at
    // the ceiling.
    await seedPendingInvitations(
      workspaceId,
      owner.user.id,
      MAX_PENDING_INVITATIONS_PER_WORKSPACE - 1,
    );
    const first = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "resend-target@example.com", role: "member" },
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { id: string };
    expect(await pendingInvitationRowCount(workspaceId)).toBe(
      MAX_PENDING_INVITATIONS_PER_WORKSPACE,
    );

    // A brand-new invitation is refused here, confirming the workspace is
    // genuinely at the ceiling before the resend assertion below.
    const newInviteBlocked = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "genuinely-new@example.com", role: "member" },
    );
    expect(newInviteBlocked.status).toBe(400);

    // But resending the existing invitation succeeds, because it updates
    // the same row instead of inserting a new one.
    const resent = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "resend-target@example.com", role: "member", resend: true },
    );
    expect(resent.status).toBe(200);
    const resentBody = (await resent.json()) as { id: string };
    expect(resentBody.id).toBe(firstBody.id);
    expect(await pendingInvitationRowCount(workspaceId)).toBe(
      MAX_PENDING_INVITATIONS_PER_WORKSPACE,
    );
  }, 30_000);

  it("an expired-but-still-pending row still occupies a ceiling slot until it is canceled (deliberate design choice, see invite-workspace-member.ts)", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "ExpiredCounts",
    );

    // 99 live rows plus ONE expired-but-status-"pending" row -- 100 rows
    // that all still read `status = 'pending'`, even though one of them can
    // no longer be resent or accepted.
    await seedPendingInvitations(
      workspaceId,
      owner.user.id,
      MAX_PENDING_INVITATIONS_PER_WORKSPACE - 1,
    );
    const now = new Date();
    const [expiredRow] = await db
      .insert(schema.invitationTable)
      .values({
        workspaceId,
        email: "stale-expired@example.com",
        role: "member",
        status: "pending",
        expiresAt: new Date(now.getTime() - 60_000),
        createdAt: now,
        inviterId: owner.user.id,
      })
      .returning();
    if (!expiredRow) throw new Error("seed insert returned no row");
    expect(await pendingInvitationRowCount(workspaceId)).toBe(
      MAX_PENDING_INVITATIONS_PER_WORKSPACE,
    );

    // The expired row counts against the ceiling -- a new invite is refused
    // even though the expired row itself could never be resent or accepted.
    const blocked = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "blocked-by-stale@example.com", role: "member" },
    );
    expect(blocked.status).toBe(400);

    // Canceling the expired row frees the slot it was occupying.
    const canceled = await cancelInvitationNative(
      app,
      owner.cookie,
      expiredRow.id,
    );
    expect(canceled.status).toBe(200);
    expect(await pendingInvitationRowCount(workspaceId)).toBe(
      MAX_PENDING_INVITATIONS_PER_WORKSPACE - 1,
    );

    const nowAllowed = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "allowed-after-cancel@example.com", role: "member" },
    );
    expect(nowAllowed.status).toBe(200);
  }, 30_000);
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
    const member = await inviteAndAcceptAsNewMemberNative(
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
    const otherMember = await inviteAndAcceptAsNewMemberNative(
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

  it("#281 sweep: a NUL byte in the invitation id is a clean 400, not a 500 (requireInvitationWorkspaceAccess reads the raw param before any workspaceAccess.* middleware runs)", async () => {
    const { app } = createApp();
    const caller = await signUpUser(app);

    const response = await app.request(
      `/api/invitation/${encodeURIComponent("\u0000x")}`,
      { method: "DELETE", headers: { cookie: caller.cookie } },
    );

    expect(response.status).toBe(400);
  });
});
