import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  cancelPendingInvitation,
  findInvitationForAccept,
  findInvitationRecipientAndStatus,
  findInvitationStatus,
  findInvitationWorkspaceId,
  findWorkspaceMemberUserId,
  findWorkspaceRoleId,
  insertWorkspaceMember,
  markInvitationAccepted,
} from "../../apps/api/src/invitation/repository";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

async function seedInvitation(
  workspaceId: string,
  inviterId: string,
  overrides: Partial<typeof schema.invitationTable.$inferInsert> = {},
) {
  return requireRow(
    await db
      .insert(schema.invitationTable)
      .values({
        workspaceId,
        email: `${randomUUID()}@example.com`,
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
    const invitation = await seedInvitation(owner.workspace.id, owner.user.id);

    expect(await findInvitationWorkspaceId(invitation.id)).toEqual({
      workspaceId: owner.workspace.id,
    });
    expect(await findInvitationStatus(invitation.id)).toEqual({
      id: invitation.id,
      status: "pending",
    });
    expect(await findInvitationRecipientAndStatus(invitation.id)).toEqual({
      id: invitation.id,
      email: invitation.email,
      status: "pending",
    });
    const forAccept = await db.transaction((tx) =>
      findInvitationForAccept(tx, invitation.id),
    );
    expect(forAccept).toMatchObject({
      id: invitation.id,
      workspaceId: owner.workspace.id,
      role: "member",
    });
    expect(forAccept?.expiresAt).toBeInstanceOf(Date);

    expect(await findInvitationWorkspaceId("missing")).toBeUndefined();
    expect(await findInvitationStatus("missing")).toBeUndefined();
    expect(await findInvitationRecipientAndStatus("missing")).toBeUndefined();
  });

  it("cancelPendingInvitation only matches a pending invitation (atomic against a lost race)", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const pending = await seedInvitation(owner.workspace.id, owner.user.id);
    const accepted = await seedInvitation(owner.workspace.id, owner.user.id, {
      status: "accepted",
    });

    expect(await cancelPendingInvitation(pending.id)).toEqual({
      id: pending.id,
    });
    // a second cancel (or reject) of the same row loses
    expect(await cancelPendingInvitation(pending.id)).toBeUndefined();
    // a non-pending invitation is untouched
    expect(await cancelPendingInvitation(accepted.id)).toBeUndefined();

    const rows = await db.select().from(schema.invitationTable);
    const byId = new Map(rows.map((row) => [row.id, row.status]));
    expect(byId.get(pending.id)).toBe("canceled");
    expect(byId.get(accepted.id)).toBe("accepted");
  });

  it("accept statements: membership and role lookups are workspace-scoped, writes are by id", async () => {
    const a = await createWorkspaceMember({ role: "admin" });
    const b = await createWorkspaceMember({ role: "admin" });
    const joiner = await createWorkspaceMember({ role: "member" });
    const invitation = await seedInvitation(a.workspace.id, a.user.id);

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

    await markInvitationAccepted(db, invitation.id);
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
