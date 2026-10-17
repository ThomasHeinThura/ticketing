import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  cancelPendingInvitation,
  findInvitationForAccept,
  findInvitationRecipientAndStatus,
  findInvitationRecipientMatch,
  findInvitationStatus,
  findInvitationWorkspaceId,
  findWorkspaceMemberUserId,
  findWorkspaceRoleId,
  insertWorkspaceMember,
  markInvitationAccepted,
  rejectOwnPendingInvitation,
} from "../../apps/api/src/invitation/repository";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

async function sessionIdentity(userId: string) {
  const identity = await resolveIdentity({ userId, credential: "session" });
  if (!identity) throw new Error("Expected a resolved session identity");
  return identity;
}

async function seedInvitation(
  workspaceId: string,
  inviterId: string,
  email: string,
  overrides: Partial<typeof schema.invitationTable.$inferInsert> = {},
) {
  return requireRow(
    await db
      .insert(schema.invitationTable)
      .values({
        workspaceId,
        email,
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 86_400_000),
        inviterId,
        ...overrides,
      })
      .returning(),
    "seedInvitation",
  );
}

describe("invitation repository (#580)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("reads resolve an invitation by id and report nothing for an unknown id", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const recipient = await createWorkspaceMember();
    const ownerIdentity = await sessionIdentity(owner.user.id);
    const recipientIdentity = await sessionIdentity(recipient.user.id);
    const foreignIdentity = await sessionIdentity(
      (await createWorkspaceMember()).user.id,
    );
    const invitation = await seedInvitation(
      owner.workspace.id,
      owner.user.id,
      recipient.user.email,
    );

    expect(
      await findInvitationWorkspaceId(recipientIdentity, invitation.id),
    ).toEqual({
      workspaceId: owner.workspace.id,
    });
    expect(
      await findInvitationWorkspaceId(foreignIdentity, invitation.id),
    ).toBeUndefined();
    expect(
      await findInvitationRecipientMatch(recipientIdentity, invitation.id),
    ).toBe(true);
    expect(
      await findInvitationRecipientMatch(foreignIdentity, invitation.id),
    ).toBe(false);
    expect(await findInvitationStatus(ownerIdentity, invitation.id)).toEqual({
      id: invitation.id,
      status: "pending",
    });
    expect(
      await findInvitationStatus(foreignIdentity, invitation.id),
    ).toBeUndefined();
    expect(
      await findInvitationRecipientAndStatus(recipientIdentity, invitation.id),
    ).toEqual({
      id: invitation.id,
      pending: true,
      recipientMatches: true,
    });
    const forAccept = await db.transaction((tx) =>
      findInvitationForAccept(tx, recipientIdentity, invitation.id),
    );
    expect(forAccept).toMatchObject({
      id: invitation.id,
      workspaceId: owner.workspace.id,
      role: "member",
    });
    expect(forAccept?.expiresAt).toBeInstanceOf(Date);

    expect(
      await findInvitationWorkspaceId(recipientIdentity, "missing"),
    ).toBeUndefined();
    expect(
      await findInvitationRecipientMatch(recipientIdentity, "missing"),
    ).toBeUndefined();
    expect(
      await findInvitationStatus(ownerIdentity, "missing"),
    ).toBeUndefined();
    expect(
      await findInvitationRecipientAndStatus(recipientIdentity, "missing"),
    ).toBeUndefined();
  });

  it("cancelPendingInvitation only matches a pending invitation (atomic against a lost race)", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const recipient = await createWorkspaceMember();
    const identity = await sessionIdentity(owner.user.id);
    const pending = await seedInvitation(
      owner.workspace.id,
      owner.user.id,
      recipient.user.email,
    );
    const accepted = await seedInvitation(
      owner.workspace.id,
      owner.user.id,
      recipient.user.email,
      {
        status: "accepted",
      },
    );
    const foreignOwner = await createWorkspaceMember({ role: "admin" });
    const foreignRecipient = await createWorkspaceMember();
    const foreignInvitation = await seedInvitation(
      foreignOwner.workspace.id,
      foreignOwner.user.id,
      foreignRecipient.user.email,
    );
    expect(await cancelPendingInvitation(identity, pending.id)).toEqual({
      id: pending.id,
    });
    // a second cancel (or reject) of the same row loses
    expect(await cancelPendingInvitation(identity, pending.id)).toBeUndefined();
    // a non-pending invitation is untouched
    expect(
      await cancelPendingInvitation(identity, accepted.id),
    ).toBeUndefined();
    expect(
      await cancelPendingInvitation(identity, foreignInvitation.id),
    ).toBeUndefined();

    const rows = await db.select().from(schema.invitationTable);
    const byId = new Map(rows.map((row) => [row.id, row.status]));
    expect(byId.get(pending.id)).toBe("canceled");
    expect(byId.get(accepted.id)).toBe("accepted");
    expect(byId.get(foreignInvitation.id)).toBe("pending");
  });

  it("recipient rejection binds both the read and pending update to the current user's email", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const recipient = await createWorkspaceMember();
    const other = await createWorkspaceMember();
    const recipientIdentity = await sessionIdentity(recipient.user.id);
    const otherIdentity = await sessionIdentity(other.user.id);
    const invitation = await seedInvitation(
      owner.workspace.id,
      owner.user.id,
      recipient.user.email,
    );

    expect(
      await rejectOwnPendingInvitation(otherIdentity, invitation.id),
    ).toBeUndefined();
    expect(
      await rejectOwnPendingInvitation(recipientIdentity, invitation.id),
    ).toEqual({ id: invitation.id });
    expect(
      await findInvitationRecipientAndStatus(recipientIdentity, invitation.id),
    ).toMatchObject({
      id: invitation.id,
      pending: false,
      recipientMatches: true,
    });
  });

  it("manager cancellation stops reading and writing after workspace membership is revoked", async () => {
    const manager = await createWorkspaceMember({ role: "admin" });
    const recipient = await createWorkspaceMember();
    const identity = await sessionIdentity(manager.user.id);
    const invitation = await seedInvitation(
      manager.workspace.id,
      manager.user.id,
      recipient.user.email,
    );

    await db
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, manager.workspace.id),
          eq(schema.workspaceUserTable.userId, manager.user.id),
        ),
      );

    expect(await findInvitationStatus(identity, invitation.id)).toBeUndefined();
    expect(
      await cancelPendingInvitation(identity, invitation.id),
    ).toBeUndefined();
    const [unchanged] = await db
      .select({ status: schema.invitationTable.status })
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.id, invitation.id));
    expect(unchanged?.status).toBe("pending");
  });

  it("accept statements: membership and role lookups are workspace-scoped, writes are by id", async () => {
    const a = await createWorkspaceMember({ role: "admin" });
    const b = await createWorkspaceMember({ role: "admin" });
    const joiner = await createWorkspaceMember({ role: "member" });
    const joinerIdentity = await sessionIdentity(joiner.user.id);
    const invitation = await seedInvitation(
      a.workspace.id,
      a.user.id,
      joiner.user.email,
    );

    expect(
      await findWorkspaceMemberUserId(db, a.workspace.id, a.user.id),
    ).toEqual({ userId: a.user.id });
    // the same user in another workspace does not count as a member here
    expect(
      await findWorkspaceMemberUserId(db, a.workspace.id, b.user.id),
    ).toBeUndefined();

    const role = await findWorkspaceRoleId(db, a.workspace.id, "admin");
    expect(role?.id).toBeDefined();
    const foreignRole = await findWorkspaceRoleId(db, b.workspace.id, "admin");
    expect(foreignRole?.id).not.toBe(role?.id);
    expect(
      await findWorkspaceRoleId(db, a.workspace.id, "no-such-role"),
    ).toBeUndefined();

    await markInvitationAccepted(db, joinerIdentity, invitation.id);
    await insertWorkspaceMember(db, {
      workspaceId: a.workspace.id,
      userId: joiner.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    const [after] = await db
      .select()
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.id, invitation.id));
    expect(after?.status).toBe("accepted");
    expect(
      await findWorkspaceMemberUserId(db, a.workspace.id, joiner.user.id),
    ).toEqual({ userId: joiner.user.id });
  });
});
